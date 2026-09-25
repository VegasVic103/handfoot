/* Turn logic and state transitions. Every action returns {ok, reason} and
 * mutates a plain-JSON state in place, so the caller can sync the whole doc.
 */

const E = require('./engine.js');

let meldSeq = 0;
const newMeldId = () => 'm' + (++meldSeq) + '-' + Math.random().toString(36).slice(2, 6);

function fail(reason, code) { return { ok: false, reason, code }; }
function done(extra) { return Object.assign({ ok: true }, extra || {}); }

function createGame(seatNames, settings) {
  const S = Object.assign({}, E.DEFAULTS, settings || {});
  return {
    v: 1,
    settings: S,
    phase: 'lobby',
    round: 0,
    seats: seatNames.map((n, i) => ({ name: n, seat: i })),
    turn: 0,
    turnPhase: 'draw',
    stocks: [],
    discard: [],
    players: seatNames.map(() => emptyPlayer()),
    turnState: null,
    scores: [],
    log: [],
  };
}

function emptyPlayer() {
  return {
    hand: [], foot: [], inFoot: false, melds: [],
    redThrees: [], hasInitialMeld: false, wentOut: false,
  };
}

function minMeldFor(state) {
  const m = state.settings.minMelds;
  return m[Math.min(state.round, m.length - 1)];
}

function startRound(state, rng) {
  const S = state.settings;
  const n = state.seats.length;
  const deckCount = n + 2;
  let stock = E.shuffle(E.buildDeck(deckCount), rng);

  state.players = state.seats.map(() => emptyPlayer());
  for (let i = 0; i < n; i++) {
    state.players[i].hand = stock.splice(0, S.handSize);
    state.players[i].foot = stock.splice(0, S.footSize);
  }

  // Under the lay-off rule a dealt red three goes face up at once and is
  // replaced; the replacement can itself be a red three, so keep drawing. This
  // table plays them as dead cards instead, so by default nothing happens here
  // and they stay in the hand to be discarded.
  if (S.redThreeAutoLayOff) {
    for (let i = 0; i < n; i++) {
      const p = state.players[i];
      for (let k = 0; k < p.hand.length; k++) {
        while (E.isRedThree(p.hand[k]) && stock.length) {
          p.redThrees.push(p.hand[k]);
          p.hand[k] = stock.shift();
        }
      }
    }
  }

  // Turn the first discard. A wild or a red three cannot start the pile.
  let first = stock.shift();
  while (E.isWild(first) || E.isRedThree(first)) {
    stock.push(first);
    first = stock.shift();
  }

  // Split what's left into the draw piles.
  state.stocks = splitPiles(stock, S.stockPiles);
  state.discard = [first];
  state.phase = 'playing';
  state.turn = state.round % n;
  state.turnPhase = 'draw';
  state.turnState = freshTurn(state);
  state.log = [{ t: 'round', round: state.round, min: minMeldFor(state) }];
  return done();
}

function snapOf(state, seat) {
  const p = state.players[seat];
  return JSON.stringify({
    hand: p.hand, foot: p.foot, inFoot: p.inFoot, melds: p.melds,
    hasInitialMeld: p.hasInitialMeld,
  });
}

function freshTurn(state) {
  return {
    melded: 0,
    tookPile: false,
    drew: false,
    pickedUpFoot: false,
    // Cards that came into the hand this turn, so the player can see at a
    // glance which ones are new. Only ever shown to the seat that holds them.
    picked: [],
    snapshot: snapOf(state, state.turn),
    logMark: state.logSeq || 0,
  };
}

/* Remember a card as newly in hand this turn. Tolerates a turnState built
 * before this field existed — a table restored from an older save, say — so a
 * missing list is created rather than thrown over. */
function notePicked(state, card) {
  const ts = state.turnState;
  if (!ts) return;
  if (!Array.isArray(ts.picked)) ts.picked = [];
  ts.picked.push(card);
}

/* ---------- draw ---------- */

function splitPiles(cards, n) {
  const piles = [];
  const base = Math.floor(cards.length / n);
  let extra = cards.length % n;   // spread the remainder so no pile is short
  let at = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    piles.push(cards.slice(at, at + size));
    at += size;
  }
  return piles;
}

function livePiles(state) {
  const out = [];
  (state.stocks || []).forEach((s, i) => { if (s.length) out.push(i); });
  return out;
}

