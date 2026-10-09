/* The bot is also a fuzz test of the referee.
 *
 * It decides only from the redacted view, and every move goes through the same
 * validation a human's does. So a game where the bot never has a move refused
 * is evidence that the rules engine and the bot agree about what is legal —
 * and any refusal is a real disagreement worth looking at. */

const E = require('./engine.js');
const G = require('./game.js');
const BOT = require('./bot.js');
const assert = require('node:assert/strict');

let pass = 0, failed = 0;
const problems = [];
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name); problems.push(name); }
}

function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Build exactly what the server would send this seat — nothing more. */
function viewFor(g, seat) {
  const S = g.settings;
  return {
    phase: g.phase,
    round: g.round,
    minMeld: G.minMeldFor(g),
    roundsTotal: S.minMelds.length,
    turn: g.turn,
    turnPhase: g.turnPhase,
    turnState: g.turnState
      ? { melded: g.turnState.melded, tookPile: g.turnState.tookPile, drew: g.turnState.drew }
      : null,
    settings: Object.assign({}, S, { minMelds: S.minMelds.slice() }),
    seats: g.seats.map(function (s, i) {
      const p = g.players[i];
      return {
        name: s.name, handCount: p.hand.length, footCount: p.foot.length,
        inFoot: p.inFoot, hasInitialMeld: p.hasInitialMeld,
        redThrees: p.redThrees.length,
        melds: p.melds.map(function (m) {
          return { id: m.id, rank: m.rank, cards: m.cards.slice() };
        }),
      };
    }),
    you: {
      seat: seat,
      hand: g.players[seat].hand.slice(),
      inFoot: g.players[seat].inFoot,
      footCount: g.players[seat].foot.length,
      hasInitialMeld: g.players[seat].hasInitialMeld,
      canGoOut: g.phase === 'playing' ? G.canGoOut(g, seat) : { ok: false, reason: '' },
    },
    stocks: (g.stocks || []).map(function (p) { return p.length; }),
    discardTop: g.discard.length ? g.discard[g.discard.length - 1] : null,
    discardCount: g.discard.length,
    scores: g.scores,
  };
}

function applyMove(g, seat, move) {
  switch (move.action) {
    case 'draw': return G.drawStock(g, seat, move.piles || []);
    case 'pile': return G.takePile(g, seat, move.cards || []);
    case 'meldNew': return G.meldNew(g, seat, move.rank, move.cards || []);
    case 'meldAdd': return G.meldAdd(g, seat, move.meldId, move.cards || []);
    case 'discard': return G.discard(g, seat, move.card);
    case 'undo': return G.undoTurnMelds(g, seat);
    default: return { ok: false, reason: 'unknown action ' + move.action };
  }
}

console.log('\n-- the bot plays by the rules --');

const refusals = [];
let gamesFinished = 0, roundsScored = 0, handsSeen = 0;
let sawPileTake = false, sawFoot = false, sawGoOut = false, sawBook = false;

const baselineRandom = Math.random;
try {
for (let seed = 0; seed < 300; seed++) {
  const rngSeed = seed * 7919 + 5;
  // Cover recycling and later round deals with the same reproducible stream.
  Math.random = mulberry(rngSeed);
  const seats = 2 + (seed % 4);
  const names = ['A', 'B', 'C', 'D', 'E'].slice(0, seats);
  const g = G.createGame(names);
  G.startRound(g);
  const deckTotal = (seats + 2) * 54;

  let steps = 0;
  while (g.phase !== 'gameEnd' && steps++ < 40000) {
    if (g.phase === 'roundEnd') {
      roundsScored++;
      if (G.nextRound(g).gameEnded) break;
      continue;
    }
    if (g.phase !== 'playing') break;

    const seat = g.turn;
    const move = BOT.decide(viewFor(g, seat));
    if (!move) {
      refusals.push({ seed, rngSeed, style: 'balanced', settings: g.settings, seat: seat, reason: 'bot had no move' });
      break;
    }
    if (move.action === 'pile') sawPileTake = true;

    const before = g.turn;
    const r = applyMove(g, seat, move);
    if (!r || !r.ok) {
      refusals.push({ seed, rngSeed, style: 'balanced', settings: g.settings, seat: seat, action: move.action, reason: r && r.reason });
      break;
    }
    if (g.players[seat].inFoot) sawFoot = true;
    if (g.players[seat].wentOut) sawGoOut = true;
    if (g.players[seat].melds.some(function (m) { return m.cards.length >= 7; })) sawBook = true;

    // every card still accounted for, every move
    const counted = (g.stocks || []).reduce(function (n, p) { return n + p.length; }, 0) +
      g.discard.length +
      g.players.reduce(function (n, p) {
        return n + p.hand.length + p.foot.length + p.redThrees.length +
          p.melds.reduce(function (a, m) { return a + m.cards.length; }, 0);
      }, 0);
    if (counted !== deckTotal) {
      refusals.push({ seed, rngSeed, style: 'balanced', settings: g.settings, reason: 'card count ' + counted + ' != ' + deckTotal });
      break;
    }
    if (g.turn !== before) handsSeen++;
  }
  if (g.phase === 'gameEnd') gamesFinished++;
}
} finally { Math.random = baselineRandom; }

