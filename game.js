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

  // Red threes dealt into a hand are laid off immediately and replaced. The
  // replacement can itself be a red three, so keep drawing until it is not.
  for (let i = 0; i < n; i++) {
    const p = state.players[i];
    for (let k = 0; k < p.hand.length; k++) {
      while (E.isRedThree(p.hand[k]) && stock.length) {
        p.redThrees.push(p.hand[k]);
        p.hand[k] = stock.shift();
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
  return JSON.stringify({ hand: p.hand, foot: p.foot, inFoot: p.inFoot, melds: p.melds });
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
    // Drawing a red three: lay it off and draw again from the same pile.
    let guardCount = 0;
    while (E.isRedThree(c) && guardCount++ < 40) {
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
  if (!p.hasInitialMeld) {
    const need = minMeldFor(state);
    const total = state.turnState.melded + value;
    if (total < need) {
      return fail(`Going down needs at least ${need} points — this comes to ${total}. Add more matching cards from your hand to the selection.`, 'initial_meld_short');
    }
  }

  const targetId = target ? target.id : null;
  const r = tx(state, seat, () => {
    const takeCount = Math.min(S.pileTakeExtra + 1, state.discard.length);
    const taken = state.discard.splice(state.discard.length - takeCount, takeCount);
    taken.pop(); // the top card goes into the meld, not the hand

    for (const c of chosen) p.hand.splice(p.hand.indexOf(c), 1);
    const live = targetId ? p.melds.find((m) => m.id === targetId) : null;
    if (live) live.cards = live.cards.concat(cards);
    else p.melds.push({ id: newMeldId(), rank, cards });

    for (const c of taken) {
      if (E.isRedThree(c)) p.redThrees.push(c);
      else { p.hand.push(c); notePicked(state, c); }
    }
    state.turnState.melded += value;
    log(state, { t: 'pile', seat, n: takeCount, rank });
    return afterHandShrink(state, seat);
  });
  if (!r.ok) return r;

  state.turnState.tookPile = true;
  state.turnState.drew = true;
  if (!p.hasInitialMeld) p.hasInitialMeld = true;
  state.turnPhase = 'play';
  return r;
}

/* ---------- melding ---------- */

function meldNew(state, seat, rank, cards) {
  const g = guard(state, seat, 'play');
  if (!g.ok) return g;
  const S = state.settings;
  const p = state.players[seat];
  if (p.melds.some((m) => m.rank === rank)) {
    return fail(`You already have a ${E.rankName(rank)} meld — add to it instead.`);
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
  if (E.meldStats(m, S).complete) return fail('That book is closed.');
  if (!cards.every((c) => p.hand.includes(c))) return fail('Those cards are not in your hand.');
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
  return r;
}

/* After a play, a player in their foot must still have a legal discard. */
function legalToStop(state, seat) {
  const p = state.players[seat];
  if (!p.inFoot) return done();
  const live = p.hand.filter((c) => !E.isRedThree(c)).length;
  if (live >= 2) return done();
  if (live === 1) {
    const out = canGoOut(state, seat);
    if (out.ok) return done();
    return fail('Keep two cards unless you can go out — ' + out.reason.toLowerCase());
  }
  return fail('Keep a card to discard — you cannot meld your last card.');
}

/* Emptying the hand picks up the foot and the turn continues. */
function afterHandShrink(state, seat) {
  const p = state.players[seat];
  if (p.hand.length === 0 && !p.inFoot) {
    p.hand = p.foot;
    p.foot = [];
    p.inFoot = true;
    state.turnState.pickedUpFoot = true;
    // Red threes carried in the foot lay off at once.
    for (let k = p.hand.length - 1; k >= 0; k--) {
      if (E.isRedThree(p.hand[k])) p.redThrees.push(p.hand.splice(k, 1)[0]);
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
  if (E.isRedThree(card)) return fail('Red threes are laid off, not discarded.');

  if (!p.hasInitialMeld && state.turnState.melded > 0) {
    const need = minMeldFor(state);
    if (state.turnState.melded < need) {
      return fail(`Going down needs at least ${need} points, counted across every meld you lay this turn. You have laid ${state.turnState.melded} so far — lay more, or take the cards back.`, 'initial_meld_short');
    }
  }
  if (state.turnState.melded > 0 && !p.hasInitialMeld) p.hasInitialMeld = true;

  const willEmpty = p.hand.length === 1;
  if (willEmpty && p.inFoot) {
    const out = canGoOut(state, seat);
    if (!out.ok) return fail('You cannot go out yet: ' + out.reason);
  }

  p.hand.splice(p.hand.indexOf(card), 1);
  state.discard.push(card);
  log(state, { t: 'discard', seat, card });

  if (p.hand.length === 0 && p.inFoot) {
    p.wentOut = true;
    return endRound(state, seat);
  }
  if (p.hand.length === 0 && !p.inFoot) {
    p.hand = p.foot;
    p.foot = [];
    p.inFoot = true;
    for (let k = p.hand.length - 1; k >= 0; k--) {
      if (E.isRedThree(p.hand[k])) p.redThrees.push(p.hand.splice(k, 1)[0]);
    }
    log(state, { t: 'foot', seat });
  }
  return nextTurn(state);
}

function undoTurnMelds(state, seat) {
  if (state.turn !== seat) return fail('Not your turn.');
  const ts = state.turnState;
  if (!ts || !ts.snapshot) return fail('Nothing to undo.');
  if (ts.tookPile) return fail('You cannot undo after taking the pile.');
  const snap = JSON.parse(ts.snapshot);
  const p = state.players[seat];
  p.hand = snap.hand; p.foot = snap.foot; p.inFoot = snap.inFoot; p.melds = snap.melds;
  ts.melded = 0;
  ts.pickedUpFoot = false;
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

function log(state, entry) {
  state.log.push(entry);
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

/* ---------- scoring ---------- */

function scoreRound(state) {
  const S = state.settings;
  return state.players.map((p) => {
    let books = 0, red = 0, black = 0, meldPts = 0;
    for (const m of p.melds) {
      const st = E.meldStats(m, S);
      if (st.isRedBook) { books += S.redBookBonus; red++; }
      else if (st.isBlackBook || st.isWildBook) { books += S.blackBookBonus; black++; }
      meldPts += m.cards.reduce((s, c) => s + E.cardValue(c), 0);
    }
    const left = p.hand.concat(p.foot).reduce((s, c) => s + E.cardValue(c), 0);
    const threes = p.redThrees.length * S.redThreeValue;
    const out = p.wentOut ? S.goOutBonus : 0;
    return {
      books, meldPts, left, threes, out, redBooks: red, blackBooks: black,
      total: books + meldPts + threes + out - left,
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
};