function stockCount(state) {
  return (state.stocks || []).reduce((n, s) => n + s.length, 0);
}

function takeFrom(state, i) {
  const pile = state.stocks[i];
  return pile && pile.length ? pile.shift() : null;
}

function takeAny(state) {
  const live = livePiles(state);
  return live.length ? takeFrom(state, live[0]) : null;
}

/* `piles` names which draw piles the cards come from — one card from each, and
 * they must be different piles while enough piles still have cards. */
function drawStock(state, seat, piles) {
  const g = guard(state, seat, 'draw');
  if (!g.ok) return g;
  const S = state.settings;
  const p = state.players[seat];
  const live = livePiles(state);
  if (!live.length) return endRoundOutOfCards(state);

  let picks;
  if (live.length >= S.distinctDrawPiles) {
    picks = (piles || []).slice();
    if (picks.length !== S.drawCount) {
      return fail('Pick ' + S.drawCount + ' piles — one card from each.');
    }
    if (new Set(picks).size < Math.min(S.distinctDrawPiles, S.drawCount)) {
      return fail('Your two cards have to come from two different piles.');
    }
    for (const i of picks) {
      if (!state.stocks[i] || !state.stocks[i].length) {
        return fail('Pile ' + (i + 1) + ' is empty — pick another.');
      }
    }
  } else {
    // Too few piles left to spread the draw; take both from what remains.
    picks = [];
    for (let k = 0; k < S.drawCount; k++) picks.push(live[0]);
  }

  for (const idx of picks) {
    let c = takeFrom(state, idx);
    if (c === null) c = takeAny(state);
    if (c === null) return endRoundOutOfCards(state);
    // Under the lay-off rule a drawn red three goes face up and you draw again
    // from the same pile. Playing them as dead cards, it is just a card you now
    // have to get rid of, so it comes into the hand like any other.
    let guardCount = 0;
    while (S.redThreeAutoLayOff && E.isRedThree(c) && guardCount++ < 40) {
      p.redThrees.push(c);
      c = takeFrom(state, idx);
      if (c === null) c = takeAny(state);
      if (c === null) return endRoundOutOfCards(state);
    }
    p.hand.push(c);
    notePicked(state, c);
  }
  state.turnState.drew = true;
  state.turnPhase = 'play';
  // Undo rolls back melds laid this turn, never the draw itself.
  state.turnState.snapshot = snapOf(state, seat);
  log(state, { t: 'draw', seat, n: S.drawCount, piles: picks.map((i) => i + 1) });
  state.turnState.logMark = state.logSeq;   // the draw itself survives an undo
  return done();
}

/* Take the discard pile: top card + settings.pileTakeExtra behind it.
 * `handCards` are the cards from hand that will be melded with the top card. */
