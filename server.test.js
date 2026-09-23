/* End-to-end: three real websocket clients play a full four-round game against
 * the real server. The point of these tests is the trust boundary — a client
 * must never receive another player's cards, and must never be able to play a
 * card it does not hold. */

process.env.PORT = process.env.TEST_PORT || '3987';
process.env.SAVE_FILE = require('path').join(__dirname, '.test-tables.json');
try { require('fs').unlinkSync(process.env.SAVE_FILE); } catch (e) {}

const WebSocket = require('ws');
const E = require('./engine.js');
const app = require('./server.js');

const URL = 'ws://127.0.0.1:' + process.env.PORT;
let pass = 0, failed = 0;
const problems = [];

function ok(cond, name) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name); problems.push(name); }
}

function client(name) {
  const c = {
    name: name,
    token: 'tok-' + name + '-' + Math.random().toString(36).slice(2, 10),
    view: null,
    errors: [],
    seenPayloads: [],
    ws: null,
    onState: null,
  };
  return new Promise(function (resolve) {
    const ws = new WebSocket(URL);
    c.ws = ws;
    ws.on('open', function () { resolve(c); });
    ws.on('message', function (raw) {
      const msg = JSON.parse(String(raw));
      if (msg.t === 'state') {
        c.view = msg.view;
        c.seenPayloads.push(String(raw));
        if (c.onState) c.onState(msg.view);
      } else if (msg.t === 'error') {
        c.errors.push(msg.message);
      } else if (msg.t === 'joined') {
        c.code = msg.code; c.seat = msg.seat;
      }
    });
  });
}

