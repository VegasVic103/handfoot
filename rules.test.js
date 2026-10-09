const E = require('./engine.js');
const G = require('./game.js');

let pass = 0, failn = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { failn++; console.log('FAIL  ' + name + '\n        ' + e.message); }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((msg || '') + ' expected ' + B + ' got ' + A);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function no(r, msg) { if (r.ok) throw new Error((msg || 'should have failed') + ' but passed'); }

// deterministic rng
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let tt = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    tt = (tt + Math.imul(tt ^ (tt >>> 7), 61 | tt)) ^ tt;
    return ((tt ^ (tt >>> 14)) >>> 0) / 4294967296;
  };
}

console.log('\n-- deck and deal --');
t('deck size scales to players + 2', () => {
  eq(E.buildDeck(5).length, 5 * 54);
  eq(E.buildDeck(4).length, 4 * 54);
});
t('deck has the right card mix', () => {
  const d = E.buildDeck(1);
  eq(d.filter(E.isJoker).length, 2);
  eq(d.filter((c) => E.rankOf(c) === 'A').length, 4);
  eq(d.filter(E.isRedThree).length, 2);
  eq(d.filter(E.isBlackThree).length, 2);
});
t('card values match the table', () => {
  eq(E.cardValue('XR0'), 50, 'joker');
  eq(E.cardValue('2S0'), 20, 'deuce');
  eq(E.cardValue('AH0'), 20, 'ace');
  ['T', 'J', 'Q', 'K'].forEach((r) => eq(E.cardValue(r + 'D0'), 10, r));
  ['4', '5', '6', '7', '8', '9'].forEach((r) => eq(E.cardValue(r + 'C0'), 5, r));
  eq(E.cardValue('3S0'), 5, 'black three');
  eq(E.cardValue('3C0'), 5, 'black three');
  eq(E.cardValue('3H0'), 100, 'red three');
  eq(E.cardValue('3D0'), 100, 'red three');
});
t('3 players deals 11 and 11, five decks', () => {
  const s = G.createGame(['A', 'B', 'C']);
  G.startRound(s, mulberry(1));
  eq(s.players.length, 3);
  for (const p of s.players) { eq(p.hand.length, 11, 'hand'); eq(p.foot.length, 11, 'foot'); }
  const dealt = 3 * 22 + G.stockCount(s) + s.discard.length +
    s.players.reduce((n, p) => n + p.redThrees.length, 0);
  eq(dealt, 5 * 54, 'every card accounted for');
});
t('6 players deals from 8 decks', () => {
  const s = G.createGame(['A', 'B', 'C', 'D', 'E', 'F']);
  G.startRound(s, mulberry(7));
  const total = s.players.reduce((n, p) => n + p.hand.length + p.foot.length + p.redThrees.length, 0);
  eq(total + G.stockCount(s) + s.discard.length, 8 * 54);
});
t('first discard is never a wild or red three', () => {
  for (let seed = 0; seed < 60; seed++) {
    const s = G.createGame(['A', 'B', 'C']);
    G.startRound(s, mulberry(seed));
    const top = s.discard[0];
    ok(!E.isWild(top) && !E.isRedThree(top), 'seed ' + seed + ' turned ' + top);
  }
});
t('red threes dealt to hand stay there, to be discarded', () => {
  let seen = 0;
  for (let seed = 0; seed < 40; seed++) {
    const s = G.createGame(['A', 'B', 'C']);
    G.startRound(s, mulberry(seed));
    for (const p of s.players) {
      eq(p.redThrees.length, 0, 'nothing laid off at the deal');
      seen += p.hand.filter(E.isRedThree).length;
    }
  }
  ok(seen > 0, 'over 40 deals at least one red three reached a hand');
});