function takePile(state, seat, handCards) {
  const g = guard(state, seat, 'draw');
  if (!g.ok) return g;
  const S = state.settings;
  const p = state.players[seat];
  if (!state.discard.length) return fail('The discard pile is empty.');

  const top = state.discard[state.discard.length - 1];
  if (E.isBlackThree(top)) return fail('A black three on top freezes the pile.');
  // Threes never meld, so there is no pair of naturals that could take a red
  // three off the top either. Saying so plainly beats a puzzle about matching.
  if (E.isRedThree(top)) return fail('A red three on top freezes the pile.');
  if (E.isWild(top)) return fail('A wild on top freezes the pile.');

  const rank = E.rankOf(top);
  const chosen = (handCards || []).slice();
  if (!chosen.every((c) => p.hand.includes(c))) return fail('Those cards are not in your hand.');
  if (new Set(chosen).size !== chosen.length) return fail('Duplicate card in the selection.');

  const naturals = chosen.filter((c) => !E.isWild(c) && E.rankOf(c) === rank).length;
  if (naturals < S.pileNaturalsRequired) {
    return fail(`You need ${S.pileNaturalsRequired} natural ${E.rankName(rank)}s in hand to take the pile.`);
  }

  // The top card must be played with them, either into a new meld or an existing one.
  const existing = p.melds.find((m) => m.rank === rank && !E.meldStats(m, S).complete);
  const cards = chosen.concat([top]);
  let target = null;
  if (existing) {
    const combined = existing.cards.concat(cards);
    const chk = E.checkMeld(rank, combined, S);
    if (!chk.ok) return fail(chk.reason);
    target = existing;
  } else {
    const chk = E.checkMeld(rank, cards, S);
    if (!chk.ok) return fail(chk.reason);
  }

  const value = cards.reduce((s, c) => s + E.cardValue(c), 0);
  /* No initial-meld check here. Taking the pile is a draw, and at this table the
   * minimum is totalled across everything you lay in the turn — so two kings and
   * the king on top is 30 towards the 50, not a refusal. What it cannot do is
   * end the turn short: `discard` holds you to the minimum, and until you get
   * there `undo` hands the pile back. */
  const targetId = target ? target.id : null;
  /* The pile as it stands right now, so the take can be handed back card for
   * card. Taken here rather than at the start of the turn because this is the
   * only thing being undone, and a table restored from a save has no reliable
   * memory of what the pile looked like before its current turn began. */
  const pileBefore = state.discard.slice();
  const r = tx(state, seat, () => {
    const takeCount = Math.min(S.pileTakeExtra + 1, state.discard.length);
    const taken = state.discard.splice(state.discard.length - takeCount, takeCount);
    taken.pop(); // the top card goes into the meld, not the hand

    for (const c of chosen) p.hand.splice(p.hand.indexOf(c), 1);
    const live = targetId ? p.melds.find((m) => m.id === targetId) : null;
    if (live) live.cards = live.cards.concat(cards);
    else p.melds.push({ id: newMeldId(), rank, cards });

    for (const c of taken) {
      if (S.redThreeAutoLayOff && E.isRedThree(c)) p.redThrees.push(c);
      else { p.hand.push(c); notePicked(state, c); }
    }
    state.turnState.melded += value;
    log(state, { t: 'pile', seat, n: takeCount, rank });
    return afterHandShrink(state, seat);
  });
  if (!r.ok) return r;

  state.turnState.tookPile = true;
  state.turnState.pileSnapshot = pileBefore;
  state.turnState.drew = true;
  /* Down only if the take got you there on its own. Otherwise the turn carries
   * on owing the difference, and every meld you lay after this counts towards
   * it, because turnState.melded is what the check reads. */
  if (!p.hasInitialMeld && state.turnState.melded >= minMeldFor(state)) {
    p.hasInitialMeld = true;
  }
  state.turnPhase = 'play';
  return r;
}

/* ---------- melding ---------- */

function meldNew(state, seat, rank, cards) {
  const g = guard(state, seat, 'play');
  if (!g.ok) return g;
  const S = state.settings;
  const p = state.players[seat];
  /* A second book of a rank is allowed, but only once the one you have is
   * closed — otherwise you could spread the same rank across two half-books and
   * never finish either. */
  if (p.melds.some((m) => m.rank === rank && m.cards.length < S.bookSize)) {
    return fail(`You already have an open ${E.rankName(rank)} book — add to it instead.`);
  }
  const owned = cards.every((c) => p.hand.includes(c));
  if (!owned) return fail('Those cards are not in your hand.');
  const chk = E.checkMeld(rank, cards, S);
  if (!chk.ok) return fail(chk.reason);

  return tx(state, seat, () => {
    for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
    p.melds.push({ id: newMeldId(), rank, cards: cards.slice() });
    state.turnState.melded += cards.reduce((s, c) => s + E.cardValue(c), 0);
    log(state, { t: 'meld', seat, rank, n: cards.length });
    return afterHandShrink(state, seat);
  });
}

function meldAdd(state, seat, meldId, cards) {
  const g = guard(state, seat, 'play');
  if (!g.ok) return g;
  const S = state.settings;
  const p = state.players[seat];
  const m = p.melds.find((x) => x.id === meldId);
  if (!m) return fail('No such meld.');
  if (!cards.every((c) => p.hand.includes(c))) return fail('Those cards are not in your hand.');
  /* A closed book keeps taking cards, but a red one must stay red: slipping a
   * wild onto it would quietly turn 500 points into 300. Start a second book of
   * the rank for that wild instead. */
  const st = E.meldStats(m, S);
  if (st.complete && st.wilds === 0 && cards.some((c) => E.isWild(c))) {
    return fail('That is a red book — a wild would turn it black. Start another book of that rank.');
  }
  const chk = E.checkMeld(m.rank, m.cards.concat(cards), S);
  if (!chk.ok) return fail(chk.reason);

  return tx(state, seat, () => {
    const live = p.melds.find((x) => x.id === meldId);
    for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
    live.cards = live.cards.concat(cards);
    state.turnState.melded += cards.reduce((s, c) => s + E.cardValue(c), 0);
    log(state, { t: 'meld', seat, rank: live.rank, n: cards.length });
    return afterHandShrink(state, seat);
  });
}