function send(c, obj) {
  obj.token = c.token;
  c.ws.send(JSON.stringify(obj));
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* poll a plain condition (used for things that arrive on another socket) */
async function untilTrue(fn, label, ms) {
  const deadline = Date.now() + (ms || 3000);
  while (Date.now() < deadline) {
    if (fn()) return true;
    await wait(20);
  }
  throw new Error('timed out waiting for ' + label);
}

/* wait until `test(view)` is true, or give up */
function until(c, test, label, ms) {
  ms = ms || 3000;
  return new Promise(function (resolve, reject) {
    if (c.view && test(c.view)) return resolve(c.view);
    const timer = setTimeout(function () {
      c.onState = null;
      reject(new Error('timed out waiting for ' + label));
    }, ms);
    c.onState = function (v) {
      if (test(v)) { clearTimeout(timer); c.onState = null; resolve(v); }
    };
  });
}

/* ---------- a bot that plays from the view alone ---------- */

function cardValue(c) { return E.cardValue(c); }

function botStep(c) {
  const v = c.view;
  if (!v || v.phase !== 'playing' || v.turn !== v.you.seat) return false;
  const hand = v.you.hand;
  const S = v.settings;

  if (v.turnPhase === 'draw') {
    // take the discard pile when it is clearly available
    if (v.discardTop && !E.isWild(v.discardTop) && !E.isBlackThree(v.discardTop) &&
        !E.isRedThree(v.discardTop)) {
      const r = E.rankOf(v.discardTop);
      const nat = hand.filter(function (x) { return !E.isWild(x) && E.rankOf(x) === r; });
      const value = nat.concat([v.discardTop]).reduce(function (s, x) { return s + cardValue(x); }, 0);
      if (nat.length >= S.pileNaturalsRequired && (v.you.hasInitialMeld || value >= v.minMeld)) {
        send(c, { t: 'action', action: 'pile', cards: nat.slice(0, 6) });
        return true;
      }
    }
    const live = [];
    v.stocks.forEach(function (n, i) { if (n > 0) live.push(i); });
    send(c, {
      t: 'action', action: 'draw',
      piles: live.length >= S.distinctDrawPiles ? [live[0], live[1]] : [],
    });
    return true;
  }

  // play phase: add to open books first
  const mine = v.seats[v.you.seat].melds;
  const byRank = {};
  hand.forEach(function (x) {
    if (E.isWild(x) || E.rankOf(x) === '3') return;
    (byRank[E.rankOf(x)] = byRank[E.rankOf(x)] || []).push(x);
  });

  for (const m of mine) {
    if (m.cards.length >= S.bookSize) continue;
    const add = (byRank[m.rank] || []).slice(0, S.bookSize - m.cards.length);
    // Once in the foot you must keep a card to discard, or the referee refuses
    // the add — and this loop would just offer it again, forever.
    if (v.you.inFoot && hand.length - add.length < 2 && !v.you.canGoOut.ok) continue;
    if (add.length) {
      send(c, { t: 'action', action: 'meldAdd', meldId: m.id, cards: add });
      return true;
    }
  }

  // a new meld, but only when it is legal to stop there
  for (const rank of Object.keys(byRank)) {
    if (mine.some(function (m) { return m.rank === rank; })) continue;
    const cards = byRank[rank].slice(0, S.bookSize);
    if (cards.length < 3) continue;
    const value = cards.reduce(function (s, x) { return s + cardValue(x); }, 0);
    if (!v.you.hasInitialMeld && value < v.minMeld) continue;
    if (v.you.inFoot && hand.length - cards.length < 2 && !v.you.canGoOut.ok) continue;
    send(c, { t: 'action', action: 'meldNew', rank: rank, cards: cards });
    return true;
  }

  // A red three is a legal discard at this table, and the first thing worth
  // shedding -- 100 against you for as long as it is in your hand.
  const droppable = hand.slice().sort(function (a, b) {
    return (E.isRedThree(b) ? 1 : 0) - (E.isRedThree(a) ? 1 : 0) ||
      cardValue(a) - cardValue(b);
  });
  if (!droppable.length) return false;
  send(c, { t: 'action', action: 'discard', card: droppable[0] });
  return true;
}

/* ---------- the run ---------- */

(async function run() {
  console.log('\n-- joining --');
  const a = await client('Vic');
  const b = await client('Dan');
  const d = await client('Sam');

  send(a, { t: 'create', name: 'Vic', seats: 3 });
  await until(a, function (v) { return v.phase === 'lobby'; }, 'table created');
  const code = a.code;
  ok(/^[A-Z]{4}$/.test(code), 'creating a table returns a four-letter code');

  send(b, { t: 'join', code: code, name: 'Dan' });
  send(d, { t: 'join', code: code, name: 'Sam' });
  await until(a, function (v) { return v.seated === 3; }, 'three seated');
  await untilTrue(function () { return b.seat !== undefined && d.seat !== undefined; },
    'both joiners acknowledged');
  ok(a.view.seats.map(function (s) { return s.name; }).join(',') === 'Vic,Dan,Sam',
    'names appear in seat order');
  ok(b.seat === 1 && d.seat === 2, 'joiners take the next free seats');

  const e = await client('Late');
  send(e, { t: 'join', code: code, name: 'Late' });
  await wait(150);
  ok(e.errors.some(function (m) { return /full/i.test(m); }), 'a fourth player is turned away');
  e.ws.close();

  send(b, { t: 'join', code: 'ZZZZ', name: 'Dan' });
  await wait(150);
  ok(b.errors.some(function (m) { return /No table/i.test(m); }), 'a bad code is refused');

  console.log('\n-- a no-show is not dealt in --');
  {
    const h = await client('Host2');
    send(h, { t: 'create', name: 'Host2', seats: 4 });
    await until(h, function (v) { return v.phase === 'lobby'; }, 'second table');
    const g = await client('Guest2');
    send(g, { t: 'join', code: h.code, name: 'Guest2' });
    await until(h, function (v) { return v.seated === 2; }, 'two seated at the second table');
    ok(h.view.seats.length === 4, 'the table starts with four seats');
    send(h, { t: 'action', action: 'start' });
    await until(h, function (v) { return v.phase === 'playing'; }, 'second table dealt');
    ok(h.view.seats.length === 2, 'the two empty seats are dropped at the deal');
    ok(h.view.seats.every(function (s) { return s.handCount === 11; }),
      'only real players are dealt cards');
    ok(h.view.stocks.reduce(function (a, n) { return a + n; }, 0) > 0, 'the piles are built');
    h.ws.close(); g.ws.close();
  }

  console.log('\n-- dealing --');
  const solo = await client('Solo');
  send(solo, { t: 'practice' });
  await until(solo, function (v) { return v.phase === 'playing'; }, 'practice dealt');
  ok(solo.view.seats.length === 3 && solo.view.solo === true,
    'a practice table keeps all three seats');
  ok(solo.view.you.hand.length === 11, 'and deals you the seat on turn');
  solo.ws.close();

  send(b, { t: 'action', action: 'start' });
  await until(a, function (v) { return v.phase === 'playing'; }, 'round dealt');
  ok(a.view.you.hand.length === 11, 'you are dealt eleven cards');
  ok(a.view.seats[1].handCount === 11, 'others show a count');
  ok(a.view.stocks.length === 4, 'four draw piles');

  console.log('\n-- the trust boundary --');
  const hands = { 0: a.view.you.hand, 1: b.view.you.hand, 2: d.view.you.hand };
  const payloadA = JSON.stringify(a.view);
  let leaked = 0;
  [1, 2].forEach(function (seat) {
    hands[seat].forEach(function (card) {
      // a card id can legitimately repeat across decks, so compare the whole
      // multiset: count how many of B's exact cards appear in A's payload
      if (payloadA.indexOf('"' + card + '"') !== -1 &&
          a.view.you.hand.indexOf(card) === -1 &&
          a.view.discardTop !== card) leaked++;
    });
  });
  ok(leaked === 0, 'no other player\'s cards appear anywhere in your view');
  ok(a.view.seats[1].hand === undefined && a.view.seats[1].foot === undefined,
    'other seats carry no hand or foot array at all');
  ok(a.view.you.footCount === 11 && a.view.you.foot === undefined,
    'even your own foot is a count until you pick it up');

  console.log('\n-- what a client may not do --');
  const notMyTurn = a.view.turn === 0 ? b : a;
  notMyTurn.errors.length = 0;
  send(notMyTurn, { t: 'action', action: 'draw', piles: [0, 1] });
  await wait(150);
  ok(notMyTurn.errors.some(function (m) { return /Not your turn/i.test(m); }),
    'acting out of turn is refused');

  const onTurn = a.view.turn === 0 ? a : b;
  onTurn.errors.length = 0;
  send(onTurn, { t: 'action', action: 'draw', piles: [2, 2] });
  await wait(150);
  ok(onTurn.errors.some(function (m) { return /two different piles/i.test(m); }),
    'both cards from one pile is refused');

  send(onTurn, { t: 'action', action: 'draw', piles: [0, 1] });
  await until(onTurn, function (v) { return v.turnPhase === 'play'; }, 'drew');
  onTurn.errors.length = 0;
  // claim three aces the client does not hold
  send(onTurn, { t: 'action', action: 'meldNew', rank: 'A', cards: ['AS0', 'AH0', 'AD0'] });
  await wait(150);
  const held = onTurn.view.you.hand;
  const reallyHas = ['AS0', 'AH0', 'AD0'].every(function (c) { return held.indexOf(c) !== -1; });
  ok(reallyHas || onTurn.errors.some(function (m) { return /not in your hand/i.test(m); }),
    'melding cards you do not hold is refused');

  console.log('\n-- reconnecting --');
  const beforeHand = a.view.you.hand.slice().sort().join(',');
  a.ws.close();
  await wait(250);
  ok(b.view.seats[0].connected === false, 'the table shows a player as disconnected');

  const a2 = await client('Vic-again');
  a2.token = a.token;
  send(a2, { t: 'resume', code: code });
  await until(a2, function (v) { return !!v.you; }, 'resumed');
  ok(a2.seat === 0, 'you come back to the same seat');
  ok(a2.view.you.hand.slice().sort().join(',') === beforeHand, 'with the same cards');
  await wait(150);
  ok(b.view.seats[0].connected === true, 'and the table shows you back');

  console.log('\n-- a full game --');
  const players = [a2, b, d];
  let turns = 0;
  const started = Date.now();
  const BUDGET = Number(process.env.GAME_BUDGET_MS || 180000);
  while (Date.now() - started < BUDGET) {
    const v = a2.view;
    if (!v) { await wait(20); continue; }
    if (v.phase === 'gameEnd') break;
    if (v.phase === 'roundEnd') {
      send(a2, { t: 'action', action: 'nextRound' });
      await wait(60);
      continue;
    }
    if (v.phase !== 'playing') { await wait(20); continue; }
    const actor = players[v.turn];
    if (!actor || !actor.view || actor.view.turn !== v.turn) { await wait(20); continue; }
    const acted = botStep(actor);
    if (!acted) { await wait(20); }
    else { turns++; await wait(4); }
    if (turns > 6000) break;
  }

  if (a2.view.phase !== 'gameEnd') {
    console.log('     (reached ' + a2.view.phase + ' after ' + turns + ' actions in ' +
      Math.round((Date.now() - started) / 1000) + 's — budget ' + Math.round(BUDGET / 1000) + 's)');
  }
  ok(a2.view.phase === 'gameEnd', 'four rounds play out to a finish');
  ok(a2.view.scores.length === 4, 'four rounds are scored');
  const finalTotals = a2.view.seats.map(function (_, i) {
    return a2.view.scores.reduce(function (s, r) { return s + (r[i] || 0); }, 0);
  });
  ok(finalTotals.every(function (n) { return typeof n === 'number' && isFinite(n); }),
    'every player has a finite total');

  // redaction held for the whole game, not just the first deal
  let everLeaked = false;
  a2.seenPayloads.forEach(function (p) {
    const parsed = JSON.parse(p).view;
    if (parsed.seats.some(function (s) { return s.hand || s.foot; })) everLeaked = true;
  });
  ok(!everLeaked, 'no snapshot in the whole game carried another hand');

  /* The just-picked-up markers are real card ids, so they have to ride inside
   * `you` and never in the turnState everyone receives. If someone later moves
   * that field for convenience, this is what should stop them. */
  let pickedLeaked = false, sawPicked = false, pickedStrayed = false, sawOnlyMine = false;
  a2.seenPayloads.forEach(function (p) {
    const v = JSON.parse(p).view;
    if (v.turnState && v.turnState.picked) pickedLeaked = true;
    const picked = v.you && v.you.picked;
    if (!picked || !picked.length) return;
    sawPicked = true;
    // A picked card may since have been melded or discarded — the interface
    // shows only the ones still in hand — but it must never be a card sitting
    // in somebody else's books.
    const theirs = [];
    v.seats.forEach(function (s, i) {
      if (i === v.you.seat) return;
      s.melds.forEach(function (m) { m.cards.forEach(function (c) { theirs.push(c); }); });
    });
    if (picked.some(function (c) { return theirs.indexOf(c) !== -1; })) pickedStrayed = true;
    if (picked.some(function (c) { return v.you.hand.indexOf(c) !== -1; })) sawOnlyMine = true;
  });
  ok(!pickedLeaked, 'cards picked up this turn never ride in the shared turnState');
  ok(sawPicked, 'a player is told which cards they just picked up');
  ok(!pickedStrayed, 'a card marked as just picked up is never in anyone else’s books');
  ok(sawOnlyMine, 'the marked cards show up in the holder’s own hand');

  console.log('\n' + pass + ' passed, ' + failed + ' failed');
  if (problems.length) problems.forEach(function (p) { console.log('   - ' + p); });
  [a2, b, d].forEach(function (c) { try { c.ws.close(); } catch (x) {} });
  app.server.close();
  try { require('fs').unlinkSync(process.env.SAVE_FILE); } catch (x) {}
  process.exit(failed ? 1 : 0);
})().catch(function (err) {
  console.error('\nTEST RUN FAILED: ' + err.message);
  process.exit(1);
});