ok(refusals.length === 0, '300 bot games with no refused move' +
  (refusals.length ? ' (first: ' + JSON.stringify(refusals[0]) + ')' : ''));
ok(gamesFinished === 300, 'every game reached the end (' + gamesFinished + '/300)');
ok(roundsScored >= 900, 'rounds were scored throughout (' + roundsScored + ')');

console.log('\n-- the bot actually plays the game --');
ok(sawPileTake, 'it takes the discard pile when it can');
ok(sawFoot, 'it gets into its foot');
ok(sawBook, 'it completes books');
ok(sawGoOut, 'it goes out');

console.log('\n-- it only ever sees its own cards --');
{
  const g = G.createGame(['A', 'B', 'C']);
  G.startRound(g, mulberry(99));
  const v = viewFor(g, 0);
  const others = g.players[1].hand.concat(g.players[2].hand);
  const payload = JSON.stringify(v);
  const leaked = others.filter(function (c) {
    return payload.indexOf('"' + c + '"') !== -1 &&
      v.you.hand.indexOf(c) === -1 && v.discardTop !== c;
  });
  ok(leaked.length === 0, 'the view handed to the bot carries no other hand');
  ok(v.seats[1].hand === undefined && v.seats[1].foot === undefined,
    'other seats are counts only');
}

console.log('\n-- it respects the opening minimum --');
{
  const g = G.createGame(['A', 'B']);
  G.startRound(g, mulberry(4));
  const p = g.players[0];
  // three nines is 15 under the real values — nowhere near 50
  p.hand = ['9S0', '9H0', '9D0', '6C1', '7C1'];
  g.turn = 0; g.turnPhase = 'play';
  g.turnState = { melded: 0, tookPile: false, drew: true, pickedUpFoot: false, snapshot: null };
  const move = BOT.decide(viewFor(g, 0));
  ok(move && move.action === 'discard',
    'with only 15 on the table it discards rather than opening short');
}
{
  const g = G.createGame(['A', 'B']);
  G.startRound(g, mulberry(4));
  const p = g.players[0];
  p.hand = ['AS0', 'AH0', 'AD0', 'KS0', 'KH0', 'KD0', '6C1'];
  g.turn = 0; g.turnPhase = 'play';
  g.turnState = { melded: 0, tookPile: false, drew: true, pickedUpFoot: false, snapshot: null };
  const move = BOT.decide(viewFor(g, 0));
  ok(move && (move.action === 'meldNew') && move.rank === 'A',
    'with aces available it opens on the biggest meld first');
}