/* Run a play, then check it left the player somewhere legal; roll back if not.
 * Without this a player in their foot can meld down to one card they are not
 * allowed to discard, because discarding it would go out without the books. */
function tx(state, seat, apply) {
  const p = state.players[seat];
  const before = {
    hand: p.hand.slice(), foot: p.foot.slice(), inFoot: p.inFoot,
    melds: JSON.parse(JSON.stringify(p.melds)),
    redThrees: p.redThrees.slice(),
    discard: state.discard.slice(),
    melded: state.turnState.melded,
    logLen: state.log.length,
  };
  const r = apply();
  const legal = r.ok ? legalToStop(state, seat) : done();
  if (!r.ok || !legal.ok) {
    p.hand = before.hand; p.foot = before.foot; p.inFoot = before.inFoot;
    p.melds = before.melds; p.redThrees = before.redThrees;
    state.discard = before.discard;
    state.turnState.melded = before.melded;
    state.log.length = before.logLen;
    return r.ok ? legal : r;
  }
  /* Playing your last card from your foot is how you go out at this table:
   * every card has to land in a meld and there is no final discard. Checked
   * here rather than inside the play, because ending the round writes the
   * scores and is not something the rollback above could undo. */
  if (p.inFoot && p.hand.length === 0 && canGoOut(state, seat).ok) {
    p.wentOut = true;
    return endRound(state, seat);
  }
  return r;
}

/* After a play, a player in their foot must still be able to finish the turn
 * holding something. Once you are in your foot you may never be left with an
 * empty hand unless you are going out, so a turn that ends in a discard needs
 * two cards: one to throw and one to keep. */
function legalToStop(state, seat) {
  const p = state.players[seat];
  if (!p.inFoot) return done();
  /* A red three counts as a card you can discard, because under this table's
   * rule discarding it is exactly how you get rid of one. It only stops being a
   * legal discard under the lay-off rule, where it never reaches the hand. */
  const live = state.settings.redThreeAutoLayOff
    ? p.hand.filter((c) => !E.isRedThree(c)).length
    : p.hand.length;
  const out = canGoOut(state, seat);

  /* Nothing left at all. The only legal way to be here is going out, which at
   * this table means every card played into a meld and none discarded. */
  if (p.hand.length === 0) {
    if (out.ok) return done();
    return fail('Keep a card to discard unless you are going out — ' + out.reason.toLowerCase(),
      'foot_empty');
  }
  // Two cards: one to discard, and one still in hand when the turn ends.
  if (live >= 1 && p.hand.length >= 2) return done();
  /* Down to one. Allowed only while you are on your way out — you already hold
   * the books, so that last card can still go into a meld. Stopping here is
   * caught by the discard, which refuses to empty your hand. Without this a
   * going out that takes two separate melds could never be played, because the
   * state in between them would be rolled back. */
  if (out.ok) return done();
  if (live === 0) {
    return fail('Nothing left that you are allowed to discard — ' + out.reason.toLowerCase(),
      'foot_no_discard');
  }
  return fail('In your foot, keep two cards back — one to discard and one to hold on to — ' +
    'unless you are going out. ' + out.reason, 'foot_keep_two');
}

/* Emptying the hand picks up the foot and the turn continues. */
function afterHandShrink(state, seat) {
  const p = state.players[seat];
  if (p.hand.length === 0 && !p.inFoot) {
    p.hand = p.foot;
    p.foot = [];
    p.inFoot = true;
    state.turnState.pickedUpFoot = true;
    // Under the lay-off rule, red threes carried in the foot go face up at
    // once. Played as dead cards they simply come up with the rest of it.
    if (state.settings.redThreeAutoLayOff) {
      for (let k = p.hand.length - 1; k >= 0; k--) {
        if (E.isRedThree(p.hand[k])) p.redThrees.push(p.hand.splice(k, 1)[0]);
      }
    }
    log(state, { t: 'foot', seat });
    return done({ pickedUpFoot: true });
  }
  return done();
}