console.log('\n-- meld validation --');
const S = E.DEFAULTS;
t('three of a rank is a legal meld', () => ok(E.checkMeld('K', ['KS0', 'KH0', 'KD0'], S).ok));
t('two cards is not', () => no(E.checkMeld('K', ['KS0', 'KH0'], S)));
t('off-rank card rejected', () => no(E.checkMeld('K', ['KS0', 'KH0', 'QD0'], S)));
t('up to two wilds ride in a meld', () => {
  ok(E.checkMeld('K', ['KS0', 'KH0', '2D0'], S).ok, '2 naturals 1 wild');
  ok(E.checkMeld('K', ['KS0', 'KH0', 'KD0', '2D0'], S).ok, '3 naturals 1 wild');
  ok(E.checkMeld('K', ['KS0', 'KH0', 'XR0', '2D0'], S).ok, '2 naturals 2 wilds');
  ok(E.checkMeld('K', ['KS0', 'KH0', 'KD0', 'KC0', '2D0', 'XR0'], S).ok, '4 naturals 2 wilds');
});
t('a meld needs two naturals even with wilds to spare', () => {
  no(E.checkMeld('K', ['KS0', '2D0', 'XR0'], S));
});
t('a third wild is refused, however many naturals', () => {
  no(E.checkMeld('K', ['KS0', 'KH0', 'XR0', 'XB0', '2D0'], S), 'three wilds');
  no(E.checkMeld('K', ['KS0', 'KH0', 'KD0', 'KC0', 'XR0', 'XB0', '2D0'], S),
    'four naturals cannot buy a third wild');
});
t('a book is not capped at seven — you keep adding to the pile', () => {
  const eight = ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1', 'KC1'];
  ok(E.checkMeld('K', eight, S).ok, 'eight kings is a legal pile');
  const st = E.meldStats({ rank: 'K', cards: eight }, S);
  ok(st.complete, 'still a completed book');
  ok(st.isRedBook, 'and still a red book — the bonus is paid once, on the pile');
});
t('seven is when a pile becomes a book, not a ceiling', () => {
  const six = { rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', 'QS1', 'QH1'] };
  ok(!E.meldStats(six, S).complete, 'six is not a book yet');
  six.cards.push('QD1');
  ok(E.meldStats(six, S).complete, 'seven is');
});
t('threes cannot be melded', () => no(E.checkMeld('3', ['3S0', '3H0', '3D0'], S)));
t('wild books off by default', () => no(E.checkMeld('W', ['XR0', 'XB0', '2S0'], S)));
t('red book vs black book detection', () => {
  const red = { rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] };
  const black = { rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', 'QS1', '2H0', 'XR0'] };
  ok(E.meldStats(red, S).isRedBook, 'red');
  ok(!E.meldStats(red, S).isBlackBook);
  ok(E.meldStats(black, S).isBlackBook, 'black');
  ok(E.meldStats(black, S).complete);
});

console.log('\n-- turn rules --');
function rigged(hands, opts) {
  const s = G.createGame(['A', 'B', 'C'], Object.assign({ reshuffleOnce: false }, opts && opts.settings));
  G.startRound(s, mulberry(3));
  hands.forEach((h, i) => { if (h) s.players[i].hand = h.slice(); });
  if (opts && opts.discard) s.discard = opts.discard.slice();
  if (opts && opts.round != null) s.round = opts.round;
  s.turn = 0; s.turnPhase = 'draw'; s.turnState = { melded: 0, tookPile: false, drew: false, pickedUpFoot: false, logMark: s.logSeq || 0, snapshot: JSON.stringify({ hand: s.players[0].hand, foot: s.players[0].foot, inFoot: false, melds: [], redThrees: s.players[0].redThrees, hasInitialMeld: false }) };
  return s;
}

t('cannot act out of turn', () => {
  const s = rigged([]);
  no(G.drawStock(s, 1, [0, 1]), 'seat 1 drew on seat 0 turn');
});
t('draw takes two cards', () => {
  const s = rigged([['KS0', 'KH0', 'KD0']]);
  const before = s.players[0].hand.length;
  ok(G.drawStock(s, 0, [0, 1]).ok);
  eq(s.players[0].hand.length, before + 2);
  eq(s.turnPhase, 'play');
});
t('cannot draw twice', () => {
  const s = rigged([['KS0']]);
  G.drawStock(s, 0, [0, 1]);
  no(G.drawStock(s, 0, [0, 1]));
});
t('must draw before melding or discarding', () => {
  const s = rigged([['KS0', 'KH0', 'KD0']]);
  no(G.meldNew(s, 0, 'K', ['KS0', 'KH0', 'KD0']));
  no(G.discard(s, 0, 'KS0'));
});
t('initial meld below the round minimum is blocked at discard', () => {
  // round 0 minimum is 50; three 4s = 15
  const s = rigged([['4S0', '4H0', '4D0', '9C0']]);
  G.drawStock(s, 0, [0, 1]);
  ok(G.meldNew(s, 0, '4', ['4S0', '4H0', '4D0']).ok, 'meld itself is legal');
  const r = G.discard(s, 0, '9C0');
  no(r, 'discard below minimum');
  eq(r.code, 'initial_meld_short', 'refusal carries a stable code');
  // The wording is kept short so it fits a phone's action bar; what the test
  // pins down is that both numbers are in it — the target and the shortfall.
  ok(/50/.test(r.reason) && /15/.test(r.reason), 'names the 50 needed and the 15 laid: ' + r.reason);
});
t('initial meld at or above the minimum goes through', () => {
  // three aces = 60 >= 50
  const s = rigged([['AS0', 'AH0', 'AD0', '9C0']]);
  G.drawStock(s, 0, [0, 1]);
  ok(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']).ok);
  ok(G.discard(s, 0, '9C0').ok);
  ok(s.players[0].hasInitialMeld);
});
t('round 3 minimum is 150', () => {
  const s = rigged([['AS0', 'AH0', 'AD0', '9C0']], { round: 3 });
  eq(G.minMeldFor(s), 150);
  G.drawStock(s, 0, [0, 1]);
  G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']);
  no(G.discard(s, 0, '9C0'), '60 is short of 150');
});
t('undo returns melded cards to hand', () => {
  const s = rigged([['4S0', '4H0', '4D0', '9C0']]);
  G.drawStock(s, 0, [0, 1]);
  const handAfterDraw = s.players[0].hand.slice();
  G.meldNew(s, 0, '4', ['4S0', '4H0', '4D0']);
  eq(s.players[0].melds.length, 1);
  ok(G.undoTurnMelds(s, 0).ok);
  eq(s.players[0].melds.length, 0);
  eq(s.players[0].hand.sort(), handAfterDraw.sort());
});
t('undo takes the meld back out of the history too', () => {
  const s = rigged([['4S0', '4H0', '4D0', '9C0']]);
  G.drawStock(s, 0, [0, 1]);
  const mine = () => s.log.filter((e) => e.t === 'meld' && e.seat === 0).length;
  const draws = () => s.log.filter((e) => e.t === 'draw' && e.seat === 0).length;
  G.meldNew(s, 0, '4', ['4S0', '4H0', '4D0']);
  eq(mine(), 1, 'laying it says so once');
  G.undoTurnMelds(s, 0);
  eq(mine(), 0, 'taking it back removes the line');
  eq(draws(), 1, 'the draw is not undone, so its line stays');
  G.meldNew(s, 0, '4', ['4S0', '4H0', '4D0']);
  eq(mine(), 1, 'laying it again reads as once, not twice');
});

console.log('\n-- four draw piles --');
t('the stock is split into four piles', () => {
  const s = G.createGame(['A', 'B', 'C']);
  G.startRound(s, mulberry(11));
  eq(s.stocks.length, 4, 'four piles');
  ok(s.stocks.every((p) => p.length > 0), 'every pile has cards');
  const sizes = s.stocks.map((p) => p.length);
  ok(Math.max.apply(null, sizes) - Math.min.apply(null, sizes) <= 1, 'piles even: ' + sizes);
});
t('drawing two takes one card from each named pile', () => {
  const s = rigged([['KS0']]);
  const a = s.stocks[0][0], b = s.stocks[2][0];
  const n0 = s.stocks[0].length, n2 = s.stocks[2].length;
  ok(G.drawStock(s, 0, [0, 2]).ok);
  eq(s.stocks[0].length, n0 - 1, 'pile 1 down one');
  eq(s.stocks[2].length, n2 - 1, 'pile 3 down one');
  // every drawn card lands in the hand, red threes included
  const hand = s.players[0].hand;
  [a, b].forEach((c) => { ok(hand.indexOf(c) !== -1, c + ' reached the hand'); });
});
t('both cards from one pile is rejected', () => {
  const s = rigged([['KS0']]);
  const r = G.drawStock(s, 0, [1, 1]);
  no(r, 'drew twice from pile 2');
  ok(/two different piles/.test(r.reason), 'reason: ' + r.reason);
});
t('naming one pile is rejected', () => {
  const s = rigged([['KS0']]);
  no(G.drawStock(s, 0, [1]));
  no(G.drawStock(s, 0, []));
});
t('an empty pile cannot be drawn from', () => {
  const s = rigged([['KS0']]);
  s.stocks[3] = [];
  const r = G.drawStock(s, 0, [0, 3]);
  no(r);
  ok(/empty/.test(r.reason), 'reason: ' + r.reason);
});
t('a rejected draw leaves the piles untouched', () => {
  const s = rigged([['KS0']]);
  const before = s.stocks.map((p) => p.length);
  G.drawStock(s, 0, [2, 2]);
  eq(s.stocks.map((p) => p.length), before);
  eq(s.turnPhase, 'draw', 'still owes a draw');
});
t('with one pile left the rule relaxes and both come from it', () => {
  const s = rigged([['KS0']]);
  s.stocks[0] = []; s.stocks[1] = []; s.stocks[3] = [];
  const n = s.stocks[2].length;
  const before = s.players[0].hand.length;
  ok(G.drawStock(s, 0, []).ok, 'no pile choice needed');
  eq(s.players[0].hand.length, before + 2);
  ok(s.stocks[2].length < n, 'came out of the last pile');
});
t('the round ends when every pile is empty', () => {
  const s = rigged([['KS0']]);
  s.stocks = [[], [], [], []];
  G.drawStock(s, 0, [0, 1]);
  eq(s.phase, 'roundEnd');
});
t('two piles left still requires the two to differ', () => {
  const s = rigged([['KS0']]);
  s.stocks[0] = []; s.stocks[1] = [];
  no(G.drawStock(s, 0, [2, 2]), 'same pile twice');
  ok(G.drawStock(s, 0, [2, 3]).ok);
});

console.log('\n-- initial meld across a whole turn --');
t('two separate melds in one turn add up to the minimum', () => {
  // three kings (30) + three aces (60) = 90, laid as two different melds
  const s = rigged([['KS0','KH0','KD0','AS0','AH0','AD0','6C1']]);
  G.drawStock(s, 0, [0, 1]);
  ok(G.meldNew(s, 0, 'K', ['KS0','KH0','KD0']).ok, 'first meld goes down');
  ok(!s.players[0].hasInitialMeld, 'not credited yet at 30');
  eq(s.turnState.melded, 30, 'thirty so far');
  ok(G.meldNew(s, 0, 'A', ['AS0','AH0','AD0']).ok, 'second meld goes down');
  eq(s.turnState.melded, 90, 'the turn total accumulates across melds');
  ok(G.discard(s, 0, '6C1').ok, 'the turn closes');
  ok(s.players[0].hasInitialMeld, 'initial meld is credited');
});
t('a pile of low cards is not enough on its own', () => {
  // six 9s would have been 60 under the old values; they are 30 now
  const s = rigged([['9S0','9H0','9D0','9C0','9S1','9H1','6C1']]);
  G.drawStock(s, 0, [0, 1]);
  ok(G.meldNew(s, 0, '9', ['9S0','9H0','9D0','9C0','9S1','9H1']).ok);
  eq(s.turnState.melded, 30, 'six nines are thirty, not sixty');
  no(G.discard(s, 0, '6C1'), 'thirty is short of fifty');
});
t('three melds in one turn also add up', () => {
  // 3 fours (15) + 3 fives (15) + 3 aces (60) = 90
  const s = rigged([['4S0','4H0','4D0','5S0','5H0','5D0','AS0','AH0','AD0','6C1']]);
  G.drawStock(s, 0, [0, 1]);
  ok(G.meldNew(s, 0, '4', ['4S0','4H0','4D0']).ok);
  ok(G.meldNew(s, 0, '5', ['5S0','5H0','5D0']).ok);
  ok(G.meldNew(s, 0, 'A', ['AS0','AH0','AD0']).ok);
  eq(s.turnState.melded, 90);
  ok(G.discard(s, 0, '6C1').ok);
});
t('adding to a meld laid earlier the same turn counts too', () => {
  // 3 kings (30) then a 4th king (10) then 3 aces (60) = 100
  const s = rigged([['KS0','KH0','KD0','KC0','AS0','AH0','AD0','6C1']]);
  G.drawStock(s, 0, [0, 1]);
  ok(G.meldNew(s, 0, 'K', ['KS0','KH0','KD0']).ok);
  const id = s.players[0].melds[0].id;
  ok(G.meldAdd(s, 0, id, ['KC0']).ok, 'the extra king counts');
  eq(s.turnState.melded, 40);
  ok(G.meldNew(s, 0, 'A', ['AS0','AH0','AD0']).ok);
  eq(s.turnState.melded, 100);
  ok(G.discard(s, 0, '6C1').ok);
});
t('exactly the minimum is enough', () => {
  // 3 tens (30) + 4 fives (20) = 50
  const s = rigged([['TS0','TH0','TD0','5S0','5H0','5D0','5C0','6C1']]);
  G.drawStock(s, 0, [0, 1]);
  ok(G.meldNew(s, 0, 'T', ['TS0','TH0','TD0']).ok);
  ok(G.meldNew(s, 0, '5', ['5S0','5H0','5D0','5C0']).ok);
  eq(s.turnState.melded, 50);
  ok(G.discard(s, 0, '6C1').ok, '50 exactly is accepted');
});
t('more than the minimum is fine', () => {
  const s = rigged([['AS0','AH0','AD0','AC0','6C1']]);
  G.drawStock(s, 0, [0, 1]);
  ok(G.meldNew(s, 0, 'A', ['AS0','AH0','AD0','AC0']).ok);
  eq(s.turnState.melded, 80);
  ok(G.discard(s, 0, '6C1').ok, '80 is accepted');
});
t('short of the minimum is still refused', () => {
  // 3 fours (15) + 3 kings (30) = 45
  const s = rigged([['4S0','4H0','4D0','KS0','KH0','KD0','6C1']]);
  G.drawStock(s, 0, [0, 1]);
  G.meldNew(s, 0, '4', ['4S0','4H0','4D0']);
  G.meldNew(s, 0, 'K', ['KS0','KH0','KD0']);
  eq(s.turnState.melded, 45);
  const r = G.discard(s, 0, '6C1');
  no(r, '45 is short');
  eq(r.code, 'initial_meld_short');
  ok(/45/.test(r.reason), 'the message names the running total: ' + r.reason);
});
t('once made, later turns have no minimum', () => {
  const s = rigged([['AS0','AH0','AD0','4S1','4H1','4D1','6C1','7C1']]);
  G.drawStock(s, 0, [0, 1]);
  G.meldNew(s, 0, 'A', ['AS0','AH0','AD0']);
  ok(G.discard(s, 0, '6C1').ok);
  ok(s.players[0].hasInitialMeld);
  // back round to seat 0
  s.turn = 0; s.turnPhase = 'draw'; s.turnState = { melded: 0, tookPile: false, drew: false, pickedUpFoot: false, snapshot: JSON.stringify({ hand: s.players[0].hand, foot: s.players[0].foot, inFoot: s.players[0].inFoot, melds: s.players[0].melds }) };
  G.drawStock(s, 0, [2, 3]);
  ok(G.meldNew(s, 0, '4', ['4S1','4H1','4D1']).ok, 'a 15-point meld is fine now');
  ok(G.discard(s, 0, '7C1').ok);
});

console.log('\n-- discard pile --');
t('taking the pile grabs the top card plus six behind it', () => {
  const pile = ['5S0', '6H0', '7D0', '8C0', '9S0', 'TH0', 'JD0', 'QC0', 'AS0'];
  const s = rigged([['AH0', 'AD0', 'AC0', '9C1']], { discard: pile });
  const handBefore = s.players[0].hand.length;
  const r = G.takePile(s, 0, ['AH0', 'AD0', 'AC0']);
  ok(r.ok, r.reason);
  // 7 cards leave the pile; the top one joins the meld, 6 go to hand
  eq(s.discard.length, 2, 'pile left with two');
  eq(s.players[0].hand.length, handBefore - 3 + 6, 'six cards into hand');
  eq(s.players[0].melds[0].cards.length, 4, 'three aces plus the top ace');
});
t('taking the pile needs two naturals matching the top card', () => {
  const s = rigged([['KH0', 'QD0', 'QC0', '9C1']], { discard: ['5S0', 'KS0'] });
  const r = G.takePile(s, 0, ['KH0']);
  no(r);
  ok(/natural king/.test(r.reason), 'reason: ' + r.reason);
});
t('a black three on top freezes the pile', () => {
  const s = rigged([['KH0', 'KD0', 'KC0']], { discard: ['KS0', '3S0'] });
  no(G.takePile(s, 0, ['KH0', 'KD0']));
});
t('a wild on top freezes the pile', () => {
  const s = rigged([['KH0', 'KD0', 'KC0']], { discard: ['KS0', '2H0'] });
  no(G.takePile(s, 0, ['KH0', 'KD0']));
});
t('a short pile is taken entirely', () => {
  const s = rigged([['AH0', 'AD0', 'AC0', '9C1']], { discard: ['7S0', 'AS0'] });
  ok(G.takePile(s, 0, ['AH0', 'AD0', 'AC0']).ok);
  eq(s.discard.length, 0);
});
t('taking the pile short of the minimum is allowed, but counts towards it', () => {
  // three 4s + a 4 from the pile = 20, short of 50 — the take itself is fine
  const s = rigged([['4H0', '4D0', '4C0', '9C1']], { discard: ['7S0', '4S0'] });
  ok(G.takePile(s, 0, ['4H0', '4D0', '4C0']).ok, 'the take goes through');
  eq(s.turnState.melded, 20, 'and is 20 towards the 50');
  ok(!s.players[0].hasInitialMeld, 'but it did not put you down on its own');
});
t('you cannot end the turn still short after taking the pile', () => {
  const s = rigged([['4H0', '4D0', '4C0', '9C1']], { discard: ['7S0', '4S0'] });
  ok(G.takePile(s, 0, ['4H0', '4D0', '4C0']).ok);
  const r = G.discard(s, 0, '9C1');
  no(r, 'twenty is not fifty');
  eq(r.code, 'initial_meld_short');
});
t('melds laid after the take carry you over the minimum', () => {
  const s = rigged([['4H0', '4D0', '4C0', 'AH1', 'AD1', 'AC1', '9C1']], { discard: ['7S0', '4S0'] });
  ok(G.takePile(s, 0, ['4H0', '4D0', '4C0']).ok, 'take the pile for 20');
  ok(G.meldNew(s, 0, 'A', ['AH1', 'AD1', 'AC1']).ok, 'three aces for 60 more');
  eq(s.turnState.melded, 80);
  ok(G.discard(s, 0, '9C1').ok, 'eighty clears the fifty');
  ok(s.players[0].hasInitialMeld, 'and that is going down');
});
t('putting the pile back leaves it exactly as it was', () => {
  const pile = ['5S0', '6H0', '7D0', '8C0', '9S0', 'TH0', 'JD0', 'QC0', '4S0'];
  const s = rigged([['4H0', '4D0', '4C0', '9C1']], { discard: pile.slice() });
  const hand = s.players[0].hand.slice();
  ok(G.takePile(s, 0, ['4H0', '4D0', '4C0']).ok);
  ok(G.undoTurnMelds(s, 0).ok, 'and hand it back');
  eq(s.discard.join(','), pile.join(','), 'every card of the pile is where it was');
  eq(s.players[0].hand.join(','), hand.join(','), 'and the hand is untouched');
  eq(s.players[0].melds.length, 0, 'with no meld left behind');
  eq(s.turnPhase, 'draw', 'so the turn starts over at the draw');
  ok(G.drawStock(s, 0, [0, 1]).ok, 'and drawing normally is available again');
});
t('undo takes going down back with it', () => {
  const s = rigged([['AS0', 'AH0', 'AD0', '9C0']]);
  G.drawStock(s, 0, [0, 1]);
  ok(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']).ok);
  ok(G.undoTurnMelds(s, 0).ok);
  ok(!s.players[0].hasInitialMeld, 'a turn you took back did not open your account');
});
t('a red three inside the taken pile comes into the hand like any other card', () => {
  const pile = ['3H0', '5S0', '6H0', '7D0', '8C0', '9S0', 'AS0'];
  const s = rigged([['AH0', 'AD0', 'AC0', '9C1']], { discard: pile });
  ok(G.takePile(s, 0, ['AH0', 'AD0', 'AC0']).ok);
  eq(s.players[0].redThrees.length, 0, 'nothing is laid off');
  ok(s.players[0].hand.indexOf('3H0') !== -1, 'the red three is in hand, to be discarded');
});
t('a red three can be discarded, and freezes the pile behind it', () => {
  const s = rigged([['3H0', '9C0']]);
  ok(G.drawStock(s, 0, [0, 1]).ok);
  ok(G.discard(s, 0, '3H0').ok, 'a red three is a legal discard');
  ok(!s.players[0].hand.some(E.isRedThree), 'and it leaves the hand');
  // the next player cannot take a pile topped by one: threes never meld
  const r = G.takePile(s, 1, []);
  no(r, 'pile topped by a red three');
  ok(/red three/i.test(r.reason), 'and says why: ' + r.reason);
});
t('a red three is never dealt away or replaced', () => {
  const s = G.createGame(['A', 'B']);
  G.startRound(s, mulberry(9));
  const laidOff = s.players.reduce((n, p) => n + p.redThrees.length, 0);
  eq(laidOff, 0, 'nobody has anything laid off at the deal');
});

t('the pile peek shows exactly what a take would reach, and no more', () => {
  const s = G.createGame(['A', 'B']);
  G.startRound(s, mulberry(4));
  const S = s.settings;
  eq(S.revealPileTake, true, 'this table plays the pile open by default');

  // A pile far deeper than a take: the peek must stop at the take.
  s.discard = ['2S0','3S0','4S0','5S0','6S0','7S0','8S0','9S0','TS0','JS0','QS0','KS0'];
  const peek = G.pileTakeCards(s);
  eq(peek.length, S.pileTakeExtra + 1, 'capped at the top card plus the ones behind it');
  eq(peek[peek.length - 1], 'KS0', 'the top card is the last of them');
  eq(peek, s.discard.slice(s.discard.length - peek.length), 'and they are the ones a take splices off');
  ok(peek.indexOf('2S0') === -1, 'nothing deeper in the pile comes with it');

  // A pile shallower than a take: everything, and no padding.
  s.discard = ['QS0', 'KS0'];
  eq(G.pileTakeCards(s), ['QS0', 'KS0'], 'a short pile shows only what is there');
  s.discard = [];
  eq(G.pileTakeCards(s), [], 'an empty pile shows nothing');
});

t('a second book of a rank waits until the first one is closed', () => {
  const s = rigged([['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1', 'KS2', 'KH2', 'KD2', '9C0']]);
  const p = s.players[0];
  p.hasInitialMeld = true;
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1', 'KS2', 'KH2', 'KD2', '9C0'];

  ok(G.meldNew(s, 0, 'K', ['KS0', 'KH0', 'KD0']).ok, 'first kings book, three cards');
  const first = p.melds[0].id;
  const r = G.meldNew(s, 0, 'K', ['KC0', 'KS1', 'KH1']);
  no(r, 'a second kings book while the first is open');
  ok(/add to it/.test(r.reason), 'and says to add to it: ' + r.reason);

  ok(G.meldAdd(s, 0, first, ['KC0', 'KS1', 'KH1', 'KD1']).ok, 'fill it to seven');
  ok(E.meldStats(p.melds[0], s.settings).complete, 'closed');

  ok(G.meldNew(s, 0, 'K', ['KS2', 'KH2', 'KD2']).ok, 'now a second kings book is fine');
  eq(p.melds.length, 2, 'two kings books');
  eq(G.scoreRound(s)[0].redPts, s.settings.redBookBonus, 'and only the closed one pays a bonus');
});
t('a closed book keeps taking cards, but a red one stays red', () => {
  const s = rigged([['KC1', 'XR0', '9C0']]);
  const p = s.players[0];
  p.hasInitialMeld = true;
  p.melds = [{ id: 'm1', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] }];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['KC1', 'XR0', '9C0'];

  const r = G.meldAdd(s, 0, 'm1', ['XR0']);
  no(r, 'a wild onto a closed red book');
  ok(/red book/.test(r.reason), 'and says why: ' + r.reason);

  ok(G.meldAdd(s, 0, 'm1', ['KC1']).ok, 'another natural is fine');
  eq(p.melds[0].cards.length, 8, 'the pile is eight now');
  ok(E.meldStats(p.melds[0], s.settings).isRedBook, 'and still red');
});

console.log('\n-- foot and going out --');
t('emptying the hand picks up the foot mid-turn', () => {
  const s = rigged([['AS0', 'AH0', 'AD0']]);
  s.players[0].foot = ['2S1', '3S1', '4S1'];
  G.drawStock(s, 0, [0, 1]);
  // clear whatever was drawn so the meld empties the hand
  s.players[0].hand = ['AS0', 'AH0', 'AD0'];
  ok(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']).ok);
  ok(s.players[0].inFoot, 'in foot');
  eq(s.players[0].hand.length, 3);
  eq(s.players[0].foot.length, 0);
});
t('a player in their foot may not meld their last card', () => {
  const s = rigged([['AS0', 'AH0', 'AD0']]);
  s.players[0].inFoot = true;
  s.players[0].hasInitialMeld = true;
  G.drawStock(s, 0, [0, 1]);
  s.players[0].hand = ['AS0', 'AH0', 'AD0'];
  no(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']), 'melded the last card');
});
t('in your foot, melding down to one card is refused without the books', () => {
  const s = rigged([['AS0', 'AH0', 'AD0', '9C0']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['AS0', 'AH0', 'AD0', '9C0'];
  const r = G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']);
  no(r, 'laid three and left itself one card');
  eq(r.code, 'foot_keep_two', 'named reason, not prose: ' + r.reason);
  eq(p.hand.length, 4, 'hand rolled back');
  eq(p.melds.length, 0, 'meld rolled back');
});
t('in your foot, melding down to two is fine — one to discard, one to keep', () => {
  const s = rigged([['AS0', 'AH0', 'AD0', '9C0', '9D0']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['AS0', 'AH0', 'AD0', '9C0', '9D0'];
  ok(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']).ok, 'three aces down');
  eq(p.hand.length, 2, 'two cards left');
  ok(G.discard(s, 0, '9C0').ok, 'one of them is discarded');
  eq(p.hand.length, 1, 'and one is still in the foot');
  ok(!p.wentOut, 'a discard never goes out');
});
t('on the way out you may pass through one card, because the last one can be melded', () => {
  const s = rigged([['QH1', 'QD1', 'QC1']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  // Both books already closed, so going out is live the whole way down. A
  // closed book still takes cards at this table, which is what the last three
  // queens are for.
  p.melds = [
    { id: 'm1', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] },
    { id: 'm2', rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', 'QS1', '2H0', '2D0'] },
  ];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['QH1', 'QD1', 'QC1'];
  // Two of the three first, which would be a dead end for anyone not going out.
  ok(G.meldAdd(s, 0, 'm2', ['QH1', 'QD1']).ok, 'two queens down, one card left');
  eq(p.hand.length, 1, 'sitting on one card with both books');
  ok(G.meldAdd(s, 0, 'm2', ['QC1']).ok, 'and the last one lands too');
  ok(p.wentOut, 'which is going out');
});
t('in your foot without the books, you cannot meld your last card', () => {
  const s = rigged([['AS0', 'AH0', 'AD0']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['AS0', 'AH0', 'AD0'];
  const r = G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']);
  no(r, 'emptied the hand with no books');
  ok(/going out/i.test(r.reason), 'and says why: ' + r.reason);
  eq(p.hand.length, 3, 'hand rolled back');
  eq(p.melds.length, 0, 'meld rolled back');
  eq(s.phase, 'playing', 'the round did not end');
});
t('melding your last card with both books is how you go out', () => {
  const s = rigged([['QS1', 'QH1']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  p.melds = [
    { id: 'm1', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] },
    { id: 'm2', rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', '2H0'] },
  ];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['QS1', 'QH1'];
  ok(G.meldAdd(s, 0, 'm2', ['QS1', 'QH1']).ok, 'the last two cards complete the black book');
  eq(p.hand.length, 0, 'nothing left in hand');
  ok(p.wentOut, 'and that is going out — no discard');
  eq(s.phase, 'roundEnd', 'the round ends there');
});
t('going out needs one red book and one black book', () => {
  const s = rigged([['9C0', '9D0', '9H0']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  p.melds = [{ id: 'm1', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] }];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['9C0', '9D0', '9H0'];
  const r = G.meldNew(s, 0, '9', ['9C0', '9D0', '9H0']);
  no(r, 'emptied the hand with only a red book');
  ok(/black book/.test(r.reason), 'reason: ' + r.reason);
  ok(!p.wentOut, 'and did not go out');
});
t('in your foot, a discard may never empty your hand', () => {
  const s = rigged([['9C0']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  p.melds = [{ id: 'm1', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] }];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['9C0'];
  const pile = s.discard.length;          // a round starts with a card turned up
  const r = G.discard(s, 0, '9C0');
  no(r, 'threw its only card');
  eq(r.code, 'foot_last_card', 'named reason, not prose: ' + r.reason);
  eq(p.hand.length, 1, 'the card is still in hand');
  eq(s.discard.length, pile, 'and nothing reached the pile');
  eq(s.turn, 0, 'the turn did not pass');
});
t('the books make no difference — going out is melding, never discarding', () => {
  const s = rigged([['9C0']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  p.melds = [
    { id: 'm1', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] },
    { id: 'm2', rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', 'QS1', '2H0', '2D0'] },
  ];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['9C0'];
  ok(G.canGoOut(s, 0).ok, 'both books are down');
  no(G.discard(s, 0, '9C0'), 'still cannot discard the last card');
  ok(!p.wentOut, 'and that did not go out');
});
t('still in your hand, discarding your last card just picks up the foot', () => {
  const s = rigged([['9C0']]);
  const p = s.players[0];
  p.inFoot = false; p.hasInitialMeld = true;
  p.foot = ['AS1', 'AH1', 'AD1'];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['9C0'];
  ok(G.discard(s, 0, '9C0').ok, 'the keep-two rule is only for the foot');
  ok(p.inFoot, 'and the foot comes up');
  eq(p.hand.length, 3, 'with the foot as the new hand');
});
t('going out with both books ends the round and pays the bonus', () => {
  const s = rigged([['9C0', '9D0', '9H0']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  p.melds = [
    { id: 'm1', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] },
    { id: 'm2', rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', 'QS1', '2H0', 'XR0'] },
  ];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['9C0', '9D0', '9H0'];
  ok(G.meldNew(s, 0, '9', ['9C0', '9D0', '9H0']).ok, 'the last three go down');
  ok(p.wentOut, 'went out');
  eq(s.phase, 'roundEnd');
  eq(G.scoreRound(s)[0].out, s.settings.goOutBonus, 'and collects the bonus');
  eq(s.settings.goOutBonus, 500, 'which is 500 at this table');
  eq(G.scoreRound(s)[0].handCount, 0, 'with nothing left to count against');
});
t('a player not in their foot cannot go out', () => {
  const s = rigged([['9C0']]);
  const p = s.players[0];
  p.inFoot = false; p.hasInitialMeld = true; p.foot = ['5S1'];
  p.melds = [
    { id: 'm1', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] },
    { id: 'm2', rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', 'QS1', '2H0', 'XR0'] },
  ];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['9C0'];
  ok(G.discard(s, 0, '9C0').ok, 'discard allowed');
  ok(!p.wentOut, 'did not go out');
  ok(p.inFoot, 'picked up foot instead');
});

console.log('\n-- scoring --');
t('the sheet is black books, red books, table count and out', () => {
  const s = G.createGame(['A', 'B']);
  G.startRound(s, mulberry(2));
  const p = s.players[0];
  p.melds = [
    { id: 'm1', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] }, // red book 500 + 70
    { id: 'm2', rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', 'QS1', '2H0', 'XR0'] }, // black 300 + 50+20+50 = 120
  ];
  // held in hand, not laid off — this table plays red threes as dead cards
  p.hand = ['9C0', '3H0']; p.foot = []; p.redThrees = []; p.wentOut = true;
  const rows = G.scoreRound(s);
  const r = rows[0];
  eq(r.redBooks, 1); eq(r.redPts, 500);
  eq(r.blackBooks, 1); eq(r.blackPts, 300);
  eq(r.meldPts, 190);
  eq(r.handCount, 105, 'a nine is five and the red three is a hundred against you');
  eq(r.tableCount, 190 - 105, 'table count is what is melded less what you hold');
  eq(r.out, 500);
  eq(r.total, 500 + 300 + (190 - 105) + 500);
});
t('a red three in a foot you never reached costs you the hundred', () => {
  const s = G.createGame(['A', 'B']);
  G.startRound(s, mulberry(2));
  const p = s.players[1];
  p.melds = []; p.hand = []; p.foot = ['3H0', '9C0']; p.redThrees = [];
  const r = G.scoreRound(s)[1];
  eq(r.handCount, 105, 'still holding it, so it still counts — once');
  eq(r.tableCount, -105);
  eq(r.total, -105);
});
t('going out on a red three leaves nothing to be caught with', () => {
  const s = G.createGame(['A', 'B']);
  G.startRound(s, mulberry(2));
  const p = s.players[0];
  p.melds = []; p.hand = []; p.foot = []; p.redThrees = []; p.wentOut = true;
  eq(G.scoreRound(s)[0].handCount, 0, 'discarded, so nothing counts against you');
});
t('cards left in an unplayed foot still count against you', () => {
  const s = G.createGame(['A', 'B']);
  G.startRound(s, mulberry(2));
  const p = s.players[1];
  p.melds = []; p.hand = ['AS0']; p.foot = ['XR0']; p.redThrees = [];
  eq(G.scoreRound(s)[1].total, -70);
});
t('going out is worth 500', () => {
  const s = G.createGame(['A', 'B']);
  G.startRound(s, mulberry(2));
  const p = s.players[0];
  p.melds = []; p.hand = []; p.foot = []; p.redThrees = []; p.wentOut = true;
  eq(G.scoreRound(s)[0].total, 500);
});

console.log('\n-- atomic moves and undo --');
t('a duplicate card cannot create a meld or remove an unrelated card', () => {
  const s = rigged([['KS0', 'KH0', '9C0']]);
  G.drawStock(s, 0, [0, 1]);
  const before = JSON.stringify(s);
  no(G.meldNew(s, 0, 'K', ['KS0', 'KS0', 'KH0']));
  eq(JSON.stringify(s), before, 'every part of the state is unchanged');
});
t('a duplicate add and an empty add leave the table untouched', () => {
  const s = rigged([['KS1', '9C0']]);
  s.players[0].melds = [{ id: 'k', rank: 'K', cards: ['KS0', 'KH0', 'KD0'] }];
  G.drawStock(s, 0, [0, 1]);
  const before = JSON.stringify(s);
  no(G.meldAdd(s, 0, 'k', ['KS1', 'KS1']));
  no(G.meldAdd(s, 0, 'k', []));
  eq(JSON.stringify(s), before);
});
t('a refused foot pickup restores turn flags and a full history', () => {
  const s = rigged([['AS0', 'AH0', 'AD0']]);
  G.drawStock(s, 0, [0, 1]);
  s.players[0].hand = ['AS0', 'AH0', 'AD0'];
  s.players[0].foot = ['9C0'];
  s.log = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, t: 'draw', seat: 1 }));
  s.logSeq = 200;
  const before = JSON.stringify(s);
  no(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']));
  eq(JSON.stringify(s), before, 'no foot badge, lost history or phantom meld remains');
});
t('a refused pile take restores new-card highlights as well as the cards', () => {
  const s = rigged([['KH0', 'KD0']], { discard: ['9C0', 'KS0'] });
  const p = s.players[0];
  p.inFoot = true; p.foot = []; p.hasInitialMeld = true;
  const before = JSON.stringify(s);
  no(G.takePile(s, 0, ['KH0', 'KD0']));
  eq(JSON.stringify(s), before);
});
t('undoing a pile take restores laid-off red threes without duplicating them', () => {
  const s = rigged([['AH0', 'AD0', '9C0']], {
    settings: { redThreeAutoLayOff: true }, discard: ['3H5', 'AS0'],
  });
  const beforeRed = s.players[0].redThrees.slice();
  ok(G.takePile(s, 0, ['AH0', 'AD0']).ok);
  ok(s.players[0].redThrees.includes('3H5'));
  ok(G.undoTurnMelds(s, 0).ok);
  eq(s.players[0].redThrees, beforeRed);
  eq(s.discard, ['3H5', 'AS0']);
});
t('undoing a foot pickup restores its laid-off red threes', () => {
  const s = rigged([['AS0', 'AH0', 'AD0']], { settings: { redThreeAutoLayOff: true } });
  const p = s.players[0];
  s.stocks = [['AD0', '4S0'], ['AH0'], [], []];
  p.hand = ['AS0']; p.foot = ['3H5', '9C0', '8C0'];
  G.drawStock(s, 0, [0, 1]);
  const red = p.redThrees.slice();
  ok(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']).ok);
  ok(p.redThrees.includes('3H5'));
  ok(G.undoTurnMelds(s, 0).ok);
  eq(p.redThrees, red);
  eq(p.foot, ['3H5', '9C0', '8C0']);
  ok(!p.inFoot);
});
t('undo preserves visibility rule changes made during a turn', () => {
  const s = rigged([['AS0', 'AH0', 'AD0', '9C0']]);
  G.drawStock(s, 0, [0, 1]);
  G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']);
  G.logRule(s, 0, 'revealPileTake', false);
  G.logRule(s, 1, 'revealPileTake', true);
  ok(G.undoTurnMelds(s, 0).ok);
  eq(s.log.filter((e) => e.t === 'rule').length, 2);
  eq(s.log.filter((e) => e.t === 'meld').length, 0);
});
t('going out cannot bypass an unfinished opening minimum', () => {
  const s = rigged([['5H1']], { round: 3 });
  const p = s.players[0];
  p.inFoot = true; p.foot = [];
  p.melds = [
    { id: 'r', rank: '4', cards: ['4S0', '4H0', '4D0', '4C0', '4S1', '4H1', '4D1'] },
    { id: 'b', rank: '5', cards: ['5S0', '5H0', '5D0', '5C0', '2S0', '2H0'] },
  ];
  s.turnPhase = 'play'; s.turnState.drew = true; s.turnState.melded = 95;
  const before = JSON.stringify(s);
  const r = G.meldAdd(s, 0, 'b', ['5H1']);
  no(r); eq(r.code, 'initial_meld_short');
  eq(JSON.stringify(s), before, 'the final card and score are unchanged');
});
t('undo cannot change cards after the round has been scored', () => {
  const s = rigged([['QH1']]);
  const p = s.players[0];
  p.inFoot = true; p.foot = []; p.hasInitialMeld = true;
  p.melds = [
    { id: 'r', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] },
    { id: 'b', rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', 'QS1', '2H0', '2D0'] },
  ];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['QH1'];
  ok(G.meldAdd(s, 0, 'b', ['QH1']).roundEnded);
  const before = JSON.stringify(s);
  no(G.undoTurnMelds(s, 0));
  eq(JSON.stringify(s), before);
});


console.log('\n-- configurable table rules --');
t('rule validation returns independent defaults and accepts supported ranges', () => {
  const original = E.DEFAULTS.minMelds.slice();
  const result = E.validateSettings({}, 4);
  ok(result.ok); eq(E.deckCountFor(result.settings, 4), 6);
  result.settings.minMelds[0] = 0; eq(E.DEFAULTS.minMelds, original);
  const custom = E.validateSettings({ deckCount: 12, handSize: 20, footSize: 5,
    requireRedBook: 5, requireBlackBook: 0, pileTakeExtra: 19, bookSize: 10,
    maxWildsInBook: 0, minNaturalsInMeld: 3, minMelds: [0, 100, 300, 500],
    redBookBonus: 0, blackBookBonus: 2000, goOutBonus: 2000,
    redThreeValue: -2000, redThreeAutoLayOff: true, revealPileTake: false, reshuffleOnce: false }, 4);
  ok(custom.ok, custom.reason); eq(E.deckCountFor(custom.settings, 4), 12);
  eq(custom.settings.drawCount, 2); eq(custom.settings.stockPiles, 4);
});
t('malformed, unknown and out-of-range rule changes are rejected', () => {
  for (const rules of [null, [], { drawCount: 1 }, { deckCount: '4' }, { handSize: 4 },
    { footSize: 21 }, { maxWildsInBook: 5 }, { minNaturalsInMeld: 1 },
    { revealPileTake: 1 }, { reshuffleOnce: 'true' }, { minMelds: [50] },
    { minMelds: [0, 1.5, 20, 50] }, { redThreeValue: 100 }, { goOutBonus: 2001 }]) {
    no(E.validateSettings(rules, 4), JSON.stringify(rules));
  }
});
t('setup rejects insufficient decks and impossible required books', () => {
  no(E.validateSettings({ deckCount: 1 }, 4));
  no(E.validateSettings({ maxWildsInBook: 0 }, 4));
  no(E.validateSettings({ deckCount: 1, handSize: 5, footSize: 5 }, 2));
  ok(E.validateSettings({ deckCount: 1, handSize: 5, footSize: 5, bookSize: 4 }, 2).ok);
  const s = G.createGame(['A', 'B', 'C', 'D'], { deckCount: 1 });
  const before = JSON.stringify(s); no(G.startRound(s)); eq(JSON.stringify(s), before);
});
t('a required black book must fit the natural and usable wild supply', () => {
  const base = { deckCount: 1, handSize: 5, footSize: 5, requireRedBook: 0, requireBlackBook: 1 };
  for (const rules of [{ bookSize: 7, maxWildsInBook: 2 }, { bookSize: 10, maxWildsInBook: 4 }]) {
    const settings = Object.assign({}, base, rules);
    no(E.validateSettings(settings, 2));
    const s = G.createGame(['A', 'B'], settings);
    const before = JSON.stringify(s); no(G.startRound(s)); eq(JSON.stringify(s), before);
  }
  ok(E.validateSettings(Object.assign({}, base, { bookSize: 6, maxWildsInBook: 2 }), 2).ok);
  ok(E.validateSettings(Object.assign({}, base, { deckCount: 2, bookSize: 7, maxWildsInBook: 2 }), 2).ok);
  const s = G.createGame(['A', 'B']); ok(G.startRound(s, mulberry(18)).ok); G.endRound(s, null);
  s.pendingSettings = Object.assign({}, s.settings, base, { bookSize: 7, maxWildsInBook: 2 });
  const before = JSON.stringify(s); no(G.nextRound(s)); eq(JSON.stringify(s), before);
  s.pendingSettings = Object.assign({}, s.settings, base, { bookSize: 6, maxWildsInBook: 2 });
  ok(G.nextRound(s).ok); eq(s.settings.bookSize, 6); eq(s.settings.deckCount, 1);
});
function allCards(s) {
  return s.stocks.flat().concat(s.discard, ...s.players.map(p =>
    p.hand.concat(p.foot, p.redThrees, ...p.melds.map(m => m.cards)))).sort();
}
t('fixed deck and custom deal sizes apply to every round', () => {
  const s = G.createGame(['A', 'B'], { deckCount: 2, handSize: 5, footSize: 8 });
  ok(G.startRound(s, mulberry(925)).ok);
  for (let round = 0; round < 4; round++) {
    eq(s.round, round); eq(allCards(s).length, 108); eq(new Set(allCards(s)).size, 108);
    s.players.forEach(p => { eq(p.hand.length, 5); eq(p.foot.length, 8); });
    G.endRound(s, null); if (round < 3) ok(G.nextRound(s).ok);
  }
});
t('queued rules apply at the next deal, while invalid queued rules leave the scored round intact', () => {
  const s = G.createGame(['A', 'B']); ok(G.startRound(s, mulberry(927)).ok);
  const settings = E.validateSettings({ deckCount: 3, handSize: 6, footSize: 9 }, 2, s.settings).settings;
  s.pendingSettings = settings; s.reshufflesUsed = 1;
  eq(s.settings.handSize, 11); G.endRound(s, null); ok(G.nextRound(s).ok);
  eq(s.settings.handSize, 6); eq(s.players[0].foot.length, 9);
  eq(allCards(s).length, 162); eq(s.pendingSettings, undefined); eq(s.reshufflesUsed, 0);
  G.endRound(s, null); s.pendingSettings = Object.assign({}, s.settings, { deckCount: 1, handSize: 20, footSize: 20 });
  const before = JSON.stringify(s); no(G.nextRound(s)); eq(JSON.stringify(s), before);
});
t('custom wild cap, natural minimum, book size and book requirements are enforced', () => {
  const S = E.validateSettings({ bookSize: 3, maxWildsInBook: 4, minNaturalsInMeld: 3,
    requireRedBook: 2, requireBlackBook: 0 }, 3).settings;
  no(E.checkMeld('K', ['KS0', 'KH0', 'XR0'], S));
  ok(E.checkMeld('K', ['KS0', 'KH0', 'KD0', 'XR0', 'XB0', '2S0', '2H0'], S).ok);
  const s = rigged([[]], { settings: S }); const p = s.players[0]; p.inFoot = true;
  p.melds = [{ rank: 'K', cards: ['KS0', 'KH0', 'KD0'] }]; no(G.canGoOut(s, 0));
  p.melds.push({ rank: 'Q', cards: ['QS0', 'QH0', 'QD0'] }); ok(G.canGoOut(s, 0).ok);
});
t('custom scoring bonuses and red-three penalty apply to held, foot and laid-off cards', () => {
  const s = rigged([['3H0']], { settings: { bookSize: 3, redBookBonus: 750,
    blackBookBonus: 450, goOutBonus: 250, redThreeValue: -200 } });
  const p = s.players[0]; p.foot = ['3D0']; p.redThrees = ['3H1']; p.wentOut = true;
  p.melds = [{ rank: 'K', cards: ['KS0', 'KH0', 'KD0'] }, { rank: 'Q', cards: ['QS0', 'QH0', '2S0'] }];
  const score = G.scoreRound(s)[0]; eq(score.redPts, 750); eq(score.blackPts, 450);
  eq(score.out, 250); eq(score.handCount, 600); eq(score.total, 920);
  s.settings.redThreeValue = 0; eq(G.scoreRound(s)[0].handCount, 0);
});

console.log('\n-- once-per-round stock recycling --');
function recyclingGame(extra) {
  const s = rigged([['AS0', 'AH0', 'AD0']], { settings: Object.assign({ reshuffleOnce: true }, extra) });
  s.stocks = [['4S0'], ['5S0', '6S0'], ['7S0', '8S0'], ['9S0', 'TS0']];
  s.discard = ['JS0', 'QS0', 'KS0']; return s;
}
t('first empty pile recycles after both cards are drawn, preserving the top discard', () => {
  const s = recyclingGame(); const before = allCards(s); const hand = s.players[0].hand.slice();
  const result = G.drawStock(s, 0, [0, 1]); ok(result.ok); ok(result.reshuffled);
  eq(s.players[0].hand, hand.concat(['4S0', '5S0'])); eq(s.discard, ['KS0']);
  eq(s.stocks.map(p => p.length), [2, 2, 2, 1]); eq(s.reshufflesUsed, 1);
  eq(s.turnPhase, 'play'); eq(allCards(s), before);
  ok(!s.stocks.flat().some(c => c === '4S0' || c === '5S0'));
  eq(s.log.slice(-2).map(e => e.t), ['draw', 'reshuffle']);
});
t('a draw that leaves all four piles occupied does not consume the recycle', () => {
  const s = recyclingGame(); s.stocks[0].push('4H0');
  ok(G.drawStock(s, 0, [0, 1]).ok); eq(s.reshufflesUsed, 0); eq(s.discard.length, 3);
});
t('second exhaustion ends the round after drawing without scoring twice', () => {
  const s = recyclingGame(); s.reshufflesUsed = 1; const before = allCards(s);
  ok(G.drawStock(s, 0, [0, 1]).roundEnded); eq(s.phase, 'roundEnd');
  eq(s.scores.length, 1); eq(s.discard.length, 3); eq(s.reshufflesUsed, 1); eq(allCards(s), before);
  no(G.drawStock(s, 0, [1, 2])); eq(s.scores.length, 1);
});
t('recycle disabled retains the original last-stock behavior', () => {
  const s = recyclingGame({ reshuffleOnce: false });
  ok(G.drawStock(s, 0, [0, 1]).ok); eq(s.phase, 'playing'); eq(s.reshufflesUsed, 0);
  eq(s.stocks[0].length, 0); eq(s.discard.length, 3);
});
t('taking melds back never undoes a stock recycle or restores drawn stock cards', () => {
  const s = recyclingGame(); ok(G.drawStock(s, 0, [0, 1]).ok);
  const stocks = JSON.stringify(s.stocks); const hand = s.players[0].hand.slice();
  ok(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']).ok); ok(G.undoTurnMelds(s, 0).ok);
  eq(JSON.stringify(s.stocks), stocks); eq(s.players[0].hand, hand);
  eq(s.reshufflesUsed, 1); eq(s.discard, ['KS0']);
});
t('persisted recycle usage still ends the second exhausted draw', () => {
  const s = recyclingGame(); s.reshufflesUsed = 1;
  const loaded = JSON.parse(JSON.stringify(s)); ok(G.drawStock(loaded, 0, [0, 1]).roundEnded);
  eq(loaded.reshufflesUsed, 1); eq(loaded.log.filter(e => e.t === 'reshuffle').length, 0);
});
t('too few recyclable cards ends cleanly and conserves every card', () => {
  const s = recyclingGame(); s.stocks = [['4S0'], ['5S0'], [], []]; s.discard = ['KS0'];
  const before = allCards(s); ok(G.drawStock(s, 0, [0, 1]).roundEnded);
  eq(s.reshufflesUsed, 1); eq(s.discard, ['KS0']); eq(allCards(s), before);
});
t('red-three replacement exhaustion retries atomically using the one recycle', () => {
  const s = recyclingGame({ redThreeAutoLayOff: true });
  s.stocks = [['3H0'], ['3D0'], [], []];
  s.discard = ['4H0', '5H0', '6H0', '7H0', '8H0', '9H0', 'TH0', 'KS0'];
  const before = allCards(s); const handLength = s.players[0].hand.length;
  ok(G.drawStock(s, 0, [0, 1]).ok); eq(s.reshufflesUsed, 1); eq(allCards(s), before);
  eq(s.players[0].hand.length, handLength + 2); ok(s.players[0].hand.every(c => !E.isRedThree(c)));
  eq(s.discard, ['KS0']);
});

console.log('\n-- arrival replacement and terminal turns --');
// Small, disjoint card zones make conservation failures unambiguous. These
// are late-round positions, so a deal is deliberately unnecessary.
function arrivalGame(options = {}) {
  const s = G.createGame(['A', 'B'], Object.assign({ redThreeAutoLayOff: true, reshuffleOnce: false }, options.settings));
  s.phase = 'playing'; s.turnPhase = options.turnPhase || 'play';
  s.stocks = options.stocks || [['4S0', '5S0'], ['4H0', '5H0'], ['4D0', '5D0'], ['4C0', '5C0']];
  s.discard = options.discard || ['KS0'];
  Object.assign(s.players[0], {
    hand: options.hand || ['AS0', 'AH0', 'AD0'],
    foot: options.foot || ['3H0', '6S0', '7S0', '8S0', '9S0'],
    inFoot: !!options.inFoot, hasInitialMeld: true, melds: options.melds || [],
  });
  s.turnState = { melded: 0, tookPile: false, drew: s.turnPhase === 'play',
    pickedUpFoot: false, picked: [], logMark: 0, snapshot: JSON.stringify(s.players[0]) };
  return s;
}
function zones(s) {
  return JSON.stringify({ players: s.players, stocks: s.stocks, discard: s.discard, reshufflesUsed: s.reshufflesUsed });
}
t('the final one or two stock cards allow a last turn then score for either discard top', () => {
  for (const count of [1, 2]) for (const card of ['3C0', '9C0']) {
    const s = arrivalGame({ hand: [card], turnPhase: 'draw', settings: { redThreeAutoLayOff: false },
      stocks: count === 1 ? [['4S0'], [], [], []] : [['4S0'], ['5S0'], [], []] });
    const before = allCards(s);
    ok(G.drawStock(s, 0, count === 2 ? [0, 1] : []).ok);
    eq(s.phase, 'playing'); eq(s.turnPhase, 'play'); eq(s.scores.length, 0);
    eq(s.players[0].hand.length, count + 1); eq(G.stockCount(s), 0);
    eq(s.log.find(e => e.t === 'draw').n, count);
    ok(G.discard(s, 0, card).roundEnded); eq(s.phase, 'roundEnd'); eq(s.scores.length, 1);
    eq(s.discard[s.discard.length - 1], card); eq(allCards(s), before);
    no(G.drawStock(s, 1, [])); no(G.discard(s, 0, '4S0')); eq(s.scores.length, 1);
  }
});
t('a final no-recycle draw may still be melded to win', () => {
  const s = arrivalGame({ hand: ['KH0', 'KD0'], foot: [], inFoot: true, turnPhase: 'draw',
    stocks: [['KC0'], [], [], []], settings: { bookSize: 3, requireRedBook: 1, requireBlackBook: 0 } });
  const before = allCards(s); ok(G.drawStock(s, 0, []).ok); eq(s.phase, 'playing');
  ok(G.meldNew(s, 0, 'K', ['KH0', 'KD0', 'KC0']).roundEnded);
  ok(s.players[0].wentOut); eq(s.outSeat, 0); eq(s.scores.length, 1); eq(allCards(s), before);
});
t('automatic deal replacements preserve hand size and every card', () => {
  let seen = 0;
  for (let seed = 0; seed < 30; seed++) {
    const s = G.createGame(['A', 'B'], { deckCount: 2, handSize: 5, footSize: 5, redThreeAutoLayOff: true });
    ok(G.startRound(s, mulberry(seed)).ok);
    s.players.forEach(p => { eq(p.hand.length, 5); ok(p.hand.every(c => !E.isRedThree(c))); seen += p.redThrees.length; });
    eq(allCards(s), E.buildDeck(2).sort());
  }
  ok(seen > 0);
});
t('both meld paths and discard replace foot red threes, including replacement chains', () => {
  for (const path of ['new', 'add', 'discard']) for (const chained of [false, true]) {
    const s = arrivalGame();
    if (chained) s.stocks[0].unshift('3D0');
    if (path === 'add') {
      s.players[0].hand = ['AD0'];
      s.players[0].melds = [{ id: 'aces', rank: 'A', cards: ['AS0', 'AH0', 'AC0'] }];
    }
    if (path === 'discard') s.players[0].hand = ['AS0'];
    s.turnState.snapshot = JSON.stringify(s.players[0]);
    const before = allCards(s), beforeZones = zones(s), stock = G.stockCount(s);
    const result = path === 'new' ? G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']) :
      path === 'add' ? G.meldAdd(s, 0, 'aces', ['AD0']) : G.discard(s, 0, 'AS0');
    ok(result.ok, path); eq(s.phase, 'playing'); ok(s.players[0].inFoot);
    eq(s.players[0].hand, ['4S0', '6S0', '7S0', '8S0', '9S0']);
    eq(s.players[0].redThrees, chained ? ['3H0', '3D0'] : ['3H0']);
    eq(G.stockCount(s), stock - (chained ? 2 : 1)); eq(allCards(s), before);
    if (path !== 'discard') {
      ok(G.undoTurnMelds(s, 0).ok); eq(zones(s), beforeZones); eq(allCards(s), before);
      eq(s.log.filter(e => ['meld', 'foot'].includes(e.t)), []);
    } else eq(s.turn, 1);
  }
});
t('pile pickup replaces red threes and undo restores the replacement stocks and packet', () => {
  for (const chained of [false, true]) {
    const s = arrivalGame({ turnPhase: 'draw', hand: ['AH0', 'AD0', '9C0'],
      foot: ['6S0', '7S0'], discard: ['3H0', 'AS0'] });
    if (chained) s.stocks[0].unshift('3D0');
    const before = allCards(s), beforeZones = zones(s);
    ok(G.takePile(s, 0, ['AH0', 'AD0']).ok);
    eq(s.players[0].hand, ['9C0', '4S0']);
    eq(s.players[0].redThrees, chained ? ['3H0', '3D0'] : ['3H0']); eq(allCards(s), before);
    ok(G.undoTurnMelds(s, 0).ok); eq(zones(s), beforeZones); eq(s.turnPhase, 'draw'); eq(allCards(s), before);
  }
});
t('an illegal foot entry rolls back its replacement stock and turn history atomically', () => {
  const s = arrivalGame({ foot: ['3H0'] }); const before = JSON.stringify(s);
  no(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0'])); eq(JSON.stringify(s), before);
});
t('a replacement can recycle during the chain and undo restores all recycled zones', () => {
  const s = arrivalGame({ settings: { reshuffleOnce: true }, stocks: [['3D0'], [], [], []],
    discard: ['4S0', '5S0', '4H0', '5H0', '4D0', '5D0', '4C0', '5C0', 'TC0', 'JC0', 'KS0'] });
  const before = allCards(s), beforeZones = zones(s);
  ok(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']).ok);
  eq(s.phase, 'playing'); eq(s.reshufflesUsed, 1); eq(s.discard, ['KS0']);
  eq(s.players[0].hand.length, 5); eq(s.players[0].redThrees, ['3H0', '3D0']); eq(allCards(s), before);
  ok(G.undoTurnMelds(s, 0).ok); eq(zones(s), beforeZones); eq(allCards(s), before);
  eq(s.log.filter(e => e.t === 'reshuffle').length, 0);
});
t('pile replacement recycling can be handed back with its original stocks and discard', () => {
  const s = arrivalGame({ turnPhase: 'draw', settings: { reshuffleOnce: true, pileTakeExtra: 1 },
    hand: ['AH0', 'AD0', '9C0'], foot: ['6S0', '7S0'], stocks: [['4S0'], ['5S0'], ['6C0'], ['7C0']],
    discard: ['8C0', 'TC0', 'JC0', 'QC0', '3H0', 'AS0'] });
  const before = allCards(s), beforeZones = zones(s);
  ok(G.takePile(s, 0, ['AH0', 'AD0']).ok); eq(s.reshufflesUsed, 1); eq(s.phase, 'playing');
  eq(s.discard, ['QC0']); eq(allCards(s), before);
  ok(G.undoTurnMelds(s, 0).ok); eq(zones(s), beforeZones); eq(allCards(s), before);
});
t('undo of foot replacements preserves the earlier stock draw and its recycle', () => {
  const s = arrivalGame({ turnPhase: 'draw', hand: ['AS0'], settings: { reshuffleOnce: true },
    stocks: [['AH0'], ['AD0', '4S0', '5S0'], ['4H0', '5H0', 'TC0'], ['4D0', '5D0', 'JC0']],
    discard: ['QS0', 'QH0', 'QD0', 'QC0', 'KS0', 'KH0', 'KD0'] });
  const before = allCards(s);
  ok(G.drawStock(s, 0, [0, 1]).ok); eq(s.reshufflesUsed, 1); const afterDraw = zones(s);
  ok(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']).ok); ok(G.undoTurnMelds(s, 0).ok);
  eq(zones(s), afterDraw); eq(s.reshufflesUsed, 1); eq(allCards(s), before);
  eq(s.log.filter(e => e.t === 'reshuffle').length, 1); eq(s.turnPhase, 'play');
});
t('replacement at second exhaustion or insufficient recycling scores once and conserves every card', () => {
  for (const used of [0, 1]) for (const path of ['foot', 'pile']) {
    const s = arrivalGame({ settings: { reshuffleOnce: true }, stocks: [['4S0'], [], [], []],
      ...(path === 'pile' ? { turnPhase: 'draw', hand: ['AH0', 'AD0', '9C0'],
        foot: ['6S0', '7S0'], discard: ['3H0', 'AS0'] } : {}) });
    s.reshufflesUsed = used; const before = allCards(s);
    const result = path === 'foot' ? G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']) : G.takePile(s, 0, ['AH0', 'AD0']);
    ok(result.roundEnded);
    eq(s.phase, 'roundEnd'); eq(s.scores.length, 1); eq(s.reshufflesUsed, 1);
    eq(s.players[0].hand.length, path === 'foot' ? 5 : 2); eq(allCards(s), before);
    no(G.undoTurnMelds(s, 0)); no(G.discard(s, 0, '4S0')); eq(s.scores.length, 1);
  }
});
t('replacement exhaustion still transfers the rest of a picked-up packet before scoring', () => {
  const s = arrivalGame({ turnPhase: 'draw', hand: ['AH0', 'AD0', '9C0'], foot: ['6S0', '7S0'],
    discard: ['3H0', '9H0', '3D0', 'AS0'], stocks: [[], [], [], []] });
  const before = allCards(s); ok(G.takePile(s, 0, ['AH0', 'AD0']).roundEnded);
  eq(s.players[0].hand, ['9C0', '9H0']); eq(s.players[0].redThrees, ['3H0', '3D0']);
  eq(allCards(s), before); eq(s.scores.length, 1); eq(s.phase, 'roundEnd');
});
t('an all-red-three foot either receives every replacement or scores at exhaustion', () => {
  const foot = ['3H0', '3D0', '3H1', '3D1', '3H2'];
  for (const path of ['meld', 'discard']) for (const supply of [0, 2, 5]) {
    const s = arrivalGame({ foot: foot.slice(), hand: path === 'meld' ? ['AS0', 'AH0', 'AD0'] : ['AS0'],
      stocks: [['4S0', '5S0', '6S0', '7S0', '8S0'].slice(0, supply), [], [], []] });
    const before = allCards(s);
    const result = path === 'meld' ? G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']) : G.discard(s, 0, 'AS0');
    ok(result.ok); eq(s.players[0].redThrees, foot); eq(s.players[0].hand.length, supply);
    eq(allCards(s), before); ok(!s.players[0].wentOut);
    if (supply < 5 || path === 'discard') { ok(result.roundEnded); eq(s.scores.length, 1); }
    else { eq(s.phase, 'playing'); ok(G.discard(s, 0, '4S0').roundEnded); }
  }
});

console.log('\n-- full games --');
/* `noPile` is how the turn is replayed after handing the pile back: taking it
 * again would only land in the same place, so the retry draws from stock. */
function bot(s, seat, noPile) {
  const p = s.players[seat];
  // draw
  if (s.turnPhase === 'draw') {
    let took = false;
    const top = s.discard[s.discard.length - 1];
    if (!noPile && top && !E.isWild(top) && !E.isBlackThree(top) && !E.isRedThree(top)) {
      const r = E.rankOf(top);
      const nat = p.hand.filter((c) => !E.isWild(c) && E.rankOf(c) === r);
      if (nat.length >= 2) {
        const extra = p.hand.filter((c) => !E.isWild(c) && E.rankOf(c) === r).slice(0, 5);
        took = G.takePile(s, seat, extra.length >= 2 ? extra : nat.slice(0, 2)).ok;
      }
    }
    if (!took) {
      const live = G.livePiles(s);
      const pick = live.length >= 2 ? [live[seat % live.length], live[(seat + 1) % live.length]] : [];
      const chosen = (pick.length === 2 && pick[0] !== pick[1]) ? pick : (live.length >= 2 ? [live[0], live[1]] : []);
      const r = G.drawStock(s, seat, chosen);
      if (!r.ok || s.phase !== 'playing') return;
    }
  }
  if (s.phase !== 'playing') return;
  // meld greedily
  for (let guard = 0; guard < 30; guard++) {
    let acted = false;
    const byRank = {};
    for (const c of p.hand) {
      if (E.isWild(c) || E.rankOf(c) === '3') continue;
      (byRank[E.rankOf(c)] = byRank[E.rankOf(c)] || []).push(c);
    }
    for (const m of p.melds) {
      const add = (byRank[m.rank] || []).slice(0, 7 - m.cards.length);
      if (add.length && G.meldAdd(s, seat, m.id, add).ok) { acted = true; break; }
    }
    if (acted) continue;
    for (const r of Object.keys(byRank)) {
      if (p.melds.some((m) => m.rank === r)) continue;
      const cards = byRank[r].slice(0, 7);
      if (cards.length >= 3 && G.meldNew(s, seat, r, cards).ok) { acted = true; break; }
    }
    if (!acted) break;
  }
  // discard the cheapest card, undoing a short initial meld if need be
  for (let attempt = 0; attempt < 3; attempt++) {
    // Red threes are discardable now, and they are the first thing to shed --
    // a hundred against you for as long as you hold one.
    const cands = p.hand.slice().sort((a, b) =>
      (E.isRedThree(b) ? 1 : 0) - (E.isRedThree(a) ? 1 : 0) ||
      E.cardValue(a) - E.cardValue(b));
    if (!cands.length) return;
    let discarded = false;
    for (const c of cands) {
      const r = G.discard(s, seat, c);
      if (r.ok) { discarded = true; break; }
      if (r.code === 'initial_meld_short') {
        const tookPile = s.turnState && s.turnState.tookPile;
        G.undoTurnMelds(s, seat);
        // Handing the pile back rewinds to the draw, so the turn is played again
        // from there rather than continuing half-finished.
        if (tookPile && !noPile) return bot(s, seat, true);
        break;
      }
    }
    if (discarded) return;
  }
}

t('1200 random games finish without stalling or losing a card', () => {
  for (let seed = 0; seed < 1200; seed++) {
    const n = 2 + (seed % 5);
    const names = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, n);
    const s = G.createGame(names);
    G.startRound(s, mulberry(seed * 977 + 13));
    const deckTotal = (n + 2) * 54;
    let turns = 0;
    while (s.phase === 'playing' && turns++ < 4000) {
      const before = s.turn;
      bot(s, s.turn);
      if (s.phase !== 'playing') break;
      if (s.turn === before && s.turnPhase !== 'draw') {
        throw new Error('seed ' + seed + ' stalled on seat ' + before);
      }
    }
    if (turns >= 4000) throw new Error('seed ' + seed + ' never ended');
    const counted = G.stockCount(s) + s.discard.length + s.players.reduce(
      (acc, p) => acc + p.hand.length + p.foot.length + p.redThrees.length +
        p.melds.reduce((a, m) => a + m.cards.length, 0), 0);
    if (counted !== deckTotal) {
      throw new Error('seed ' + seed + ': ' + counted + ' cards, expected ' + deckTotal);
    }
  }
});

t('a four-round game reaches gameEnd with four score rows', () => {
  const s = G.createGame(['A', 'B', 'C']);
  G.startRound(s, mulberry(42));
  for (let guard = 0; guard < 20; guard++) {
    let turns = 0;
    while (s.phase === 'playing' && turns++ < 4000) bot(s, s.turn);
    if (s.phase !== 'roundEnd') break;
    const r = G.nextRound(s);
    if (r.gameEnded) break;
  }
  eq(s.phase, 'gameEnd');
  eq(s.scores.length, 4);
  eq(G.totals(s).length, 3);
});

console.log('\n' + pass + ' passed, ' + failn + ' failed\n');
process.exit(failn ? 1 : 0);