console.log('\n-- short piles and finishing a foot --');
function closingGame(hand) {
  const g = G.createGame(['A', 'B']);
  G.startRound(g, mulberry(7));
  const p = g.players[0];
  p.hand = hand.slice(); p.inFoot = true; p.foot = []; p.hasInitialMeld = true;
  g.turnPhase = 'play'; g.turnState.drew = true;
  p.melds = [
    { id: 'r', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] },
    { id: 'b', rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', '2H0'] },
  ];
  return g;
}
{
  const g = closingGame(['KS2', 'KH2']);
  g.players[0].melds = []; g.turnPhase = 'draw'; g.turnState.drew = false;
  g.discard = ['KS3'];
  const move = BOT.decide(viewFor(g, 0));
  ok(move.action === 'draw' && applyMove(g, 0, move).ok,
    'a short pile that would strand the foot is passed over for a legal stock draw');
}
{
  const g = closingGame(['KS2', 'KH2', 'KD2', '9C0']);
  g.players[0].melds = []; g.turnPhase = 'draw'; g.turnState.drew = false;
  g.discard = ['KS3'];
  const move = BOT.decide(viewFor(g, 0));
  ok(move.action === 'pile' && move.cards.length === 2 && applyMove(g, 0, move).ok,
    'a short pile take uses only the pair when the third natural must stay in hand');
}
{
  const g = closingGame(['QS1', 'QH1']);
  const move = BOT.decide(viewFor(g, 0));
  ok(move.action === 'meldAdd' && applyMove(g, 0, move).roundEnded,
    'the bot goes out when its last play itself completes the required black book');
}
{
  const g = closingGame(['KS2', 'QS2']);
  g.players[0].melds[1].cards.push('QS1', 'QH1');
  const first = BOT.decide(viewFor(g, 0));
  const firstResult = applyMove(g, 0, first);
  const last = BOT.decide(viewFor(g, 0));
  ok(first.action === 'meldAdd' && firstResult.ok && last &&
    last.action === 'meldAdd' && applyMove(g, 0, last).roundEnded,
  'two final cards can go into different books in consecutive winning plays');
}
{
  const g = closingGame(['KS2', '3S1']);
  g.players[0].melds[1].cards.push('QS1', 'QH1');
  const move = BOT.decide(viewFor(g, 0));
  ok(move.action === 'discard' && move.card === '3S1' && applyMove(g, 0, move).ok,
    'a dead final card is discarded before a playable natural, preventing a one-card trap');
}
{
  const g = closingGame(['KS2', '2D1']);
  g.players[0].melds[1].cards.push('QS1', 'QH1');
  const first = BOT.decide(viewFor(g, 0));
  const firstResult = applyMove(g, 0, first);
  const last = BOT.decide(viewFor(g, 0));
  ok(first.action === 'meldAdd' && firstResult.ok && last &&
    last.action === 'meldAdd' && last.cards[0] === '2D1' && applyMove(g, 0, last).roundEnded,
    'a final wild can finish on an existing black book without stalling the bot');
}
{
  const g = G.createGame(['A', 'B']);
  G.startRound(g, mulberry(7));
  g.players[0].hand = ['KH0', 'KD0', '9C0'];
  g.discard = ['KS0'];
  g.turnState.snapshot = JSON.stringify(g.players[0]);
  const took = G.takePile(g, 0, ['KH0', 'KD0']);
  const move = BOT.decide(viewFor(g, 0));
  ok(took.ok && move.action === 'undo' && applyMove(g, 0, move).ok && g.turnPhase === 'draw',
    'an unfinished pile opening is returned rather than proposing an illegal discard');
}

/* Small decision fixtures use a real deck without duplicated or lost cards.
 * They prove exact choices and legal follow-through, not a win-rate target. */
