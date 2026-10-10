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
  S.minMelds = S.minMelds.slice();
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
    reshufflesUsed: 0,
  };
}

function emptyPlayer() {
  return {
    hand: [], foot: [], inFoot: false, melds: [],
    redThrees: [], hasInitialMeld: false, wentOut: false, handChoice: null,
  };
}

function minMeldFor(state) {
  const m = state.settings.minMelds;
  return m[Math.min(state.round, m.length - 1)];
}

function startRound(state, rng, deferHandChoice = false) {
  const n = state.seats.length;
  const checked = E.validateSettings({}, n, state.pendingSettings || state.settings);
  if (!checked.ok) return fail(checked.reason, 'invalid_settings');
  const S = checked.settings;
  const deckCount = E.deckCountFor(S, n);
  let stock = E.shuffle(E.buildDeck(deckCount), rng);

  // Reserve a legal initial discard before dealing. Even a deliberately small
  // custom deck must not leave a remaining stock made entirely of wilds.
  const firstAt = stock.findIndex(card => !E.isWild(card) && !E.isRedThree(card));
  if (firstAt < 0) return fail('These decks cannot supply a starting discard.', 'invalid_settings');
  const first = stock.splice(firstAt, 1)[0];

  state.settings = S;
  delete state.pendingSettings;
  state.reshufflesUsed = 0;
  state.roundBeginsAt = 0;
  state.players = state.seats.map(() => emptyPlayer());
  for (let i = 0; i < n; i++) {
    state.players[i].hand = stock.splice(0, S.handSize);
    state.players[i].foot = stock.splice(0, S.footSize);
  }

  state.stocks = splitPiles(stock, S.stockPiles);
  state.discard = [first];
  state.phase = 'choosing';
  state.turn = state.round % n;
  state.turnPhase = 'draw';
  state.turnState = null;
  state.log = [{ t: 'round', round: state.round, min: minMeldFor(state) }];
  // The server always defers. Pure engine simulations can keep their existing
  // ready-to-play setup by accepting the originally assigned piles here.
  if (!deferHandChoice) {
    state.players.forEach(p => { p.handChoice = 0; });
    finishHandChoices(state);
  }
  return done();
}

function finishHandChoices(state) {
  // Red threes cannot reveal or alter either face-down pile before a choice.
  // Once every seat has committed, process the selected hands in seat order.
  const stock = state.stocks.flat();
  if (state.settings.redThreeAutoLayOff) {
    state.players.forEach((p, seat) => {
      receiveCards(state, seat, p.hand.splice(0), () => stock.length ? stock.shift() : null, false);
    });
  }
  state.stocks = splitPiles(stock, state.settings.stockPiles);
  state.phase = 'playing';
  state.turnState = freshTurn(state);
}

function chooseHand(state, seat, pile) {
  if (state.phase !== 'choosing') return fail('The hand choice for this deal has finished.');
  if (!Number.isInteger(seat) || !state.players[seat]) return fail('Choose only your own piles.');
  if (pile !== 0 && pile !== 1) return fail('Choose one of your two face-down piles.');
  const p = state.players[seat];
  if (p.handChoice !== null) return fail('Your hand is already chosen for this deal.');
  if (state.settings.handSize !== state.settings.footSize && pile !== 0) {
    return fail('Different hand and foot sizes keep their assigned piles. Confirm the assigned hand.');
  }
  if (pile === 1) [p.hand, p.foot] = [p.foot, p.hand];
  p.handChoice = pile;
  const remaining = state.players.filter(player => player.handChoice === null).length;
  if (!remaining) finishHandChoices(state);
  return done({ handChosen: true, remaining });
}

