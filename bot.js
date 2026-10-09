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

// Private server-selected play styles. These change decisions, never the
// information a computer receives or the rules it is permitted to follow.
const STYLES = Object.freeze(['balanced', 'builder', 'collector', 'runner']);
const PROFILES = {
  balanced: { pair: 12, wild: 100, open: 25, value: 0.4 },
  builder: { pair: 24, wild: 85, open: 38, value: 0.3 },
  collector: { pair: 20, wild: 120, open: 30, value: 0.7 },
  runner: { pair: 5, wild: 55, open: 35, value: -0.5 },
};
function styleOf(style) { return STYLES.includes(style) ? style : 'balanced'; }

function values(cards, S) {
  return cards.reduce(function (s, c) { return s + E.cardValue(c, S); }, 0);
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

/* A book of this rank that is still short of closing. A closed one can still
 * take cards, but it is not where the bot wants them — a fresh book of the same
 * rank earns a second bonus, so `openMeld` means "not yet a book". */
function openMeld(view, rank) {
  return myMelds(view).filter(function (m) {
    return m.rank === rank && m.cards.length < view.settings.bookSize;
  })[0];
}

/* how many cards this player may lay and still be able to finish the turn;
 * mirrors the engine's own keep-two rule */
function layBudget(view) {
  const me = view.you;
  // A red three is a legal discard at this table, so it counts towards the cards
  // you have to keep back. Under the lay-off rule it never reaches the hand
  // anyway, so filtering it out costs nothing there either.
  const live = me.hand.length;
  if (!me.inFoot) return live;                 // emptying the hand just picks up the foot
  /* Going out means playing every card, so with the books down there is nothing
   * to hold back. Otherwise keep two: in your foot you may not be left holding
   * nothing, so one card gets discarded and one has to survive the turn. */
  return me.canGoOut && me.canGoOut.ok ? live - (view.settings.goOutWithDiscard ? 1 : 0) : live - 2;
}

/* Whether laying `k` cards leaves the turn somewhere it can be finished.
 *
 * A budget alone is not enough once you are in your foot, because the sizes
 * that are legal are not a range: you may come down to two cards or more, and
 * you may come down to none at all if that is you going out, but never to one.
 * A single card left in your foot can be neither discarded nor kept, so a bot
 * that stepped onto it had no move left and the referee had to refuse it. */
function mayLay(view, k) {
  const me = view.you;
  if (k <= 0 || k > me.hand.length) return false;
  if (!me.inFoot) return true;             // emptying the hand just picks up the foot
  const left = me.hand.length - k;
  if (left >= 2) return true;
  if (view.settings.goOutWithDiscard) return left === 1 && !!(me.canGoOut && me.canGoOut.ok);
  if (left > 0) return false;              // stopping on one card is the dead end
  return !!(me.canGoOut && me.canGoOut.ok);
}

/* Check the books after this play. A play can itself finish the missing book,
 * and a one-card stop is safe only when that exact remaining card can also be
 * laid. Looking only at canGoOut from before the play misses winning moves. */
function mayPlay(view, cards, rank, target) {
  const me = view.you;
  if (!cards.length || cards.length > me.hand.length) return false;
  if (!me.inFoot || me.hand.length - cards.length >= 2) return true;
  const S = Object.assign({}, E.DEFAULTS, view.settings);
  const melds = myMelds(view).map(function (m) {
    return { rank: m.rank, cards: m === target ? m.cards.concat(cards) : m.cards.slice() };
  });
  if (!target) melds.push({ rank: rank, cards: cards.slice() });
  const red = melds.filter(function (m) { return E.meldStats(m, S).isRedBook; }).length;
  const black = melds.filter(function (m) {
    const st = E.meldStats(m, S);
    return st.isBlackBook || st.isWildBook;
  }).length;
  if (red < S.requireRedBook || black < S.requireBlackBook) return false;
  const left = me.hand.filter(function (c) { return !cards.includes(c); });
  const opening = (view.turnState ? view.turnState.melded : 0) + values(cards, S) +
    (S.goOutWithDiscard ? 0 : values(left, S));
  if (!me.hasInitialMeld && opening < view.minMeld) return false;
  if (S.goOutWithDiscard) return left.length === 1;
  if (!left.length) return true;
  return melds.some(function (m) {
    const st = E.meldStats(m, S);
    if (st.isRedBook && E.isWild(left[0])) return false;
    return E.checkMeld(m.rank, m.cards.concat(left), S).ok;
  });
}

/* The largest natural play may stop on the forbidden one-card foot. Trying
 * the keep-two size as well is enough to recover its legal smaller version;
 * this never searches combinations or changes the personality's priorities. */
function naturalPlay(view, cards, rank, target) {
  function legal(chosen) {
    return chosen.length && mayPlay(view, chosen, rank, target) &&
      E.checkMeld(rank, target ? target.cards.concat(chosen) : chosen, view.settings).ok;
  }
  if (legal(cards)) return cards;
  if (view.settings.goOutWithDiscard) {
    const finalDiscard = cards.slice(0, Math.max(0, view.you.hand.length - 1));
    if (finalDiscard.length < cards.length && legal(finalDiscard)) return finalDiscard;
  }
  const smaller = cards.slice(0, Math.max(0, view.you.hand.length - 2));
  return smaller.length < cards.length && legal(smaller) ? smaller : [];
}

/* A certain finish takes precedence over style. Test the whole remaining
 * hand against each legal destination, including two or more final wilds.
 * Work is bounded by the player's public melds and the ranks in their hand. */
function winningMove(view) {
  const me = view.you, S = view.settings;
  if (!me.inFoot || !me.hand.length) return null;
  for (const m of myMelds(view)) {
    if (E.meldStats(m, S).isRedBook && me.hand.some(E.isWild)) continue;
    if (E.checkMeld(m.rank, m.cards.concat(me.hand), S).ok && mayPlay(view, me.hand, m.rank, m)) {
      return { action: 'meldAdd', meldId: m.id, cards: me.hand.slice() };
    }
  }
  for (const rank of Object.keys(byRank(me.hand)).sort()) {
    if (!openMeld(view, rank) && E.checkMeld(rank, me.hand, S).ok && mayPlay(view, me.hand, rank, null)) {
      return { action: 'meldNew', rank: rank, cards: me.hand.slice() };
    }
  }
  return null;
}

/* ---------------- opening ---------------- */

/* How many more cards a meld of this rank can still take, and whether we
 * would be starting one or adding to one we already have. */
function roomFor(view, rank) {
  const open = openMeld(view, rank);
  // Nothing of this rank still open: start a fresh book, which has room for a
  // whole book of its own.
  if (!open) return { room: view.settings.bookSize, meld: null };
  return { room: view.settings.bookSize - open.cards.length, meld: open };
}

/* Wilds in a fixed order, richest first, so that a plan made now and the same
 * plan recomputed one meld later reach for the same cards. */
function orderedWilds(hand, S) {
  return wildsIn(hand).slice().sort(function (a, b) {
    return E.cardValue(b, S) - E.cardValue(a, S) || (a < b ? -1 : a > b ? 1 : 0);
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
  const S = Object.assign({}, E.DEFAULTS, view.settings);
  const me = view.you;
  const groups = byRank(me.hand);
  const budget = layBudget(view);
  const wilds = orderedWilds(me.hand, S);

  const solid = [];   // three or more naturals: a meld on its own
  const pairs = [];   // two naturals: needs one wild to be legal

  Object.keys(groups).sort().forEach(function (rank) {
    const r = roomFor(view, rank);
    if (r.room <= 0) return;
    const naturals = groups[rank].slice(0, r.room);
    // adding to a meld we already have needs no minimum of its own
    if (r.meld) {
      if (naturals.length) {
        pairs.push({ rank: rank, add: true, meld: r.meld, cards: naturals, value: values(naturals, S) });
      }
      return;
    }
    if (naturals.length >= 3) {
      solid.push({ rank: rank, cards: naturals, value: values(naturals, S) });
    } else if (naturals.length === 2 && r.room >= 3) {
      pairs.push({ rank: rank, naturals: naturals, needsWild: true, value: values(naturals, S) });
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
    if (!E.checkMeld(c.rank, cards, S).ok) continue;
    if (spent + cards.length > budget) continue;
    nextWild++;
    take({ rank: c.rank, cards: cards, value: values(cards, S), usesWild: true });
  }

  // Legal natural triples can need a joker to clear the round minimum too.
  // Allocate only wilds not already promised to pairs, in stable plan order.
  // A completed natural book may include its wild in this same new-meld play;
  // no wild is ever added to a previously completed red book.
  for (const c of plan) {
    while (total < view.minMeld && nextWild < wilds.length && spent <= budget) {
      const wild = wilds[nextWild];
      let cards = c.cards.concat([wild]);
      let all = c.meld ? c.meld.cards.concat(cards) : cards;
      let removed = null;
      if (c.meld && E.meldStats(c.meld, S).isRedBook) break;
      // A locked seven-card book may need higher-value wilds to open. More
      // naturals arriving in a discard take must not invalidate a plan that
      // was possible with four naturals and three wilds before the pickup.
      if (S.closedBooksLocked && all.length > S.bookSize) {
        const replace = c.cards.findIndex(card => !E.isWild(card) &&
          E.cardValue(wild, S) > E.cardValue(card, S));
        if (replace < 0) break;
        removed = c.cards[replace];
        cards = c.cards.slice(); cards[replace] = wild;
        all = c.meld ? c.meld.cards.concat(cards) : cards;
      }
      if ((!removed && spent >= budget) || !E.checkMeld(c.rank, all, S).ok) break;
      const gain = E.cardValue(wild, S) - (removed ? E.cardValue(removed, S) : 0);
      c.cards = cards;
      c.value += gain;
      c.usesWild = true;
      total += gain;
      if (!removed) spent++;
      nextWild++;
    }
    if (total >= view.minMeld) break;
  }

  return total >= view.minMeld ? plan : [];
}

/* ---------------- discarding ---------------- */

function chooseDiscard(view, style) {
  style = styleOf(style);
  const profile = PROFILES[style];
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
    // With wild books disabled and a zero cap, these can never reach a meld.
    // Shed the largest held penalty first, regardless of pair/style bonuses.
    if (E.isWild(c) && S.maxWildsInBook === 0 && !S.allowWildBooks) {
      return { card: c, keep: -300 - E.cardValue(c, S) };
    }
    let keep = 0;
    if (E.isWild(c)) keep += profile.wild;              // wilds finish books
    if (E.isBlackThree(c)) keep -= 30;                  // dead weight, dump it
    // 100 against you if the round ends while you hold it, and it can never be
    // melded — so it goes before anything else in the hand.
    if (E.isRedThree(c)) keep -= 1000;
    keep += (counts[rank] - 1) * profile.pair;
    if (openMeld(view, rank)) keep += profile.open;
    keep += E.cardValue(c, S) * profile.value;
    if (style === 'collector' && !E.isWild(c)) {
      // Public books reveal which discards would help another player. Never
      // inspect, infer a specific card from, or receive their hidden hands.
      const feedsOpponent = view.seats.some(function (seat, i) {
        return i !== me.seat && seat.melds.some(function (m) {
          return m.rank === rank && m.cards.length < S.bookSize;
        });
      });
      if (feedsOpponent) keep += 18;
    }
    if (closing) {
      const open = openMeld(view, rank);
      const placeable = (E.isWild(c) && (S.maxWildsInBook > 0 || S.allowWildBooks)) ||
        open || counts[rank] >= 3;
      if (!placeable) keep -= 200;
    }
    return { card: c, keep: keep };
  });

  scored.sort(function (a, b) { return a.keep - b.keep; });
  return scored[0].card;
}

/* Rank only legal candidates. The opening planner and final-card safety path
 * remain shared, so a personality cannot choose to strand an unfinished turn.
 * Builders protect natural books; collectors establish more useful ranks;
 * runners shed the most cards and reach their foot quickly. */
function styledMeld(view, style) {
  const S = Object.assign({}, E.DEFAULTS, view.settings);
  const me = view.you;
  const groups = byRank(me.hand);
  const spare = orderedWilds(me.hand, S);
  const mine = myMelds(view);
  const candidates = [];
  const redAlready = mine.some(function (m) { return E.meldStats(m, S).isRedBook; });

  function offer(rank, cards, target, kind) {
    if (!cards.length || !mayPlay(view, cards, rank, target)) return;
    const all = target ? target.cards.concat(cards) : cards;
    if (!E.checkMeld(rank, all, S).ok) return;
    const prior = target ? E.meldStats(target, S) : null;
    const after = E.meldStats({ rank: rank, cards: all }, S);
    if (prior && prior.isRedBook && cards.some(E.isWild)) return;
    const closes = after.complete && !(prior && prior.complete);
    const usedWild = cards.filter(E.isWild).length;
    const empty = cards.length === me.hand.length;
    let score;
    if (style === 'builder') {
      score = cards.length * 6 + values(cards, S) * 0.15 + (closes ? 50 : 0) +
        (closes && after.isRedBook ? 100 : 0) + (after.wilds === 0 ? 15 : 0) - usedWild * 12;
      // Keep a six-natural book clean while a red book is still needed, unless
      // the move empties the hand or stock exhaustion makes waiting pointless.
      if (!redAlready && prior && prior.wilds === 0 && usedWild && !empty &&
          view.stocks.reduce(function (n, count) { return n + count; }, 0) > S.drawCount * 2) score -= 120;
    } else if (style === 'collector') {
      score = cards.length * 7 + values(cards, S) * 0.7 + (closes ? 35 : 0) +
        (kind === 'new' ? 34 : 0) - usedWild * 3;
    } else {
      score = cards.length * 25 + values(cards, S) * 0.05 + (closes ? 8 : 0) + (empty ? 100 : 0);
    }
    if (empty && me.inFoot) score += 10000;
    if (score > 0) candidates.push({ score: score, action: target
      ? { action: 'meldAdd', meldId: target.id, cards: cards }
      : { action: 'meldNew', rank: rank, cards: cards } });
  }

  mine.forEach(function (m) {
    const st = E.meldStats(m, S);
    const cards = naturalPlay(view,
      (groups[m.rank] || []).slice(0, st.complete ? undefined : S.bookSize - m.cards.length), m.rank, m);
    offer(m.rank, cards, m, st.complete ? 'closed' : 'open');
    if (!st.complete && m.cards.length === S.bookSize - 1 && spare.length && st.wilds < S.maxWildsInBook) {
      offer(m.rank, [spare[0]], m, 'wild');
    }
  });
  Object.keys(groups).sort().forEach(function (rank) {
    if (openMeld(view, rank)) return;
    const naturals = groups[rank].slice(0, S.bookSize);
    if (naturals.length >= 3) offer(rank, naturalPlay(view, naturals, rank, null), null, 'new');
    else if (naturals.length === 2 && spare.length) offer(rank, naturals.concat([spare[0]]), null, 'new');
  });
  candidates.sort(function (a, b) { return b.score - a.score; });
  return candidates.length ? candidates[0].action : null;
}

function wantsPile(view, style, rank, take, extras) {
  if (style === 'balanced' || style === 'collector') return true;
  const open = openMeld(view, rank);
  const closes = take.length + 1 + (open ? open.cards.length : 0) >= view.settings.bookSize;
  if (style === 'builder') return !!open || closes || take.length >= 3 || extras <= 1;
  // A runner avoids adding a big packet to the hand unless it completes a
  // book; collecting many cards is useful to other styles but slows the foot.
  return closes || extras <= take.length;
}

/* Prove a combined opening using only cards already known to this seat.
 * Unknown buried cards provide no points or extra lay budget in this plan. */
function opensWithPile(view, rank, take, top) {
  const S = view.settings;
  const cards = take.concat([top]);
  const melds = myMelds(view).map(function (m) { return { id: m.id, rank: m.rank, cards: m.cards.slice() }; });
  const target = melds.find(function (m) { return m.rank === rank && m.cards.length < view.settings.bookSize; });
  if (target) target.cards = target.cards.concat(cards);
  else melds.push({ id: 'planned-pile', rank: rank, cards: cards });
  const seats = view.seats.slice();
  seats[view.you.seat] = Object.assign({}, seats[view.you.seat], { melds: melds });
  const after = Object.assign({}, view, {
    seats: seats,
    you: Object.assign({}, view.you, { hand: view.you.hand.filter(function (c) { return !take.includes(c); }) }),
    turnState: Object.assign({}, view.turnState, {
      melded: (view.turnState ? view.turnState.melded : 0) + values(cards, S),
    }),
  });
  return planOpening(after).length > 0;
}

/* ---------------- the turn ---------------- */

function decide(view, style) {
  style = styleOf(style);
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
        const extras = Math.min(S.pileTakeExtra, Math.max(0, view.discardCount - 1));
        // A short pile can leave a foot with no legal discard. Keep two cards
        // even when fewer than the usual six cards will come back into hand.
        const open = openMeld(view, rank);
        const capacity = S.closedBooksLocked ? S.bookSize - 1 - (open ? open.cards.length : 0) : S.bookSize - 1;
        const limit = me.inFoot
          ? Math.min(capacity, me.hand.length + extras - 2)
          : capacity;
        const take = naturals.slice(0, Math.max(0, limit));
        const worth = values(take.concat([top]), S);
        // A known second meld may supply the rest of the opening minimum.
        const downAlready = me.hasInitialMeld ||
          (view.turnState && view.turnState.melded >= view.minMeld);
        if (take.length >= S.pileNaturalsRequired &&
            E.checkMeld(rank, (open ? open.cards : []).concat(take, [top]), S).ok &&
            (downAlready || worth >= view.minMeld || opensWithPile(view, rank, take, top)) &&
            wantsPile(view, style, rank, take, extras)) {
          return { action: 'pile', cards: take };
        }
      }
    }
    const live = [];
    view.stocks.forEach(function (n, i) { if (n > 0) live.push(i); });
    if (live.length >= S.distinctDrawPiles) {
      live.sort(function (a, b) { return view.stocks[b] - view.stocks[a]; });
      return { action: 'draw', piles: [live[0], live[S.distinctDrawPiles === 1 ? 0 : 1]] };
    }
    return { action: 'draw', piles: [] };
  }

  /* ---- play ---- */
  const downAlready = me.hasInitialMeld ||
    (view.turnState && view.turnState.melded >= view.minMeld);

  const win = winningMove(view);
  if (win) return win;

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
    if (view.turnState && view.turnState.melded > 0) {
      return { action: 'undo' };
    }
    const card = chooseDiscard(view, style);
    return card ? { action: 'discard', card: card } : null;
  }

  // A preceding play may leave one proven-placeable card on the way out.
  // Wilds can go onto an unfinished or black book even when it is not one
  // short, so the usual book-building priorities are too narrow here.
  if (me.inFoot && me.hand.length === 1 && me.canGoOut && me.canGoOut.ok) {
    if (S.goOutWithDiscard) return { action: 'discard', card: me.hand[0] };
    const card = me.hand[0];
    const target = myMelds(view).find(function (m) {
      if (E.meldStats(m, S).isRedBook && E.isWild(card)) return false;
      return E.checkMeld(m.rank, m.cards.concat([card]), S).ok;
    });
    if (target) return { action: 'meldAdd', meldId: target.id, cards: [card] };
  }

  // With three-card books and a three-natural minimum, a natural triple is
  // already permanently red. A required black book must be started with its
  // wild in the same play; waiting to add it later can never satisfy the rule.
  if (S.bookSize === 3 && S.minNaturalsInMeld === 3 && S.maxWildsInBook > 0 &&
      myMelds(view).filter(m => E.meldStats(m, S).isBlackBook).length < S.requireBlackBook) {
    const groups = byRank(me.hand), wild = orderedWilds(me.hand, S)[0];
    if (wild) for (const rank of Object.keys(groups).sort()) {
      if (groups[rank].length < 3 || openMeld(view, rank)) continue;
      const cards = groups[rank].slice(0, 3).concat([wild]);
      if (E.checkMeld(rank, cards, S).ok && mayPlay(view, cards, rank, null)) {
        return { action: 'meldNew', rank: rank, cards: cards };
      }
    }
  }

  if (style !== 'balanced') {
    const move = styledMeld(view, style);
    if (move) return move;
    const card = chooseDiscard(view, style);
    return card ? { action: 'discard', card: card } : null;
  }

  // already down: feed open books first, biggest gain first
  const groups = byRank(me.hand);

  const adds = [];
  myMelds(view).forEach(function (m) {
    const st = E.meldStats(m, S);
    if (st.complete) return;
    const room = S.bookSize - m.cards.length;
    const naturals = naturalPlay(view, (groups[m.rank] || []).slice(0, room), m.rank, m);
    if (naturals.length) adds.push({ meld: m, cards: naturals, value: values(naturals, S) });
  });
  adds.sort(function (a, b) { return b.value - a.value; });
  for (const a of adds) {
    if (mayPlay(view, a.cards, a.meld.rank, a.meld)) {
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
          E.checkMeld(m.rank, m.cards.concat([spare[0]]), S).ok && mayPlay(view, [spare[0]], m.rank, m)) {
        return { action: 'meldAdd', meldId: m.id, cards: [spare[0]] };
      }
    }
  }

  // new melds from three or more of a rank
  const fresh = Object.keys(groups)
    .filter(function (r) { return !openMeld(view, r); })
    .map(function (r) {
      const cards = naturalPlay(view, groups[r].slice(0, S.bookSize), r, null);
      return { rank: r, cards: cards, value: values(cards, S) };
    })
    .filter(function (c) { return c.cards.length >= 3; });
  fresh.sort(function (a, b) { return b.value - a.value; });
  for (const f of fresh) {
    if (mayPlay(view, f.cards, f.rank, null)) {
      return { action: 'meldNew', rank: f.rank, cards: f.cards };
    }
  }

  /* A pair plus a wild is a legal book, and the single most common way to get a
   * stubborn pair out of your hand. planOpening has always known that; the rest
   * of the turn did not, so once the bot was down it sat on every pair it held
   * and its hand stopped emptying — which is why it so rarely reached its foot,
   * let alone went out. */
  if (spare.length) {
    const pairs = Object.keys(groups)
      .filter(function (r) {
        return groups[r].length === 2 && !openMeld(view, r);
      })
      .map(function (r) {
        const cards = groups[r].slice(0, 2).concat([spare[0]]);
        return { rank: r, cards: cards, value: values(cards, S) };
      });
    pairs.sort(function (a, b) { return b.value - a.value; });
    for (const p of pairs) {
      if (E.checkMeld(p.rank, p.cards, S).ok && mayPlay(view, p.cards, p.rank, null)) {
        return { action: 'meldNew', rank: p.rank, cards: p.cards };
      }
    }
  }

  /* Last resort, and the reason a hand stops clogging: a closed book still
   * takes cards of its rank. A second book of that rank would be worth more, so
   * this only runs once starting one has been ruled out — but a card parked on
   * a closed pile is a card you no longer have to go out around. Naturals only:
   * `groups` holds no wilds, so a red book can never be spoiled here. */
  const closedAdds = [];
  myMelds(view).forEach(function (m) {
    if (!E.meldStats(m, S).complete) return;
    const naturals = naturalPlay(view, groups[m.rank] || [], m.rank, m);
    if (naturals.length) {
      closedAdds.push({ meld: m, cards: naturals, value: values(naturals, S) });
    }
  });
  closedAdds.sort(function (a, b) { return b.value - a.value; });
  for (const a of closedAdds) {
    if (mayPlay(view, a.cards, a.meld.rank, a.meld)) {
      return { action: 'meldAdd', meldId: a.meld.id, cards: a.cards };
    }
  }

  const card = chooseDiscard(view);
  return card ? { action: 'discard', card: card } : null;
}

module.exports = { decide, chooseAction: decide, planOpening, chooseDiscard, layBudget, mayLay, STYLES };