/* ---------- discard and going out ---------- */

function canGoOut(state, seat) {
  const S = state.settings;
  const p = state.players[seat];
  if (!p.inFoot) return { ok: false, reason: 'You must be in your foot.' };
  let red = 0, black = 0;
  for (const m of p.melds) {
    const st = E.meldStats(m, S);
    if (st.isRedBook) red++;
    if (st.isBlackBook || st.isWildBook) black++;
  }
  if (red < S.requireRedBook) return { ok: false, reason: `You need ${S.requireRedBook} red book.` };
  if (black < S.requireBlackBook) return { ok: false, reason: `You need ${S.requireBlackBook} black book.` };
  return { ok: true };
}

function discard(state, seat, card) {
  const g = guard(state, seat, 'play');
  if (!g.ok) return g;
  const S = state.settings;
  const p = state.players[seat];
  if (!state.turnState.drew) return fail('Draw first.');
  if (!p.hand.includes(card)) return fail('That card is not in your hand.');
  // Discarding a red three is how you get rid of one. Only the other rule, where
  // it goes face up the moment it arrives, puts it out of reach.
  if (S.redThreeAutoLayOff && E.isRedThree(card)) {
    return fail('Red threes are laid off, not discarded.');
  }
  /* In your foot you may never be left holding nothing. Going out is the one
   * way to end a turn empty-handed, and going out has no discard at all —
   * every card goes into a meld — so a discard that empties your hand is
   * always illegal here, books or no books. Checked before anything is moved,
   * so a refusal costs the player nothing. */
  if (p.inFoot && p.hand.length === 1) {
    return fail('That is your last card. In your foot you have to keep one — ' +
      'the only way to finish with an empty hand is to go out, which means ' +
      'melding it instead of discarding it.', 'foot_last_card');
  }

  if (!p.hasInitialMeld && state.turnState.melded > 0) {
    const need = minMeldFor(state);
    if (state.turnState.melded < need) {
      // Short on purpose: this lands in a one-line bar on a phone, and the way
      // out of it is the "Take melds back" button sitting right beside it.
      return fail(`Going down needs ${need} — you have laid ${state.turnState.melded}.`, 'initial_meld_short');
    }
  }
  if (state.turnState.melded > 0 && !p.hasInitialMeld) p.hasInitialMeld = true;

  p.hand.splice(p.hand.indexOf(card), 1);
  state.discard.push(card);
  log(state, { t: 'discard', seat, card });

  /* A discard never goes out — going out is melding your last card, handled in
   * tx. Emptying your hand this way just leaves you with nothing until you draw
   * again, which is legal and sometimes the only move you have. */
  if (p.hand.length === 0 && !p.inFoot) {
    p.hand = p.foot;
    p.foot = [];
    p.inFoot = true;
    if (S.redThreeAutoLayOff) {
      for (let k = p.hand.length - 1; k >= 0; k--) {
        if (E.isRedThree(p.hand[k])) p.redThrees.push(p.hand.splice(k, 1)[0]);
      }
    }
    log(state, { t: 'foot', seat });
  }
  return nextTurn(state);
}

function undoTurnMelds(state, seat) {
  if (state.turn !== seat) return fail('Not your turn.');
  const ts = state.turnState;
  if (!ts || !ts.snapshot) return fail('Nothing to undo.');
  const snap = JSON.parse(ts.snapshot);
  const p = state.players[seat];
  p.hand = snap.hand; p.foot = snap.foot; p.inFoot = snap.inFoot; p.melds = snap.melds;
  /* Going down is part of what the turn did, so taking the melds back takes that
   * back too — otherwise a turn you undid would still have opened your account. */
  if (typeof snap.hasInitialMeld === 'boolean') p.hasInitialMeld = snap.hasInitialMeld;
  /* Taking the pile back puts every card of it where it was and returns you to
   * the draw, so the turn starts over rather than stranding you mid-way. A
   * normal draw is not undone: those cards came off a stock nobody can see. */
  if (ts.tookPile && ts.pileSnapshot) {
    state.discard = ts.pileSnapshot.slice();
    ts.tookPile = false;
    ts.pileSnapshot = null;
    ts.drew = false;
    ts.picked = [];
    state.turnPhase = 'draw';
  }
  ts.melded = 0;
  ts.pickedUpFoot = false;
  // The melds are off the table again, so the lines announcing them should go
  // too — otherwise the history reads as though they were laid twice.
  if (typeof ts.logMark === 'number') {
    state.log = state.log.filter(function (e) { return !e.id || e.id <= ts.logMark; });
  }
  return done();
}

