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
  const s = G.createGame(['A', 'B', 'C'], opts && opts.settings);
  G.startRound(s, mulberry(3));
  hands.forEach((h, i) => { if (h) s.players[i].hand = h.slice(); });
  if (opts && opts.discard) s.discard = opts.discard.slice();
  if (opts && opts.round != null) s.round = opts.round;
  s.turn = 0; s.turnPhase = 'draw'; s.turnState = { melded: 0, tookPile: false, drew: false, pickedUpFoot: false, snapshot: JSON.stringify({ hand: s.players[0].hand, foot: s.players[0].foot, inFoot: false, melds: [] }) };
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
t('in your foot, melding down to one card is fine — you still have a discard', () => {
  const s = rigged([['AS0', 'AH0', 'AD0', '9C0']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['AS0', 'AH0', 'AD0', '9C0'];
  ok(G.meldNew(s, 0, 'A', ['AS0', 'AH0', 'AD0']).ok, 'three aces down');
  eq(p.hand.length, 1, 'one card left to discard');
  ok(G.discard(s, 0, '9C0').ok, 'and the turn ends on it');
  ok(!p.wentOut, 'a discard never goes out');
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
t('a discard can empty your hand without going out', () => {
  const s = rigged([['9C0']]);
  const p = s.players[0];
  p.inFoot = true; p.hasInitialMeld = true; p.foot = [];
  p.melds = [{ id: 'm1', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] }];
  G.drawStock(s, 0, [0, 1]);
  p.hand = ['9C0'];
  ok(G.discard(s, 0, '9C0').ok, 'the last card is a legal discard');
  eq(p.hand.length, 0, 'and the hand is empty');
  ok(!p.wentOut, 'but that is not going out — you draw again next turn');
  eq(s.phase, 'playing');
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
