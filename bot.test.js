/* The bot is also a fuzz test of the referee.
 *
 * It decides only from the redacted view, and every move goes through the same
 * validation a human's does. So a game where the bot never has a move refused
 * is evidence that the rules engine and the bot agree about what is legal —
 * and any refusal is a real disagreement worth looking at. */

const E = require('./engine.js');
const G = require('./game.js');
const BOT = require('./bot.js');

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
    settings: {
      bookSize: S.bookSize, drawCount: S.drawCount,
      distinctDrawPiles: S.distinctDrawPiles,
      pileNaturalsRequired: S.pileNaturalsRequired,
      pileTakeExtra: S.pileTakeExtra, maxWildsInBook: S.maxWildsInBook,
      minMelds: S.minMelds,
    },
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

for (let seed = 0; seed < 300; seed++) {
  const seats = 2 + (seed % 4);
  const names = ['A', 'B', 'C', 'D', 'E'].slice(0, seats);
  const g = G.createGame(names);
  G.startRound(g, mulberry(seed * 7919 + 5));
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
      refusals.push({ seed: seed, seat: seat, reason: 'bot had no move' });
      break;
    }
    if (move.action === 'pile') sawPileTake = true;

    const before = g.turn;
    const r = applyMove(g, seat, move);
    if (!r || !r.ok) {
      refusals.push({ seed: seed, seat: seat, action: move.action, reason: r && r.reason });
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
      refusals.push({ seed: seed, reason: 'card count ' + counted + ' != ' + deckTotal });
      break;
    }
    if (g.turn !== before) handsSeen++;
  }
  if (g.phase === 'gameEnd') gamesFinished++;
}

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

console.log('\n' + pass + ' passed, ' + failed + ' failed');
if (problems.length) problems.forEach(function (p) { console.log('   - ' + p); });
if (refusals.length) {
  console.log('\nrefusals (first 5):');
  refusals.slice(0, 5).forEach(function (r) { console.log('   ' + JSON.stringify(r)); });
}
process.exit(failed ? 1 : 0);