function snapOf(state, seat) {
  const p = state.players[seat];
  return JSON.stringify({
    hand: p.hand, foot: p.foot, inFoot: p.inFoot, melds: p.melds,
    redThrees: p.redThrees, hasInitialMeld: p.hasInitialMeld,
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

/* Every arrival uses the same replacement chain. The caller controls where
 * replacements come from and when an exhausted stock ends the round. Finish
 * moving the whole packet even when replacements run out, so no cards vanish. */
function receiveCards(state, seat, cards, replace, highlight = true) {
  const p = state.players[seat];
  let exhausted = false;
  for (let card of cards) {
    while (state.settings.redThreeAutoLayOff && E.isRedThree(card)) {
      p.redThrees.push(card);
      card = exhausted ? null : replace();
      if (card === null) { exhausted = true; break; }
    }
    if (card !== null) {
      p.hand.push(card);
      if (highlight) notePicked(state, card);
    }
  }
  return !exhausted;
}

/* Pile and foot arrivals can draw replacements during a reversible play.
 * Capture only when needed; a normal stock draw and its recycle stay outside
 * this snapshot and therefore survive Undo melds. */
function receiveFromPlay(state, seat, cards, highlight = true) {
  const replaces = state.settings.redThreeAutoLayOff && cards.some(E.isRedThree);
  if (!replaces) {
    receiveCards(state, seat, cards, () => null, highlight);
    return done();
  }
  const ts = state.turnState;
  if (!ts.arrivalSnapshot) {
    ts.arrivalSnapshot = {
      stocks: state.stocks.map(pile => pile.slice()), discard: state.discard.slice(),
      reshufflesUsed: state.reshufflesUsed, logMark: state.logSeq || 0,
    };
  }
  let terminal = false;
  let reshuffled = false;
  const received = receiveCards(state, seat, cards, () => {
    let card = takeAny(state);
    if (card !== null) return card;
    const result = checkStockExhaustion(state, true, undefined, true);
    terminal = !!result.stockExhausted;
    reshuffled = reshuffled || !!result.reshuffled;
    return terminal ? null : takeAny(state);
  }, highlight);
  if (received && state.settings.reshuffleOnce) {
    const result = checkStockExhaustion(state, false, undefined, true);
    terminal = !!result.stockExhausted;
    reshuffled = reshuffled || !!result.reshuffled;
  }
  return done({ stockExhausted: terminal || !received, reshuffled });
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

/* Complete a draw before testing individual pile exhaustion. The drawn cards
 * belong to the player's hand and are never part of this recycling pool. */
function checkStockExhaustion(state, forced, rng, deferEnd = false) {
  const exhausted = () => deferEnd ? done({ stockExhausted: true }) : endRoundOutOfCards(state);
  if (!forced && state.stocks.every(pile => pile.length > 0)) return done();
  if (!state.settings.reshuffleOnce) {
    return stockCount(state) === 0 ? exhausted() : done();
  }
  if ((state.reshufflesUsed || 0) >= 1) return exhausted();
  const top = state.discard.length ? state.discard[state.discard.length - 1] : null;
  const pool = state.stocks.flat().concat(top ? state.discard.slice(0, -1) : state.discard);
  state.stocks = splitPiles(E.shuffle(pool, rng), state.settings.stockPiles);
  state.discard = top ? [top] : [];
  state.reshufflesUsed = 1;
  log(state, { t: 'reshuffle', n: pool.length, remaining: 0 });
  // Fewer than four recyclable cards cannot refill all four piles. The second
  // exhaustion has already occurred, so score rather than create a dead turn.
  if (state.stocks.some(pile => !pile.length)) return exhausted();
  return done({ reshuffled: true });
}

/* `piles` names which draw piles the cards come from — one card from each, and
 * they must be different piles while enough piles still have cards. */
function drawStock(state, seat, piles) {
  const g = guard(state, seat, 'draw');
  if (!g.ok) return g;
  const S = state.settings;
  const p = state.players[seat];
  let live = livePiles(state);
  if (!live.length) {
    const exhausted = checkStockExhaustion(state, true);
    if (state.phase !== 'playing') return exhausted;
    live = livePiles(state);
    if (!Array.isArray(piles) || piles.length !== S.drawCount) piles = live.slice(0, S.drawCount);
  }

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

  const before = {
    stocks: state.stocks.map(pile => pile.slice()), hand: p.hand.slice(),
    redThrees: p.redThrees.slice(), picked: state.turnState.picked && state.turnState.picked.slice(),
  };
  function exhaustedDuringReplacement() {
    // An exceptional chain of red-three replacements can exhaust every card.
    // Roll back the whole attempted draw before recycling and retrying, so no
    // partial draw is committed and no card is duplicated or left behind.
    state.stocks = before.stocks; p.hand = before.hand; p.redThrees = before.redThrees;
    state.turnState.picked = before.picked || [];
    if (!S.reshuffleOnce || (state.reshufflesUsed || 0) >= 1) return endRoundOutOfCards(state);
    const result = checkStockExhaustion(state, true);
    if (state.phase !== 'playing') return result;
    return drawStock(state, seat, picks);
  }
  let drawn = 0;
  for (const idx of picks) {
    let c = takeFrom(state, idx);
    if (c === null) c = takeAny(state);
    if (c === null) {
      // With recycling off, the final available card still gets a last turn.
      if (!S.reshuffleOnce) break;
      return exhaustedDuringReplacement();
    }
    // Under the lay-off rule a drawn red three goes face up and you draw again
    // from the same pile. Playing them as dead cards, it is just a card you now
    // have to get rid of, so it comes into the hand like any other.
    if (!receiveCards(state, seat, [c], () => takeFrom(state, idx) || takeAny(state))) {
      return exhaustedDuringReplacement();
    }
    drawn++;
  }
  state.turnState.drew = true;
  state.turnPhase = 'play';
  // Undo rolls back melds laid this turn, never the draw itself.
  state.turnState.snapshot = snapOf(state, seat);
  log(state, { t: 'draw', seat, n: drawn, piles: picks.slice(0, drawn).map((i) => i + 1) });
  state.turnState.logMark = state.logSeq;   // the draw itself survives an undo
  if (S.reshuffleOnce) return checkStockExhaustion(state, false);
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

  const value = cards.reduce((s, c) => s + E.cardValue(c, S), 0);
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

    const arrival = receiveFromPlay(state, seat, taken);
    state.turnState.melded += value;
    log(state, { t: 'pile', seat, n: takeCount, rank });
    if (arrival.stockExhausted) return arrival;
    return Object.assign(arrival, afterHandShrink(state, seat));
  });
  if (!r.ok) return r;
  if (r.roundEnded) return r;

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
  if (!Array.isArray(cards) || !cards.length) return fail('Select cards to meld.');
  if (new Set(cards).size !== cards.length) return fail('Duplicate card in the selection.');
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
    state.turnState.melded += cards.reduce((s, c) => s + E.cardValue(c, S), 0);
    log(state, { t: 'meld', seat, rank, n: cards.length });
    return afterHandShrink(state, seat);
  });
}

