/* The computer opponent.
 *
 * It decides from the SAME redacted view a human at that seat receives, so it
 * cannot see anyone else's cards, and every move it makes goes through the
 * server's normal validation. That is deliberate: if the bot ever manages an
 * illegal play, it is a hole in the referee, not a bot cheat.
 *
 * `decide(view)` returns ONE action, or null to pass. The server calls it
 * repeatedly through a turn until it discards.
 */

const E = require('./engine.js');

function values(cards) {
  return cards.reduce(function (s, c) { return s + E.cardValue(c); }, 0);
}

/* group the hand by rank, skipping wilds and threes (threes never meld) */
function byRank(hand) {
  const out = {};
  hand.forEach(function (c) {
    if (E.isWild(c) || E.rankOf(c) === '3') return;
    (out[E.rankOf(c)] = out[E.rankOf(c)] || []).push(c);
  });
  return out;
}

function wildsIn(hand) {
  return hand.filter(function (c) { return E.isWild(c); });
}

function myMelds(view) {
  const seat = view.you.seat;
  return (view.seats[seat] && view.seats[seat].melds) || [];
}

function openMeld(view, rank) {
  return myMelds(view).filter(function (m) {
    return m.rank === rank && m.cards.length < view.settings.bookSize;
  })[0];
}

/* how many cards this player may lay before they no longer have a legal
 * discard; mirrors the engine's own keep-a-discard rule */
function layBudget(view) {
  const me = view.you;
  // A red three is a legal discard at this table, so it counts towards the card
  // you have to keep back. Under the lay-off rule it never reaches the hand
  // anyway, so filtering it out costs nothing there either.
  const live = me.hand.length;
  if (!me.inFoot) return live;                 // emptying the hand just picks up the foot
  /* Going out means playing every card, so with the books in hand there is
   * nothing to hold back. Without them, keep one card to discard. */
  return me.canGoOut && me.canGoOut.ok ? live : live - 1;
}

/* ---------------- opening ---------------- */

/* How many more cards a meld of this rank can still take, and whether we
 * would be starting one or adding to one we already have. */
function roomFor(view, rank) {
  const existing = myMelds(view).filter(function (m) { return m.rank === rank; })[0];
  if (!existing) return { room: view.settings.bookSize, meld: null };
  const st = E.meldStats(existing, view.settings);
  if (st.complete) return { room: 0, meld: existing };
  return { room: view.settings.bookSize - existing.cards.length, meld: existing };
}

/* Wilds in a fixed order, richest first, so that a plan made now and the same
 * plan recomputed one meld later reach for the same cards. */