function nextTurn(state) {
  state.turn = (state.turn + 1) % state.seats.length;
  state.turnPhase = 'draw';
  state.turnState = freshTurn(state);
  return done();
}

function guard(state, seat, phase) {
  if (state.phase !== 'playing') return fail('The round is not in play.');
  if (state.turn !== seat) return fail('Not your turn.');
  if (phase === 'draw' && state.turnPhase !== 'draw') return fail('You have already drawn.');
  if (phase === 'play' && state.turnPhase !== 'play') return fail('Draw first.');
  return done();
}

/* Each entry carries a rising id so that taking melds back can remove exactly
 * the lines it undid. Plain counting would not do it: the log is trimmed from
 * the front once it is long, which shifts every position. */
function log(state, entry) {
  state.logSeq = (state.logSeq || 0) + 1;
  entry.id = state.logSeq;
  state.log.push(entry);
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

/* A house rule changed mid-game. It goes in the log so nobody looks up to find
 * the table playing differently than it was a minute ago. */
function logRule(state, seat, key, value) {
  log(state, { t: 'rule', seat, key, value: !!value });
}

/* The cards a pile-take would bring in: the top card and the ones behind it,
 * top last, exactly as takePile would splice them off. Never more than a take
 * would actually reach, so showing this can never become a window onto the
 * rest of the pile. */
function pileTakeCards(state) {
  const n = Math.min(state.settings.pileTakeExtra + 1, state.discard.length);
  return n > 0 ? state.discard.slice(state.discard.length - n) : [];
}

/* ---------- scoring ---------- */

function scoreRound(state) {
  const S = state.settings;
  return state.players.map((p) => {
    let redPts = 0, blackPts = 0, red = 0, black = 0, meldPts = 0;
    for (const m of p.melds) {
      const st = E.meldStats(m, S);
      if (st.isRedBook) { redPts += S.redBookBonus; red++; }
      else if (st.isBlackBook || st.isWildBook) { blackPts += S.blackBookBonus; black++; }
      meldPts += m.cards.reduce((s, c) => s + E.cardValue(c), 0);
    }
    /* The sheet the table keeps: books, what is on the table against what is in
     * your hand, and the bonus for going out. A red three needs no column of its
     * own — it is simply an expensive card to be caught with, 100 against you
     * inside the hand count like any other card. cardValue already prices it,
     * and ones laid off under the other rule are added back here. */
    const held = p.hand.concat(p.foot);
    const handCount = held.reduce((s, c) => s + E.cardValue(c), 0) +
      p.redThrees.length * Math.abs(S.redThreeValue);
    const tableCount = meldPts - handCount;
    const out = p.wentOut ? S.goOutBonus : 0;
    return {
      redPts, blackPts, redBooks: red, blackBooks: black,
      meldPts, handCount, tableCount, out,
      total: redPts + blackPts + tableCount + out,
    };
  });
}

function endRound(state, outSeat) {
  const rows = scoreRound(state);
  state.scores.push(rows.map((r) => r.total));
  state.roundDetail = rows;
  state.phase = 'roundEnd';
  state.outSeat = typeof outSeat === 'number' ? outSeat : null;
  log(state, { t: 'end', seat: outSeat });
  return done({ roundEnded: true });
}

function endRoundOutOfCards(state) {
  log(state, { t: 'stockout' });
  return endRound(state, null);
}

function nextRound(state) {
  if (state.round + 1 >= state.settings.minMelds.length) {
    state.phase = 'gameEnd';
    return done({ gameEnded: true });
  }
  state.round += 1;
  state.roundDetail = null;
  state.outSeat = null;
  return startRound(state);
}

function totals(state) {
  return state.seats.map((_, i) => state.scores.reduce((s, r) => s + (r[i] || 0), 0));
}

module.exports = {
  createGame, startRound, drawStock, takePile, meldNew, meldAdd,
  discard, undoTurnMelds, canGoOut, scoreRound, endRound, nextRound,
  totals, minMeldFor, emptyPlayer, stockCount, livePiles, splitPiles,
  logRule, pileTakeCards,
};