function meldAdd(state, seat, meldId, cards) {
  const g = guard(state, seat, 'play');
  if (!g.ok) return g;
  const S = state.settings;
  const p = state.players[seat];
  if (!Array.isArray(cards) || !cards.length) return fail('Select cards to add.');
  if (new Set(cards).size !== cards.length) return fail('Duplicate card in the selection.');
  const m = p.melds.find((x) => x.id === meldId);
  if (!m) return fail('No such meld.');
  if (!cards.every((c) => p.hand.includes(c))) return fail('Those cards are not in your hand.');
  /* A closed book keeps taking cards, but a red one must stay red: slipping a
   * wild onto it would quietly turn 500 points into 300. Start a second book of
   * the rank for that wild instead. */
  const st = E.meldStats(m, S);
  if (st.complete && S.closedBooksLocked) return fail('That book is complete. Start another book of that rank.');
  if (st.complete && st.wilds === 0 && cards.some((c) => E.isWild(c))) {
    return fail('That is a red book — a wild would turn it black. Start another book of that rank.');
  }
  const chk = E.checkMeld(m.rank, m.cards.concat(cards), S);
  if (!chk.ok) return fail(chk.reason);

  return tx(state, seat, () => {
    const live = p.melds.find((x) => x.id === meldId);
    for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
    live.cards = live.cards.concat(cards);
    state.turnState.melded += cards.reduce((s, c) => s + E.cardValue(c, S), 0);
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
    stocks: state.settings.redThreeAutoLayOff ? state.stocks.map(pile => pile.slice()) : null,
    reshufflesUsed: state.reshufflesUsed,
    discard: state.discard.slice(),
    turnState: JSON.parse(JSON.stringify(state.turnState)),
    log: state.log.slice(), logSeq: state.logSeq,
  };
  const r = apply();
  // Exhaustion during an arrival is terminal, not an illegal empty-foot move.
  // All cards are now in their final zones; score only after the play finishes.
  if (r.ok && r.stockExhausted) return endRoundOutOfCards(state);
  let legal = r.ok ? legalToStop(state, seat) : done();
  // Going out has no discard, so it must enforce the opening minimum here as
  // well. Otherwise two inexpensive books can finish a later round short.
  if (r.ok && legal.ok && p.inFoot && p.hand.length === 0 &&
      !p.hasInitialMeld && state.turnState.melded < minMeldFor(state)) {
    legal = fail(`Going down needs ${minMeldFor(state)} — you have laid ${state.turnState.melded}.`,
      'initial_meld_short');
  }
  if (!r.ok || !legal.ok) {
    p.hand = before.hand; p.foot = before.foot; p.inFoot = before.inFoot;
    p.melds = before.melds; p.redThrees = before.redThrees;
    if (before.stocks) state.stocks = before.stocks;
    state.reshufflesUsed = before.reshufflesUsed;
    state.discard = before.discard;
    state.turnState = before.turnState;
    state.log = before.log; state.logSeq = before.logSeq;
    return r.ok ? legal : r;
  }
  /* Playing your last card from your foot is how you go out at this table:
   * every card has to land in a meld and there is no final discard. Checked
   * here rather than inside the play, because ending the round writes the
   * scores and is not something the rollback above could undo. */
  if (!state.settings.goOutWithDiscard && p.inFoot && p.hand.length === 0 && canGoOut(state, seat).ok) {
    p.hasInitialMeld = true;
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
    if (state.settings.goOutWithDiscard) return fail('Keep your final card to discard when going out.', 'final_discard_required');
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
    const foot = p.foot;
    p.foot = [];
    p.inFoot = true;
    state.turnState.pickedUpFoot = true;
    const arrival = receiveFromPlay(state, seat, foot, false);
    log(state, { t: 'foot', seat });
    return Object.assign(arrival, { pickedUpFoot: true });
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
  if (p.inFoot && p.hand.length === 1 && !(S.goOutWithDiscard && canGoOut(state, seat).ok)) {
    if (S.goOutWithDiscard) return fail('You cannot go out yet. ' + canGoOut(state, seat).reason, 'foot_last_card');
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
  if (S.goOutWithDiscard && p.inFoot && p.hand.length === 0) {
    p.wentOut = true;
    return endRound(state, seat);
  }

  /* A discard never goes out — going out is melding your last card, handled in
   * tx. Emptying your hand this way just leaves you with nothing until you draw
   * again, which is legal and sometimes the only move you have. */
  if (p.hand.length === 0 && !p.inFoot) {
    const arrival = afterHandShrink(state, seat);
    if (arrival.stockExhausted) return endRoundOutOfCards(state);
  }
  return nextTurn(state);
}

/* A partial undo may only return a wild placed during this turn. Earlier
 * turns, completed books and transitions into the foot cannot be rewritten. */
function returnableWilds(state, seat) {
  if (!guard(state, seat, 'play').ok) return [];
  const ts = state.turnState, p = state.players[seat], S = state.settings;
  if (!ts || !ts.snapshot || ts.pickedUpFoot) return [];
  let snap;
  try { snap = JSON.parse(ts.snapshot); } catch (_) { return []; }
  const oldCards = new Set((snap.melds || []).flatMap(m => m.cards));
  const out = [];
  for (const m of p.melds) {
    if (E.meldStats(m, S).complete) continue;
    for (const card of m.cards) {
      if (!E.isWild(card) || oldCards.has(card)) continue;
      const rest = m.cards.filter(c => c !== card);
      if (!E.checkMeld(m.rank, rest, S).ok) continue;
      if (!snap.hasInitialMeld && p.hasInitialMeld && ts.melded - E.cardValue(card, S) < minMeldFor(state)) continue;
      out.push({ meldId: m.id, rank: m.rank, card });
    }
  }
  return out;
}

function returnWild(state, seat, meldId, card) {
  const g = guard(state, seat, 'play');
  if (!g.ok) return g;
  if (!returnableWilds(state, seat).some(o => o.meldId === meldId && o.card === card))
    return fail('Only a wild added this turn to an unfinished meld can be returned, and the meld must stay legal.');
  const p = state.players[seat], m = p.melds.find(m => m.id === meldId);
  m.cards.splice(m.cards.indexOf(card), 1);
  p.hand.push(card);
  state.turnState.melded -= E.cardValue(card, state.settings);
  log(state, { t: 'returnWild', seat, rank: m.rank, card });
  return done();
}

function undoTurnMelds(state, seat) {
  const g = guard(state, seat, 'play');
  if (!g.ok) return g;
  const ts = state.turnState;
  if (!ts || !ts.snapshot) return fail('Nothing to undo.');
  const snap = JSON.parse(ts.snapshot);
  const p = state.players[seat];
  p.hand = snap.hand; p.foot = snap.foot; p.inFoot = snap.inFoot; p.melds = snap.melds;
  if (Array.isArray(snap.redThrees)) p.redThrees = snap.redThrees;
  /* Going down is part of what the turn did, so taking the melds back takes that
   * back too — otherwise a turn you undid would still have opened your account. */
  if (typeof snap.hasInitialMeld === 'boolean') p.hasInitialMeld = snap.hasInitialMeld;
  const arrival = ts.arrivalSnapshot;
  if (arrival) {
    state.stocks = arrival.stocks.map(pile => pile.slice());
    state.discard = arrival.discard.slice();
    state.reshufflesUsed = arrival.reshufflesUsed;
    state.log = state.log.filter(e => e.t !== 'reshuffle' || e.id <= arrival.logMark);
    delete ts.arrivalSnapshot;
  }
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
    state.log = state.log.filter(function (e) {
      return !e.id || e.id <= ts.logMark || e.seat !== seat ||
        !['meld', 'pile', 'foot', 'returnWild'].includes(e.t);
    });
  }
  return done();
}

function nextTurn(state) {
  // The final successful draw is playable when recycling is disabled, but a
  // following draw turn with no stock must never strand the next player.
  if (!state.settings.reshuffleOnce && stockCount(state) === 0) return endRoundOutOfCards(state);
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
      meldPts += m.cards.reduce((s, c) => s + E.cardValue(c, S), 0);
    }
    /* The sheet keeps books, table cards minus held cards, and the going-out
     * bonus. Held and laid-off red threes use the configured penalty; their
     * printed/default card value does not override the table's rule. */
    const held = p.hand.concat(p.foot);
    const handCount = held.reduce((s, c) => s + (E.isRedThree(c) ? Math.abs(S.redThreeValue) : E.cardValue(c, S)), 0) +
      (S.redThreeBonus ? 0 : p.redThrees.length * Math.abs(S.redThreeValue));
    const redThreePts = S.redThreeBonus ? p.redThrees.length * Math.abs(S.redThreeValue) : 0;
    const tableCount = meldPts + redThreePts - handCount;
    const out = p.wentOut ? S.goOutBonus : 0;
    return {
      redPts, blackPts, redBooks: red, blackBooks: black,
      meldPts, handCount, redThreePts, tableCount, out,
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

function nextRound(state, deferHandChoice = false) {
  if (state.round + 1 >= state.settings.minMelds.length) {
    state.phase = 'gameEnd';
    return done({ gameEnded: true });
  }
  const priorRound = state.round;
  state.round += 1;
  const result = startRound(state, undefined, deferHandChoice);
  if (!result.ok) { state.round = priorRound; return result; }
  state.roundDetail = null;
  state.outSeat = null;
  return result;
}

function totals(state) {
  return state.seats.map((_, i) => state.scores.reduce((s, r) => s + (r[i] || 0), 0));
}

module.exports = {
  createGame, startRound, chooseHand, drawStock, takePile, meldNew, meldAdd,
  discard, undoTurnMelds, returnWild, returnableWilds, canGoOut, scoreRound, endRound, nextRound,
  totals, minMeldFor, emptyPlayer, stockCount, livePiles, splitPiles,
  logRule, pileTakeCards,
};