function orderedWilds(hand) {
  return wildsIn(hand).slice().sort(function (a, b) {
    return E.cardValue(b) - E.cardValue(a) || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/* Can we reach the round minimum this turn, and with which melds?
 * Returns the melds to lay, biggest first, or [] if we cannot get there.
 *
 * This has to be exactly right, because `decide` lays only the first meld and
 * then plans again from the new view. Two things make that safe: no two
 * entries in a plan may claim the same card (the old version handed one wild
 * to every pair it found, so the plan looked bigger than the hand could pay
 * for, and the bot stranded itself half-open), and the ordering has to be
 * stable, so that planning again after laying the first meld yields the rest
 * of the same plan rather than a different, shorter one. */
function planOpening(view) {
  const me = view.you;
  const groups = byRank(me.hand);
  const budget = layBudget(view);
  const wilds = orderedWilds(me.hand);

  const solid = [];   // three or more naturals: a meld on its own
  const pairs = [];   // two naturals: needs one wild to be legal

  Object.keys(groups).sort().forEach(function (rank) {
    const r = roomFor(view, rank);
    if (r.room <= 0) return;
    const naturals = groups[rank].slice(0, r.room);
    // adding to a meld we already have needs no minimum of its own
    if (r.meld) {
      if (naturals.length) {
        pairs.push({ rank: rank, add: true, meld: r.meld, cards: naturals, value: values(naturals) });
      }
      return;
    }
    if (naturals.length >= 3) {
      solid.push({ rank: rank, cards: naturals, value: values(naturals) });
    } else if (naturals.length === 2 && r.room >= 3) {
      pairs.push({ rank: rank, naturals: naturals, needsWild: true, value: values(naturals) });
    }
  });

  const byValue = function (a, b) {
    return b.value - a.value || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
  };
  solid.sort(byValue);
  pairs.sort(byValue);

  const plan = [];
  let total = view.turnState ? view.turnState.melded : 0;
  let spent = 0;
  let nextWild = 0;

  function take(c) { plan.push(c); total += c.value; spent += c.cards.length; }

  for (const c of solid) {
    if (total >= view.minMeld) break;
    if (spent + c.cards.length > budget) continue;
    take(c);
  }
  for (const c of pairs) {
    if (total >= view.minMeld) break;
    if (!c.needsWild) {
      if (spent + c.cards.length > budget) continue;
      take(c);
      continue;
    }
    if (nextWild >= wilds.length) break;        // every wild is already spoken for
    const cards = c.naturals.concat([wilds[nextWild]]);
    if (spent + cards.length > budget) continue;
    nextWild++;
    take({ rank: c.rank, cards: cards, value: values(cards), usesWild: true });
  }

  return total >= view.minMeld ? plan : [];
}

/* ---------------- discarding ---------------- */

function chooseDiscard(view) {
  const me = view.you;
  const S = view.settings;
  const live = me.hand.slice();
  if (!live.length) return null;

  const counts = {};
  me.hand.forEach(function (c) {
    const r = E.rankOf(c);
    counts[r] = (counts[r] || 0) + 1;
  });

  /* With both books down and the foot in hand, going out is no longer about
   * points — every card has to reach a meld, and a card that cannot is the only
   * thing standing between us and the round. Shed those first. */
  const closing = me.inFoot && me.canGoOut && me.canGoOut.ok;

  const scored = live.map(function (c) {
    const rank = E.rankOf(c);
    let keep = 0;
    if (E.isWild(c)) keep += 100;                       // wilds finish books
    if (E.isBlackThree(c)) keep -= 30;                  // dead weight, dump it
    // 100 against you if the round ends while you hold it, and it can never be
    // melded — so it goes before anything else in the hand.
    if (E.isRedThree(c)) keep -= 1000;
    keep += (counts[rank] - 1) * 12;                    // pairs are worth holding
    if (openMeld(view, rank)) keep += 25;               // feeds a book we have open
    keep += E.cardValue(c) * 0.4;                       // shed the expensive ones late
    if (closing) {
      const open = openMeld(view, rank);
      const placeable = E.isWild(c) ||
        (open && open.cards.length < S.bookSize) ||
        counts[rank] >= 3;
      if (!placeable) keep -= 200;
    }
    return { card: c, keep: keep };
  });

  scored.sort(function (a, b) { return a.keep - b.keep; });
  return scored[0].card;
}

/* ---------------- the turn ---------------- */

function decide(view) {
  if (!view || view.phase !== 'playing' || !view.you) return null;
  if (view.turn !== view.you.seat) return null;

  const me = view.you;
  const S = view.settings;

  /* ---- draw ---- */
  if (view.turnPhase === 'draw') {
    const top = view.discardTop;
    if (top && !E.isWild(top) && !E.isBlackThree(top) && !E.isRedThree(top)) {
      const rank = E.rankOf(top);
      const naturals = me.hand.filter(function (c) {
        return !E.isWild(c) && E.rankOf(c) === rank;
      });
      if (naturals.length >= S.pileNaturalsRequired) {
        const take = naturals.slice(0, S.bookSize - 1);
        const worth = values(take.concat([top]));
        const open = openMeld(view, rank);
        // only worth it if it is legal: either we are already down, or this
        // alone clears the minimum
        const downAlready = me.hasInitialMeld ||
          (view.turnState && view.turnState.melded >= view.minMeld);
        const fits = open ? open.cards.length + take.length + 1 <= S.bookSize : true;
        if (fits && (downAlready || worth >= view.minMeld)) {
          return { action: 'pile', cards: take };
        }
      }
    }
    const live = [];
    view.stocks.forEach(function (n, i) { if (n > 0) live.push(i); });
    if (live.length >= S.distinctDrawPiles) {
      live.sort(function (a, b) { return view.stocks[b] - view.stocks[a]; });
      return { action: 'draw', piles: [live[0], live[1]] };
    }
    return { action: 'draw', piles: [] };
  }

  /* ---- play ---- */
  const downAlready = me.hasInitialMeld ||
    (view.turnState && view.turnState.melded >= view.minMeld);

  if (!downAlready) {
    const plan = planOpening(view);
    if (plan.length) {
      const first = plan[0];
      const open = openMeld(view, first.rank);
      return open
        ? { action: 'meldAdd', meldId: open.id, cards: first.cards }
        : { action: 'meldNew', rank: first.rank, cards: first.cards };
    }
    /* Nothing we can lay reaches the minimum. If we already put cards down
     * this turn we are half-open and cannot legally discard, so take them
     * back rather than hand the referee a move it has to refuse. */
    if (view.turnState && view.turnState.melded > 0 && !view.turnState.tookPile) {
      return { action: 'undo' };
    }
    const card = chooseDiscard(view);
    return card ? { action: 'discard', card: card } : null;
  }

  // already down: feed open books first, biggest gain first
  const groups = byRank(me.hand);
  let budget = layBudget(view);

  const adds = [];
  myMelds(view).forEach(function (m) {
    const st = E.meldStats(m, S);
    if (st.complete) return;
    const room = S.bookSize - m.cards.length;
    const naturals = (groups[m.rank] || []).slice(0, room);
    if (naturals.length) adds.push({ meld: m, cards: naturals, value: values(naturals) });
  });
  adds.sort(function (a, b) { return b.value - a.value; });
  for (const a of adds) {
    if (a.cards.length <= budget) {
      return { action: 'meldAdd', meldId: a.meld.id, cards: a.cards };
    }
  }

  // finish a book with a wild when one card short
  const spare = wildsIn(me.hand);
  if (spare.length) {
    for (const m of myMelds(view)) {
      const st = E.meldStats(m, S);
      if (st.complete) continue;
      if (m.cards.length === S.bookSize - 1 && st.wilds < S.maxWildsInBook &&
          st.naturals >= 2 && budget >= 1) {
        return { action: 'meldAdd', meldId: m.id, cards: [spare[0]] };
      }
    }
  }

  // new melds from three or more of a rank
  const fresh = Object.keys(groups)
    .filter(function (r) { return !openMeld(view, r) && !myMelds(view).some(function (m) { return m.rank === r; }); })
    .map(function (r) {
      const cards = groups[r].slice(0, S.bookSize);
      return { rank: r, cards: cards, value: values(cards) };
    })
    .filter(function (c) { return c.cards.length >= 3; });
  fresh.sort(function (a, b) { return b.value - a.value; });
  for (const f of fresh) {
    if (f.cards.length <= budget) {
      return { action: 'meldNew', rank: f.rank, cards: f.cards };
    }
  }

  const card = chooseDiscard(view);
  return card ? { action: 'discard', card: card } : null;
}

module.exports = { decide, planOpening, chooseDiscard, layBudget };