function decisionGame(hand, options = {}) {
  const g = G.createGame(['Bot', 'Opponent'], options.settings || {});
  assert(G.startRound(g, mulberry(404)).ok);
  const p = g.players[0];
  p.hand = hand.slice(); p.inFoot = !!options.inFoot;
  p.hasInitialMeld = options.opened !== false;
  p.melds = JSON.parse(JSON.stringify(options.melds || []));
  g.discard = (options.discard || ['6D3']).slice();
  g.players.forEach(player => { player.redThrees = []; player.foot = []; });
  g.players[1].hand = []; g.players[1].melds = [];
  const used = hand.concat(g.discard, ...p.melds.map(m => m.cards));
  const deck = E.buildDeck(E.deckCountFor(g.settings, 2));
  assert.equal(new Set(used).size, used.length, 'fixture card IDs must be unique');
  assert(used.every(c => deck.includes(c)), 'fixture cards belong to the configured deck');
  const rest = deck.filter(c => !used.includes(c));
  if (!p.inFoot) p.foot = rest.splice(0, g.settings.footSize);
  g.players[1].hand = rest.splice(0, g.settings.handSize);
  g.players[1].foot = rest.splice(0, g.settings.footSize);
  g.stocks = [[], [], [], []];
  rest.forEach((c, i) => g.stocks[i % 4].push(c));
  g.turn = 0; g.turnPhase = options.phase || 'play';
  g.turnState = { melded: 0, tookPile: false, drew: g.turnPhase === 'play', pickedUpFoot: false };
  g.turnState.snapshot = JSON.stringify({ hand: p.hand, foot: p.foot, inFoot: p.inFoot,
    melds: p.melds, redThrees: p.redThrees, hasInitialMeld: p.hasInitialMeld });
  return g;
}
function conserved(g) {
  const cards = g.stocks.flat().concat(g.discard, ...g.players.map(p =>
    p.hand.concat(p.foot, p.redThrees, ...p.melds.map(m => m.cards))));
  const total = E.deckCountFor(g.settings, g.players.length) * 54;
  return cards.length === total && new Set(cards).size === total;
}
const redKings = { id: 'red', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1', 'KD1'] };
const fiveQueens = { id: 'five-queens', rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', 'QS1'] };

console.log('\n-- audited legal opportunities --');
for (const style of BOT.STYLES) {
  {
    const g = decisionGame(['XR0', 'XB0'], { inFoot: true, melds: [redKings, fiveQueens] });
    const move = BOT.decide(viewFor(g, 0), style);
    const result = move && applyMove(g, 0, move);
    ok(move.action === 'meldAdd' && move.meldId === 'five-queens' && move.cards.length === 2 &&
      result.ok && result.roundEnded && g.players[0].wentOut && conserved(g),
      style + ': both final jokers complete the missing black book and immediately win');
  }
  {
    const g = decisionGame(['XR0', 'XB0'], { inFoot: true,
      settings: { maxWildsInBook: 1 }, melds: [redKings, fiveQueens] });
    const move = BOT.decide(viewFor(g, 0), style);
    ok(move.action === 'discard' && applyMove(g, 0, move).ok && conserved(g),
      style + ': the winning pass respects the configured wild cap');
  }
  {
    const g = decisionGame(['XR0', 'XB0'], { inFoot: true,
      settings: { requireBlackBook: 0 }, melds: [redKings] });
    const move = BOT.decide(viewFor(g, 0), style);
    ok(move.action === 'discard' && applyMove(g, 0, move).ok && conserved(g),
      style + ': the winning pass never spoils a completed red book');
  }
  for (const minMeld of [50, 120]) {
    const hand = ['KS0', 'KH0', 'KD0', 'XR0', '3S0'];
    if (minMeld === 120) hand.push('XB0');
    const g = decisionGame(hand, { opened: false, settings: { minMelds: [minMeld, minMeld, minMeld, minMeld] } });
    const plan = BOT.planOpening(viewFor(g, 0));
    const move = BOT.decide(viewFor(g, 0), style);
    const laid = move && applyMove(g, 0, move);
    const discarded = laid && laid.ok && G.discard(g, 0, '3S0');
    ok(plan.length === 1 && move.action === 'meldNew' && move.rank === 'K' &&
      move.cards.filter(E.isWild).length === (minMeld === 50 ? 1 : 2) &&
      laid.ok && discarded.ok && g.players[0].hasInitialMeld && conserved(g),
      style + ': supplements a natural triple to clear opening ' + minMeld);
  }
  {
    const g = decisionGame(['KS0', 'KH0', 'KD0', 'QS0', 'QH0', 'XR0', 'XB0', '3S0'],
      { opened: false, settings: { minMelds: [140, 140, 140, 140] } });
    const plan = BOT.planOpening(viewFor(g, 0));
    const planned = plan.flatMap(m => m.cards);
    let valid = plan.length === 2 && new Set(planned).size === planned.length;
    for (let step = 0; step < 2; step++) {
      const move = BOT.decide(viewFor(g, 0), style);
      valid = valid && !!move && move.action === 'meldNew' && applyMove(g, 0, move).ok;
    }
    ok(valid && G.discard(g, 0, '3S0').ok && g.players[0].hasInitialMeld && conserved(g),
      style + ': a supplemented triple and pair own separate wilds and replan to a complete opening');
  }
  for (const target of [null,
    { id: 'open-kings', rank: 'K', cards: ['KS1', 'KH1', 'KD1'] },
    { id: 'closed-kings', rank: 'K', cards: ['KS1', 'KH1', 'KD1', 'KC1', 'KS2', 'KH2', 'KD2'] }]) {
    const g = decisionGame(['KS0', 'KH0', 'KD0', 'KC0', '9S0'],
      { inFoot: true, melds: target ? [target] : [] });
    const move = BOT.decide(viewFor(g, 0), style);
    ok((move.action === 'meldNew' || move.action === 'meldAdd') && move.cards.length === 3 &&
      applyMove(g, 0, move).ok && g.players[0].hand.length === 2 &&
      G.discard(g, 0, '9S0').ok && conserved(g),
      style + ': keeps two cards by choosing a smaller natural play for ' + (target ? target.id : 'a new meld'));
  }
  {
    const g = decisionGame(['KS0', 'KH0', 'AS0', 'AH0', 'AD0', '9S0'],
      { opened: false, phase: 'draw', discard: ['KD0'], settings: { pileTakeExtra: 0 } });
    const take = BOT.decide(viewFor(g, 0), style);
    const took = take && applyMove(g, 0, take);
    const opening = BOT.decide(viewFor(g, 0), style);
    ok(take.action === 'pile' && took.ok && opening.action === 'meldNew' && opening.rank === 'A' &&
      applyMove(g, 0, opening).ok && G.discard(g, 0, '9S0').ok &&
      g.players[0].hasInitialMeld && conserved(g),
      style + ': takes a pile whose known second meld completes the opening');
  }
  {
    const g = decisionGame(['KS0', 'KH0', '9S0'], { opened: false, phase: 'draw',
      discard: ['AS0', 'AH0', 'AD0', 'KD0'], settings: { revealPileTake: false } });
    const move = BOT.decide(viewFor(g, 0), style);
    ok(move.action === 'draw' && applyMove(g, 0, move).ok && conserved(g),
      style + ': unknown buried cards cannot justify a pile opening');
  }
  for (const closing of [false, true]) {
    const g = decisionGame(['XR0', 'XB0', '2S0', '2H0', '4S0'], { inFoot: closing,
      settings: { maxWildsInBook: 0, requireBlackBook: 0, requireRedBook: 0 } });
    const move = BOT.decide(viewFor(g, 0), style);
    ok(move.action === 'discard' && E.isJoker(move.card) && applyMove(g, 0, move).ok && conserved(g),
      style + ': zero-wild rules shed the largest dead wild penalty, inFoot=' + closing);
  }
}

console.log('\n-- private computer personalities --');
{
  const g = G.createGame(['A', 'B']);
  G.startRound(g, mulberry(834));
  const p = g.players[0];
  p.hasInitialMeld = true;
  p.hand = ['KS1', 'KH1', 'AD1', 'QS1', 'QH1', 'XR1',
    '9S0', '9H0', '9D0', '9C0', '9S1', '4S1'];
  p.melds = [
    { id: 'open-kings', rank: 'K', cards: ['KS0', 'KH0', 'KD0', 'KC0'] },
    { id: 'clean-aces', rank: 'A', cards: ['AS0', 'AH0', 'AD0', 'AC0', 'AS1', 'AH1'] },
  ];
  g.turn = 0; g.turnPhase = 'play'; g.turnState.drew = true;
  const moves = BOT.STYLES.map(function (style) { return BOT.decide(viewFor(g, 0), style); });
  ok(moves[0].meldId === 'open-kings' && moves[1].meldId === 'clean-aces' &&
    moves[2].rank === 'Q' && moves[3].rank === '9',
    'one legal position produces four distinct priorities: balanced, clean book, valuable new rank, most cards');
  ok(moves.every(function (move) { return applyMove(JSON.parse(JSON.stringify(g)), 0, move).ok; }),
    'all four personality choices obey the same referee');
  ok(JSON.stringify(BOT.decide(viewFor(g, 0))) === JSON.stringify(moves[0]) &&
    JSON.stringify(BOT.chooseAction(viewFor(g, 0), 'unknown')) === JSON.stringify(moves[0]),
    'the default and unknown style retain the original balanced behavior');
}
{
  const g = G.createGame(['A', 'B']);
  G.startRound(g, mulberry(771));
  g.players[0].hasInitialMeld = true;
  g.players[0].hand = ['KS1', 'KH1', '5C1', '6H1', '8D1'];
  g.discard = ['4S0', '5S0', '6S0', '7S0', '8S0', '9S0', 'KS0'];
  const view = viewFor(g, 0);
  const collector = BOT.decide(view, 'collector');
  const runner = BOT.decide(view, 'runner');
  const builder = BOT.decide(view, 'builder');
  ok(collector.action === 'pile' && runner.action === 'draw' && builder.action === 'draw',
    'the collector takes a useful large pile while the runner and patient builder avoid growing this hand');
  ok([collector, runner, builder].every(function (move) {
    return applyMove(JSON.parse(JSON.stringify(g)), 0, move).ok;
  }), 'different pile preferences remain legal');
}

for (const style of BOT.STYLES) {
  const errors = [];
  let finished = 0, sawStyleFoot = false, sawStyleOut = false;
  const realRandom = Math.random;
  try {
    for (let seed = 0; seed < 40; seed++) {
      Math.random = mulberry(71239 + seed * 3559 + BOT.STYLES.indexOf(style) * 99991);
      const seats = 2 + seed % 5;
      const g = G.createGame(['A', 'B', 'C', 'D', 'E', 'F'].slice(0, seats));
      G.startRound(g);
      const totalCards = (seats + 2) * 54;
      let steps = 0;
      while (g.phase !== 'gameEnd' && steps++ < 40000) {
        if (g.phase === 'roundEnd') { G.nextRound(g); continue; }
        const seat = g.turn;
        const move = BOT.decide(viewFor(g, seat), style);
        const result = move && applyMove(g, seat, move);
        if (!result || !result.ok) {
          errors.push({ seed: seed, action: move && move.action, reason: result && result.reason });
          break;
        }
        sawStyleFoot = sawStyleFoot || g.players[seat].inFoot;
        sawStyleOut = sawStyleOut || g.players[seat].wentOut;
        const cards = g.stocks.flat().concat(g.discard, ...g.players.map(function (p) {
          return p.hand.concat(p.foot, p.redThrees, ...p.melds.map(function (m) { return m.cards; }));
        }));
        if (cards.length !== totalCards || new Set(cards).size !== totalCards) {
          errors.push({ seed: seed, reason: 'card conservation failed' });
          break;
        }
      }
      if (g.phase === 'gameEnd') finished++;
    }
  } finally { Math.random = realRandom; }
  ok(errors.length === 0, style + ': 40 deterministic games with no refused move or lost cards' +
    (errors.length ? ' — ' + JSON.stringify(errors[0]) : ''));
  ok(finished === 40, style + ': every game reaches the four-round finish (' + finished + '/40)');
  ok(sawStyleFoot && sawStyleOut, style + ': reaches the foot and plays out, beyond waiting for stock exhaustion');
}


console.log('\n-- custom table rules --');
{
  const g = G.createGame(['A', 'B'], { bookSize: 3, minNaturalsInMeld: 3 });
  G.startRound(g, mulberry(933));
  g.players[0].hasInitialMeld = true;
  g.players[0].hand = ['KS0', 'KH0', 'KD0', 'XR0', '4S0'];
  g.turnPhase = 'play'; g.turnState.drew = true;
  ok(BOT.STYLES.every(style => {
    const copy = JSON.parse(JSON.stringify(g)), move = BOT.decide(viewFor(copy, 0), style);
    return move && move.action === 'meldNew' && move.cards.length === 4 &&
      applyMove(copy, 0, move).ok && E.meldStats(copy.players[0].melds[0], copy.settings).isBlackBook;
  }), 'all styles can build a required black book with a three-card book and three-natural minimum');
}
for (const overrides of [{ maxWildsInBook: 0, requireBlackBook: 0 }, { minNaturalsInMeld: 3 }]) {
  const g = G.createGame(['A', 'B'], overrides); G.startRound(g, mulberry(934));
  g.players[0].hand = ['KS0', 'KH0', 'XR0', '4S0'];
  g.turnPhase = 'play'; g.turnState.drew = true;
  for (const opened of [false, true]) {
    g.players[0].hasInitialMeld = opened;
    ok(BOT.STYLES.every(style => {
      const copy = JSON.parse(JSON.stringify(g)); const move = BOT.decide(viewFor(copy, 0), style);
      return move && move.action === 'discard' && applyMove(copy, 0, move).ok;
    }), 'all bot styles avoid forbidden pair-plus-wild ' + JSON.stringify(overrides) + ' opened=' + opened);
  }
}
const presets = [
  { deckCount: 2, handSize: 5, footSize: 5, bookSize: 3, minMelds: [0, 20, 40, 60], requireRedBook: 0, requireBlackBook: 0 },
  { deckCount: 3, handSize: 8, footSize: 6, maxWildsInBook: 0, requireBlackBook: 0, requireRedBook: 2, minMelds: [20, 40, 60, 80] },
  { deckCount: 4, handSize: 12, footSize: 15, minNaturalsInMeld: 3, maxWildsInBook: 4, bookSize: 10, pileTakeExtra: 19, requireRedBook: 0, requireBlackBook: 1 },
  { deckCount: 3, handSize: 7, footSize: 9, minNaturalsInMeld: 3, bookSize: 3, redThreeAutoLayOff: true, redThreeValue: -200, pileTakeExtra: 0 },
  { deckCount: 4, handSize: 20, footSize: 5, reshuffleOnce: false, redThreeAutoLayOff: true, minMelds: [100, 150, 250, 500], requireBlackBook: 2 },
];
for (const style of BOT.STYLES) {
  const errors = []; let finished = 0; const realRandom = Math.random;
  try {
    for (let preset = 0; preset < presets.length; preset++) {
      for (let seed = 0; seed < 8; seed++) {
        Math.random = mulberry(8837 + preset * 17747 + seed * 173 + BOT.STYLES.indexOf(style));
        const seats = 2 + seed % 3;
        const g = G.createGame(['A', 'B', 'C', 'D'].slice(0, seats), presets[preset]);
        const started = G.startRound(g);
        if (!started.ok) { errors.push({ preset, seed, reason: started.reason }); continue; }
        const deckTotal = E.deckCountFor(g.settings, seats) * 54; let steps = 0;
        while (g.phase !== 'gameEnd' && steps++ < 40000) {
          if (g.phase === 'roundEnd') { G.nextRound(g); continue; }
          const seat = g.turn; const move = BOT.decide(viewFor(g, seat), style);
          const result = move && applyMove(g, seat, move);
          if (!result || !result.ok) {
            errors.push({ preset, seed, action: move, reason: result && result.reason }); break;
          }
          const cards = g.stocks.flat().concat(g.discard, ...g.players.map(p =>
            p.hand.concat(p.foot, p.redThrees, ...p.melds.map(m => m.cards))));
          if (cards.length !== deckTotal || new Set(cards).size !== deckTotal) {
            errors.push({ preset, seed, reason: 'card conservation failed' }); break;
          }
        }
        if (g.phase === 'gameEnd') finished++;
        else if (steps >= 40000) errors.push({ preset, seed, reason: 'game stalled' });
      }
    }
  } finally { Math.random = realRandom; }
  ok(errors.length === 0, style + ': custom-rule games never propose an illegal move or lose a card' +
    (errors.length ? ' — ' + JSON.stringify(errors[0]) : ''));
  ok(finished === 40, style + ': all 40 custom-rule games finish (' + finished + '/40)');
}

console.log('\n' + pass + ' passed, ' + failed + ' failed');
if (problems.length) problems.forEach(function (p) { console.log('   - ' + p); });
if (refusals.length) {
  console.log('\nrefusals (first 5):');
  refusals.slice(0, 5).forEach(function (r) { console.log('   ' + JSON.stringify(r)); });
}
process.exit(failed ? 1 : 0);
