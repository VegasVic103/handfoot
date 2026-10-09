/* End-to-end: three real websocket clients play a full four-round game against
 * the real server. The point of these tests is the trust boundary — a client
 * must never receive another player's cards, and must never be able to play a
 * card it does not hold. */

process.env.PORT = process.env.TEST_PORT || '3987';
process.env.BOT_PACE_MS = '100';
process.env.SAVE_FILE = require('path').join(__dirname, '.test-tables.json');
try { require('fs').unlinkSync(process.env.SAVE_FILE); } catch (e) {}

const WebSocket = require('ws');
const E = require('./engine.js');
const G = require('./game.js');
const BOT = require('./bot.js');
const app = require('./server.js');

const URL = 'ws://127.0.0.1:' + process.env.PORT;
let pass = 0, failed = 0;
const problems = [];

function ok(cond, name) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name); problems.push(name); }
}

function client(name, options, url) {
  const c = {
    name: name,
    token: 'tok-' + name + '-' + Math.random().toString(36).slice(2, 10),
    view: null,
    errors: [],
    errorContexts: [],
    chat: [],
    chatHistory: null,
    seenPayloads: [],
    ws: null,
    onState: null,
    left: 0,
  };
  return new Promise(function (resolve) {
    const ws = new WebSocket(url || URL, options || {});
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
        c.errorContexts.push(msg.context);
      } else if (msg.t === 'joined') {
        c.code = msg.code; c.seat = msg.seat;
      } else if (msg.t === 'chat') {
        c.chat.push(msg.message);
      } else if (msg.t === 'chatHistory') {
        c.chatHistory = msg.messages;
      } else if (msg.t === 'left') {
        c.left++;
      }
    });
  });
}

function send(c, obj) {
  obj.token = c.token;
  if (obj.t === 'action' && !Object.prototype.hasOwnProperty.call(obj, 'turnId')) {
    obj.turnId = c.view && c.view.turnId;
  }
  c.ws.send(JSON.stringify(obj));
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* fetch a path over plain HTTP and hand back the status, headers and body */
function get(pathname) {
  return new Promise(function (resolve, reject) {
    require('http').get(
      { host: '127.0.0.1', port: process.env.PORT, path: pathname },
      function (res) {
        const chunks = [];
        res.on('data', function (d) { chunks.push(d); });
        res.on('end', function () {
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
        });
      }
    ).on('error', reject);
  });
}

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
      // Value exactly what will be sent, not everything of that rank in hand.
      // A book holds bookSize, and the top card takes one of those places, so
      // only bookSize - 1 can come from the hand. Counting all of them made the
      // bot believe a take cleared the minimum when the referee scored only the
      // cards it was actually handed, and it then offered the same refused move
      // forever.
      const take = nat.slice(0, S.bookSize - 1);
      const value = take.concat([v.discardTop]).reduce(function (s, x) { return s + cardValue(x); }, 0);
      if (take.length >= S.pileNaturalsRequired && (v.you.hasInitialMeld || value >= v.minMeld)) {
        send(c, { t: 'action', action: 'pile', cards: take });
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
    // Once in the foot you must keep a card to discard unless you are going
    // out, or the referee refuses the add and this loop offers it forever.
    if (v.you.inFoot && hand.length - add.length < 1 && !v.you.canGoOut.ok) continue;
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
    if (v.you.inFoot && hand.length - cards.length < 1 && !v.you.canGoOut.ok) continue;
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

async function continuityRegressions() {
  console.log('\n-- explicit departure, reconnect and host transfer --');
  const host = await client('Leave-host');
  const guest = await client('Leave-guest');
  send(host, { t: 'create', name: host.name, seats: 3 });
  await until(host, v => v.phase === 'lobby', 'departure lobby');
  send(guest, { t: 'join', code: host.code, name: guest.name });
  await until(host, v => v.seated === 2, 'departure guest');
  guest.ws.close();
  await until(host, v => !v.seats[1].connected, 'temporary disconnect');
  ok(host.view.seated === 2, 'a transient lobby disconnect keeps its reservation');
  const resumed = await client('Leave-return');
  resumed.token = guest.token;
  send(resumed, { t: 'resume', code: host.code });
  await until(resumed, v => v.you.seat === 1, 'lobby reconnect');
  send(resumed, { t: 'leave' });
  await until(host, v => v.seated === 1, 'explicit departure');
  ok(host.view.seats[1].name === 'Open seat' && resumed.left === 1,
    'explicit lobby departure releases the reservation and resets its name');

  const replacement = await client('Leave-replacement');
  const third = await client('Leave-third');
  send(replacement, { t: 'join', code: host.code, name: replacement.name });
  await until(replacement, v => v.you.seat === 1, 'replacement seat');
  send(third, { t: 'join', code: host.code, name: third.name });
  await until(host, v => v.seated === 3, 'third lobby seat');
  send(host, { t: 'leave' });
  await until(replacement, v => v.seated === 2 && v.hostSeat === 1, 'host transfer');
  send(replacement, { t: 'action', action: 'configureRules', rules: { handSize: 12 } });
  await until(replacement, v => v.settings.handSize === 12, 'new host settings');
  ok(replacement.view.canConfigureRules, 'a departing lobby host transfers rules ownership');
  send(replacement, { t: 'action', action: 'start' });
  await until(replacement, v => v.phase === 'playing', 'remaining players deal');
  ok(replacement.view.seats.length === 2 && replacement.view.you.seat === 0 &&
    replacement.view.hostSeat === 0 && replacement.view.canConfigureRules &&
    replacement.view.seats.every(s => s.name !== host.name && s.handCount === 12),
  'deal compacts the empty seat while preserving the surviving host and players');
  send(replacement, { t: 'leave' });
  await until(third, v => v.phase === 'playing' && !v.seats[0].connected, 'playing departure');
  ok(third.view.seated === 2 && app.rooms.get(host.code).tokens[0] === replacement.token,
    'explicit departure during play retains its resumable seat');
  [host, resumed, replacement, third].forEach(c => c.ws.close());

  console.log('\n-- monotonic turn IDs and delayed action rejection --');
  const owner = await client('Turn-owner');
  send(owner, { t: 'practice' });
  await until(owner, v => v.phase === 'playing', 'turn ID practice table');
  const room = app.rooms.get(owner.code);
  const initialId = owner.view.turnId;
  ok(Number.isSafeInteger(initialId) && initialId > 0, 'views expose a server-issued turn ID');
  let errors = owner.errors.length;
  owner.ws.send(JSON.stringify({ t: 'action', token: owner.token, action: 'draw', piles: [0, 1] }));
  await untilTrue(() => owner.errors.length > errors, 'missing turn ID rejection');
  ok(owner.errorContexts.at(-1) === 'staleTurn' && room.game.turnPhase === 'draw',
    'gameplay without a turn ID is rejected without changing the draw');
  const originalDraw = { t: 'action', action: 'draw', piles: [0, 1], turnId: initialId };
  send(owner, Object.assign({}, originalDraw));
  await until(owner, v => v.turnPhase === 'play', 'original turn draw');
  errors = owner.errors.length;
  send(owner, Object.assign({}, originalDraw));
  await untilTrue(() => owner.errors.length > errors, 'immediate duplicate rejection');
  ok(/already drawn/.test(owner.errors.at(-1)), 'an immediate duplicate still fails the phase guard');
  for (let i = 0; i < 3; i++) {
    const priorId = owner.view.turnId;
    send(owner, { t: 'action', action: 'discard', card: owner.view.you.hand[0] });
    await until(owner, v => v.turnId > priorId && v.turnPhase === 'draw', 'next practice turn');
    if (i === 0) ok(owner.view.you.seat === 1 && owner.view.canConfigureRules,
      'the practice owner keeps rules controls while acting as seat one');
    if (i < 2) {
      send(owner, { t: 'action', action: 'draw', piles: [0, 1] });
      await until(owner, v => v.turnPhase === 'play', 'intervening draw');
    }
  }
  const beforeReplay = JSON.stringify(room.game);
  errors = owner.errors.length;
  send(owner, Object.assign({}, originalDraw));
  await untilTrue(() => owner.errors.length > errors, 'old-turn replay rejection');
  ok(owner.view.turn === 0 && owner.view.turnId > initialId &&
    owner.errorContexts.at(-1) === 'staleTurn' && JSON.stringify(room.game) === beforeReplay,
  'the identical draw cannot replay when the same seat gets its next turn');

  for (const transition of ['nextRound', 'rematch']) {
    const priorId = owner.view.turnId;
    room.game.phase = transition === 'nextRound' ? 'roundEnd' : 'gameEnd';
    send(owner, { t: 'action', action: transition });
    await until(owner, v => v.phase === 'playing' && v.turnId > priorId, transition + ' ID');
    const unchanged = JSON.stringify(room.game);
    errors = owner.errors.length;
    send(owner, Object.assign({}, originalDraw));
    await untilTrue(() => owner.errors.length > errors, transition + ' old replay');
    ok(JSON.stringify(room.game) === unchanged && owner.errorContexts.at(-1) === 'staleTurn',
      transition + ' advances the identifier and rejects old gameplay');
  }
  send(owner, { t: 'action', action: 'draw', piles: [0, 1] });
  await until(owner, v => v.turnPhase === 'play', 'current draw after refresh');
  ok(owner.view.you.hand.length === 13, 'a refreshed client can make a current-turn action');
  owner.ws.close();

  console.log('\n-- heartbeat liveness --');
  const healthy = await client('Heartbeat-healthy');
  const silent = await client('Heartbeat-silent', { autoPong: false });
  send(healthy, { t: 'create', seats: 2 });
  await until(healthy, v => v.phase === 'lobby', 'heartbeat lobby');
  send(silent, { t: 'join', code: healthy.code });
  await until(healthy, v => v.seated === 2, 'heartbeat peer');
  app.heartbeat();
  await wait(100);
  app.heartbeat();
  await until(healthy, v => !v.seats[1].connected, 'silent peer termination');
  ok(healthy.ws.readyState === WebSocket.OPEN && healthy.view.seats[0].connected,
    'answering protocol pongs keeps a healthy connection alive');
  ok(silent.ws.readyState === WebSocket.CLOSED && healthy.view.seated === 2,
    'a missed pong terminates the socket while preserving the resumable reservation');
  healthy.ws.close();

  console.log('\n-- atomic save failure --');
  const fs = require('fs');
  app.flushSave();
  const goodSnapshot = fs.readFileSync(process.env.SAVE_FILE, 'utf8');
  const rename = fs.renameSync, report = console.error;
  const saveErrors = [];
  let saved;
  try {
    room.touched++;
    fs.renameSync = function (from, to) {
      if (to === process.env.SAVE_FILE) throw new Error('simulated rename denial');
      return rename.apply(this, arguments);
    };
    console.error = function (message) { saveErrors.push(message); };
    saved = app.flushSave();
  } finally {
    fs.renameSync = rename;
    console.error = report;
  }
  ok(!saved && fs.readFileSync(process.env.SAVE_FILE, 'utf8') === goodSnapshot &&
    saveErrors.some(message => /Could not save tables.*simulated rename denial/.test(message)),
  'a failed atomic replacement preserves the prior snapshot and reports the failure');
}

async function shutdownRegressions() {
  console.log('\n-- isolated graceful shutdown persistence --');
  const fs = require('fs'), path = require('path');
  const directory = fs.mkdtempSync(path.join(require('os').tmpdir(), 'handfoot-restart-'));
  const saveFile = path.join(directory, 'tables.json');
  let running;
  async function start() {
    const script = "const app=require('./server.js');app.server.on('listening',()=>process.send({port:app.server.address().port}));";
    const child = require('child_process').spawn(process.execPath, ['-e', script], {
      cwd: __dirname, env: Object.assign({}, process.env, { PORT: '0', SAVE_FILE: saveFile }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let logs = '';
    child.stdout.on('data', data => { logs += data; });
    child.stderr.on('data', data => { logs += data; });
    running = child;
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('restart child startup: ' + logs)), 5000);
      child.once('message', message => { clearTimeout(timer); resolve(message.port); });
      child.once('error', reject);
    });
    return { child, url: 'ws://127.0.0.1:' + port };
  }
  async function stop(child, signal) {
    const exited = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('restart child failed to stop')), 5000);
      child.once('exit', (code, receivedSignal) => { clearTimeout(timer); resolve({ code, receivedSignal }); });
    });
    child.kill(signal);
    const status = await exited;
    running = null;
    ok(status.code === 0 && !status.receivedSignal, signal + ' flushes before orderly exit');
  }
  try {
    let session = await start();
    const first = await client('Restart-owner', {}, session.url);
    send(first, { t: 'vsbot', bots: 1, name: 'Restart-owner' });
    await until(first, v => v.phase === 'playing', 'restart table creation');
    const code = first.code, token = first.token, firstId = first.view.turnId;
    await stop(session.child, 'SIGINT');
    let saved = JSON.parse(fs.readFileSync(saveFile, 'utf8')).rooms.find(r => r.code === code);
    const styles = saved.botStyles;
    ok(saved && saved.turnId === firstId, 'immediate shutdown persists newly created tables and their turn IDs');

    session = await start();
    const resumed = await client('Restart-resumed', {}, session.url);
    resumed.token = token;
    send(resumed, { t: 'resume', code });
    await until(resumed, v => v.phase === 'playing', 'restart resume');
    send(resumed, { t: 'action', action: 'configureRules', rules: { blackBookBonus: 425 } });
    await until(resumed, v => v.pendingSettings && v.pendingSettings.blackBookBonus === 425, 'restart pending rules');
    send(resumed, { t: 'action', action: 'draw', piles: [0, 1] });
    await until(resumed, v => v.turnPhase === 'play', 'restart acknowledged draw');
    const acknowledged = resumed.view;
    await stop(session.child, 'SIGTERM');
    saved = JSON.parse(fs.readFileSync(saveFile, 'utf8')).rooms.find(r => r.code === code);
    ok(!fs.readdirSync(directory).some(name => name.includes('.tmp-')),
      'atomic snapshot replacement leaves no temporary file after success');

    session = await start();
    const again = await client('Restart-again', {}, session.url);
    again.token = token;
    send(again, { t: 'resume', code });
    await until(again, v => v.phase === 'playing', 'second restart resume');
    ok(JSON.stringify(again.view.you.hand) === JSON.stringify(acknowledged.you.hand) &&
      JSON.stringify(again.view.stocks) === JSON.stringify(acknowledged.stocks) &&
      again.view.turnPhase === 'play' && again.view.turnId === acknowledged.turnId,
    'restart restores the acknowledged draw exactly without rolling back its cards or turn ID');
    ok(again.view.pendingSettings.blackBookBonus === 425 &&
      JSON.stringify(again.view.scores) === JSON.stringify(acknowledged.scores) &&
      JSON.stringify(saved.botStyles) === JSON.stringify(styles),
    'shutdown preserves pending rules, scores and private bot personalities');
    await stop(session.child, 'SIGTERM');
  } finally {
    if (running) running.kill('SIGKILL');
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

(async function run() {
  await continuityRegressions();
  await shutdownRegressions();
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

  console.log('\n-- table chat and session isolation --');
  {
    const outsider = await client('Elsewhere');
    send(outsider, { t: 'chat', text: 'not seated' });
    await untilTrue(function () { return outsider.errors.length === 1; }, 'unseated chat refusal');
    ok(outsider.errorContexts[0] === 'chat', 'chat errors are identified for the composer');
    ok(outsider.chat.length === 0 && outsider.chatHistory === null,
      'an unseated socket receives no room chat or history');
    send(outsider, { t: 'create', name: 'Elsewhere', seats: 2 });
    await until(outsider, function (v) { return v.phase === 'lobby'; }, 'separate chat table');
    ok(Array.isArray(outsider.chatHistory) && outsider.chatHistory.length === 0,
      'a new table begins with empty chat history');

    send(a, { t: 'chat', text: '  <img src=x onerror=alert(1)> Good game!  ' });
    await untilTrue(function () { return b.chat.length === 1 && d.chat.length === 1; }, 'table chat delivery');
    ok(a.chat.length === 1 && b.chat[0].text === '<img src=x onerror=alert(1)> Good game!',
      'chat is returned to its sender and peers as plain text');
    ok(b.chat[0].seat === 0 && b.chat[0].name === 'Vic' &&
      typeof b.chat[0].at === 'number' && !!b.chat[0].id,
      'the server supplies chat identity, time and a unique message id');
    ok(outsider.chat.length === 0, 'another table cannot receive the conversation');

    const beforeInvalid = a.errors.length;
    send(a, { t: 'chat', text: ' \n\t ' });
    send(a, { t: 'chat', text: 'x'.repeat(501) });
    await untilTrue(function () { return a.errors.length === beforeInvalid + 2; }, 'invalid chat refusals');
    ok(a.chat.length === 1, 'blank and oversized messages never enter the conversation');
    for (let i = 0; i < 5; i++) send(a, { t: 'chat', text: 'hello ' + i });
    await untilTrue(function () { return a.errors.length === beforeInvalid + 3; }, 'chat burst limit');
    ok(a.chat.length === 5 && /slower/.test(a.errors[a.errors.length - 1]),
      'a session may send at most five messages in ten seconds');

    // This socket is already Vic's. Trying Dan's token must neither attach it
    // to Dan's seat nor cause its old subscription to survive under a new key.
    const beforeIdentity = a.errors.length;
    a.ws.send(JSON.stringify({ t: 'resume', code: code, token: b.token }));
    await untilTrue(function () { return a.errors.length === beforeIdentity + 1; }, 'identity change refusal');
    ok(a.seat === 0 && a.view.you.seat === 0 && /Session changed/.test(a.errors[a.errors.length - 1]),
      'an attached socket cannot switch session identities');

    const room = app.rooms.get(code);
    room.chat = Array.from({ length: 100 }, function (_, i) {
      return { id: 'history-' + i, seat: 0, name: 'Vic', text: 'message ' + i, at: i };
    });
    send(b, { t: 'chat', text: 'Most recent message' });
    await untilTrue(function () { return room.chat[99].text === 'Most recent message'; }, 'bounded chat history');
    ok(room.chat.length === 100 && room.chat[0].id === 'history-1',
      'chat retains only the latest one hundred messages');

    const oldCode = outsider.code;
    send(outsider, { t: 'create', name: 'Elsewhere', seats: 2 });
    await untilTrue(function () { return outsider.code !== oldCode; }, 'room switch');
    ok(app.rooms.get(oldCode).live.size === 0,
      'moving a socket to another table removes its old subscription');
    outsider.ws.close();
  }

  console.log('\n-- a no-show is not dealt in --');
  {
    const h = await client('Host2');
    send(h, { t: 'create', name: 'Host2', seats: 4 });
    await until(h, function (v) { return v.phase === 'lobby'; }, 'second table');
    const g = await client('Guest2');
    send(g, { t: 'join', code: h.code, name: 'Guest2' });
    await until(h, function (v) { return v.seated === 2; }, 'two seated at the second table');
    ok(h.view.seats.length === 4, 'the table starts with four seats');
    send(h, { t: 'action', action: 'setRule', key: 'revealPileTake', value: false });
    await until(h, function (v) { return v.settings.revealPileTake === false; }, 'lobby rule change');
    send(h, { t: 'action', action: 'start' });
    await until(h, function (v) { return v.phase === 'playing'; }, 'second table dealt');
    ok(h.view.seats.length === 2, 'the two empty seats are dropped at the deal');
    ok(h.view.seats.every(function (s) { return s.handCount === 11; }),
      'only real players are dealt cards');
    ok(h.view.stocks.reduce(function (a, n) { return a + n; }, 0) > 0, 'the piles are built');
    ok(h.view.settings.revealPileTake === false && h.view.discardPeek === null,
      'dropping empty seats preserves the agreed table settings');
    h.ws.close(); g.ws.close();
  }

  console.log('\n-- table setup choices --');
  {
    for (const reveal of [false, true]) {
      const host = await client('Setup-host-' + reveal);
      const guest = await client('Setup-guest-' + reveal);
      send(host, {
        t: 'create', name: 'Host', seats: 3, revealDiscard: reveal,
        settings: { bookSize: 2, revealPileTake: !reveal }, bookSize: 2, goOutBonus: 999,
      });
      await until(host, function (v) { return v.phase === 'lobby'; }, 'friend table setup');
      ok(host.view.settings.revealPileTake === reveal && host.view.settings.bookSize === E.DEFAULTS.bookSize &&
        host.view.settings.goOutBonus === E.DEFAULTS.goOutBonus,
        'friend setup applies only the reveal choice (' + reveal + '), leaving house rules intact');
      send(guest, { t: 'join', code: host.code, name: 'Guest', revealDiscard: !reveal });
      await until(host, function (v) { return v.seated === 2; }, 'setup guest joined');
      await until(guest, function (v) { return v.seated === 2; }, 'guest setup snapshot');
      ok(guest.view.settings.revealPileTake === reveal,
        'a joining guest receives the host’s reveal choice without overriding it (' + reveal + ')');
      send(host, { t: 'action', action: 'start' });
      await until(host, function (v) { return v.phase === 'playing'; }, 'configured friends dealt');
      ok(host.view.settings.revealPileTake === reveal &&
        (reveal ? Array.isArray(host.view.discardPeek) : host.view.discardPeek === null),
        'friend setup survives empty-seat removal and controls the actual card payload (' + reveal + ')');
      host.ws.close(); guest.ws.close();

      const cpu = await client('Setup-computer-' + reveal);
      send(cpu, {
        t: 'vsbot', name: 'You', bots: reveal ? 3 : 1, revealDiscard: reveal,
        settings: { bookSize: 2, revealPileTake: !reveal }, minMelds: [0],
        botStyles: ['client-picked-style'], style: 'client-picked-style',
      });
      await until(cpu, function (v) { return v.phase === 'playing'; }, 'configured computers dealt');
      ok(cpu.view.settings.revealPileTake === reveal &&
        (reveal ? Array.isArray(cpu.view.discardPeek) : cpu.view.discardPeek === null),
        'computer setup applies reveal before the first deal and snapshot (' + reveal + ')');
      ok(cpu.view.seats.filter(function (s) { return s.bot; }).length === (reveal ? 3 : 1) &&
        cpu.view.settings.bookSize === E.DEFAULTS.bookSize &&
        JSON.stringify(cpu.view.settings.minMelds) === JSON.stringify(E.DEFAULTS.minMelds),
        'computer setup supports ' + (reveal ? 3 : 1) + ' opponents without accepting engine configuration');
      ok(cpu.view.seats.slice(1).every(function (s) {
        return s.hand === undefined && s.foot === undefined && s.handCount === 11;
      }), 'configured computer tables still redact all opponents’ private cards');
      const styles = app.rooms.get(cpu.code).botStyles;
      ok(styles[0] === null && styles.slice(1).every(function (style) { return BOT.STYLES.includes(style); }),
        'computer personalities are assigned by the server, never accepted from setup input');
      ok(cpu.view.botStyles === undefined && cpu.view.settings.botStyles === undefined &&
        cpu.view.seats.every(function (s) { return s.style === undefined && s.botStyle === undefined; }),
        'computer personalities remain private metadata, absent from all client views');
      cpu.ws.close();
    }

    for (const kind of ['create', 'vsbot']) {
      const malformedChoice = await client('Setup-invalid-' + kind);
      send(malformedChoice, { t: kind, name: 'You', seats: 2, bots: 2, revealDiscard: 'false' });
      await until(malformedChoice, function (v) { return !!v.you; }, 'nonboolean setup choice');
      ok(malformedChoice.view.settings.revealPileTake === true,
        kind + ' ignores nonboolean reveal input and keeps the default on');
      malformedChoice.ws.close();
    }
    ok(a.view.settings.revealPileTake === true,
      'setup preferences are table-specific and never change an existing table');

    const invalidCpu = await client('Invalid-computers');
    const beforeRooms = app.rooms.size;
    const invalidCounts = [0, 4, 5, 6, -1, 1.5, '3opponents', true, [1]];
    invalidCounts.forEach(function (count) { send(invalidCpu, { t: 'vsbot', bots: count }); });
    await untilTrue(function () { return invalidCpu.errors.length === invalidCounts.length; }, 'invalid computer counts');
    ok(invalidCpu.view === null && app.rooms.size === beforeRooms &&
      invalidCpu.errors.every(function (message) { return /1 and 3/.test(message); }),
      'invalid computer counts are refused without creating or attaching a table');
    send(invalidCpu, { t: 'vsbot', name: 'Default' });
    await until(invalidCpu, function (v) { return v.phase === 'playing'; }, 'default computer count');
    ok(invalidCpu.view.seats.filter(function (s) { return s.bot; }).length === 2,
      'omitting the computer count retains the original two-opponent default');
    invalidCpu.ws.close();

    const invalidFriends = await client('Invalid-friends');
    const beforeFriendRooms = app.rooms.size;
    const invalidSeats = [0, 1, 5, 6, -1, 2.5, '4players', true, [4]];
    invalidSeats.forEach(function (count) { send(invalidFriends, { t: 'create', seats: count }); });
    await untilTrue(function () { return invalidFriends.errors.length === invalidSeats.length; }, 'invalid friend counts');
    ok(invalidFriends.view === null && app.rooms.size === beforeFriendRooms &&
      invalidFriends.errors.every(function (message) { return /2 and 4/.test(message); }),
      'friend setup refuses malformed counts and more than four players without creating a room');
    send(invalidFriends, { t: 'create', name: 'Default' });
    await until(invalidFriends, function (v) { return v.phase === 'lobby'; }, 'default friend count');
    ok(invalidFriends.view.seats.length === 3, 'omitting total players defaults to three seats');
    invalidFriends.ws.close();

    const four = await client('Four-host');
    send(four, { t: 'create', name: 'Four-host', seats: 4 });
    await until(four, function (v) { return v.phase === 'lobby'; }, 'four-player table');
    const fourGuests = [];
    for (let i = 0; i < 3; i++) {
      const guest = await client('Four-guest-' + i);
      fourGuests.push(guest);
      send(guest, { t: 'join', code: four.code, name: guest.name });
      await until(guest, function (v) { return v.seated === i + 2; }, 'four-player guest joined');
    }
    await until(four, function (v) { return v.seated === 4; }, 'all four players seated');
    const fifth = await client('Fifth-guest');
    send(fifth, { t: 'join', code: four.code, name: 'Fifth' });
    await untilTrue(function () { return fifth.errors.length === 1; }, 'fifth player refused');
    ok(fifth.view === null && /full/.test(fifth.errors[0]) && four.view.seats.length === 4,
      'four-player tables admit three friends and refuse a fifth seat');
    send(four, { t: 'action', action: 'start' });
    await until(four, function (v) { return v.phase === 'playing'; }, 'four-player deal');
    const fourGame = app.rooms.get(four.code).game;
    const dealtCards = fourGame.players.reduce(function (n, player) { return n + player.hand.length + player.foot.length; }, 0);
    const stockCards = fourGame.stocks.reduce(function (n, pile) { return n + pile.length; }, 0);
    ok(fourGame.players.length === 4 && dealtCards + stockCards + fourGame.discard.length === 6 * 54,
      'four players still deal from players-plus-two decks, preserving the house rules');
    [four, fifth].concat(fourGuests).forEach(function (c) { c.ws.close(); });
  }

  console.log('\n-- named individual rule presets --');
  {
    const host = await client('Preset-host'), guest = await client('Preset-guest');
    send(host, { t: 'create', name: 'Preset-host', seats: 2, rules: E.rulesForPreset('real') });
    await until(host, v => v.phase === 'lobby', 'Real preset lobby');
    send(guest, { t: 'join', code: host.code, name: 'Preset-guest' });
    await until(host, v => v.seated === 2, 'Real preset guest');
    await until(guest, v => v.seated === 2, 'Real preset guest ready');
    ok(E.rulePresetId(host.view.settings) === 'real' && E.rulePresetId(guest.view.settings) === 'real',
      'every seat receives the complete Real Rules capability set');
    send(host, { t:'action', action:'configureRules', rules:E.rulesForPreset('christine') });
    await until(host, v => E.rulePresetId(v.settings) === 'christine', 'switch full preset back');
    ok(host.view.settings.stockPiles === 4 && !host.view.settings.goOutWithDiscard &&
      host.view.settings.reshuffleOnce, 'switching presets resets every gameplay difference');
    send(host, { t:'action', action:'configureRules', rules:E.rulesForPreset('real') });
    await until(host, v => E.rulePresetId(v.settings) === 'real', 'switch full Real preset');
    send(host, { t:'action', action:'start' });
    await until(host, v => v.phase === 'playing', 'Real preset deal');
    ok(host.view.stocks.length === 1 && host.view.settings.deckCount === 5 &&
      host.view.settings.closedBooksLocked && host.view.settings.minNaturalsWithWild === 4 &&
      host.view.discardPeek === null, 'Real deals one stock and enforces hidden pickup cards');
    const initial = host.view.you.hand.length;
    send(host, { t:'action', action:'draw', piles:[0,0] });
    await until(host, v => v.turnPhase === 'play', 'two from one stock');
    ok(host.view.you.hand.length === initial + 2 && !host.errors.length,
      'the websocket draw endpoint permits two cards from the one Real stock');
    send(host, { t:'action', action:'configureRules', rules:{ highEightNine:false } });
    await until(host, v => v.pendingSettings && !v.pendingSettings.highEightNine, 'custom flag queued');
    ok(host.view.settings.highEightNine && E.rulePresetId(host.view.pendingSettings) === 'custom',
      'individual abilities can be customized for next round without mutating current play');
    host.ws.close(); guest.ws.close();
  }

  console.log('\n-- host-configured rules and next-round changes --');
  {
    const invalid = await client('Invalid-rules');
    const roomCount = app.rooms.size;
    const badRules = [
      { deckCount: 1 }, { handSize: '11' }, { bookSize: 2 },
      { stockPiles: 1 }, { minMelds: [50, 90] }, { unknownRule: true },
      null, [], JSON.parse('{"__proto__":{"bookSize":1}}'),
    ];
    badRules.forEach(function (rules) { send(invalid, { t: 'create', seats: 4, rules }); });
    await untilTrue(function () { return invalid.errors.length === badRules.length; }, 'invalid rule setup refusal');
    ok(invalid.view === null && app.rooms.size === roomCount,
      'invalid, unsafe, unknown, and malformed rules cannot create a table');
    send(invalid, { t: 'vsbot', bots: 3, rules: { deckCount: 1 } });
    await untilTrue(function () { return invalid.errors.length === badRules.length + 1; }, 'invalid computer rules');
    ok(app.rooms.size === roomCount, 'computer setup enforces the same deck-capacity check');
    invalid.ws.close();

    const host = await client('Rule-host');
    const guest = await client('Rule-guest');
    send(host, { t: 'create', name: 'Rule-host', seats: 4, rules: {
      deckCount: 4, handSize: 10, footSize: 9, requireRedBook: 2,
      pileTakeExtra: 3, minMelds: [40, 80, 110, 140],
    } });
    await until(host, function (v) { return v.phase === 'lobby'; }, 'custom rule lobby');
    send(guest, { t: 'join', code: host.code, name: 'Rule-guest', rules: { deckCount: 12 } });
    await until(guest, function (v) { return v.seated === 2; }, 'custom rule guest');
    await until(host, function (v) { return v.seated === 2; }, 'custom rule host occupancy');
    ok(host.view.canConfigureRules && host.view.hostSeat === 0 && !guest.view.canConfigureRules,
      'only the original host is offered structural rule controls');
    ok(guest.view.settings.deckCount === 4 && guest.view.settings.pileTakeExtra === 3 &&
      guest.view.settings.requireRedBook === 2 && guest.view.pendingSettings === null,
      'all seats receive the host’s public rules and a join cannot replace them');

    send(guest, { t: 'action', action: 'configureRules', rules: { handSize: 12 } });
    await untilTrue(function () { return guest.errors.length === 1; }, 'guest rule-change refusal');
    ok(/host/i.test(guest.errors[0]) && host.view.settings.handSize === 10,
      'a raw non-host configuration message is rejected');
    send(host, { t: 'action', action: 'configureRules', rules: { handSize: 12, footSize: 8, bookSize: 8 } });
    await until(host, function (v) { return v.settings.handSize === 12; }, 'immediate lobby rules');
    ok(host.view.settings.bookSize === 8 && host.view.settings.footSize === 8 && host.view.pendingSettings === null,
      'valid lobby changes apply immediately as one validated configuration');
    const beforeInvalidRules = JSON.stringify(app.rooms.get(host.code).game.settings);
    send(host, { t: 'action', action: 'configureRules', rules: { deckCount: 1, redBookBonus: 999 } });
    await untilTrue(function () { return host.errors.length === 1; }, 'unsafe lobby capacity');
    ok(JSON.stringify(app.rooms.get(host.code).game.settings) === beforeInvalidRules,
      'an invalid mixed patch changes no rule, including otherwise valid values');
    send(host, { t: 'action', action: 'start' });
    await until(host, function (v) { return v.phase === 'playing'; }, 'custom rule deal');
    const room = app.rooms.get(host.code);
    ok(host.view.seats.length === 2 && host.view.seats.every(function (seat) {
      return seat.handCount === 12 && seat.footCount === 8;
    }) && room.game.players.reduce(function (n, player) { return n + player.hand.length + player.foot.length; }, 0) +
      room.game.stocks.flat().length + room.game.discard.length === 4 * 54,
      'the configured deal and explicit deck count survive removal of empty seats');

    const currentPlay = function () {
      const g = room.game;
      return JSON.stringify({ settings: g.settings, players: g.players, stocks: g.stocks,
        discard: g.discard, turn: g.turn, turnPhase: g.turnPhase, turnState: g.turnState, scores: g.scores });
    };
    const beforePending = currentPlay();
    send(host, { t: 'action', action: 'configureRules', rules: {
      deckCount: 5, handSize: 13, footSize: 7, requireBlackBook: 2,
      pileTakeExtra: 1, goOutBonus: 750, reshuffleOnce: false,
    } });
    await until(guest, function (v) { return v.pendingSettings && v.pendingSettings.handSize === 13; }, 'public pending rules');
    await until(host, function (v) { return v.pendingSettings && v.pendingSettings.deckCount === 5; }, 'host pending rules');
    ok(currentPlay() === beforePending && host.view.settings.deckCount === 4 &&
      guest.view.pendingSettings.requireBlackBook === 2 && guest.view.pendingSettings.pileTakeExtra === 1,
      'mid-round changes are visible to everyone without changing dealt cards, current rules, or scores');
    send(host, { t: 'action', action: 'configureRules', rules: { blackBookBonus: 425 } });
    await until(host, function (v) { return v.pendingSettings && v.pendingSettings.blackBookBonus === 425; }, 'merged pending rules');
    ok(host.view.pendingSettings.deckCount === 5 && host.view.pendingSettings.handSize === 13,
      'a later patch preserves earlier queued rule choices');
    send(guest, { t: 'action', action: 'setRule', key: 'revealPileTake', value: false });
    await until(host, function (v) { return !v.settings.revealPileTake && v.pendingSettings && !v.pendingSettings.revealPileTake; }, 'live preview with pending rules');
    ok(host.view.discardPeek === null, 'the existing live preview toggle remains private and will not revert next round');
    const beforeInvalidPending = JSON.stringify(room.game.pendingSettings);
    send(host, { t: 'action', action: 'configureRules', rules: { minMelds: [0], drawCount: 20 } });
    await untilTrue(function () { return host.errors.length === 2; }, 'invalid queued rules');
    ok(JSON.stringify(room.game.pendingSettings) === beforeInvalidPending,
      'invalid pending changes leave the previously queued configuration intact');

    await untilTrue(function () {
      try {
        const saved = JSON.parse(require('fs').readFileSync(process.env.SAVE_FILE, 'utf8'));
        const savedRoom = saved.rooms.find(function (r) { return r.code === room.code; });
        return savedRoom && JSON.stringify(savedRoom.game.pendingSettings) === beforeInvalidPending;
      } catch (e) { return false; }
    }, 'persisted pending rules', 4000);
    const restoredRules = require('child_process').execFileSync(process.execPath, ['-e',
      "const app=require('./server'); app.server.on('listening',()=>{const r=app.rooms.get(" + JSON.stringify(room.code) +
      "); console.log('RULES:'+JSON.stringify(app.viewFor(r,0))); app.server.close();});",
    ], { cwd: __dirname, env: Object.assign({}, process.env, { PORT: '0' }), encoding: 'utf8', timeout: 5000 });
    const restoredView = JSON.parse(restoredRules.split('\n').find(function (line) { return line.startsWith('RULES:'); }).slice(6));
    ok(restoredView.canConfigureRules && restoredView.settings.handSize === 12 &&
      restoredView.pendingSettings.handSize === 13 && restoredView.pendingSettings.blackBookBonus === 425,
      'restart restores the original host and queued rules without applying them to an active round');

    room.game.phase = 'roundEnd';
    send(host, { t: 'action', action: 'nextRound' });
    await until(host, function (v) { return v.phase === 'playing' && v.round === 1; }, 'pending rules applied next round');
    ok(host.view.pendingSettings === null && host.view.settings.deckCount === 5 &&
      host.view.seats.every(function (seat) { return seat.handCount === 13 && seat.footCount === 7; }) &&
      host.view.settings.blackBookBonus === 425 && host.view.reshufflesRemaining === 0 &&
      !host.view.settings.revealPileTake,
      'next round applies the entire queued configuration and clears the pending indicator');

    // Exercise the public recycling status through the real draw endpoint.
    room.game.settings.reshuffleOnce = true;
    room.game.turn = 0; room.game.turnPhase = 'draw'; room.game.turnState.drew = false;
    const splitForEmptyPile = function () {
      const cards = room.game.stocks.flat();
      room.game.stocks = [cards.splice(0, 1), cards.splice(0, 2), cards.splice(0, 2), cards];
    };
    splitForEmptyPile();
    const keptTop = room.game.discard.at(-1);
    send(host, { t: 'action', action: 'draw', piles: [0, 1] });
    await until(host, function (v) { return v.reshufflesUsed === 1; }, 'first public stock recycle');
    ok(host.view.phase === 'playing' && host.view.reshufflesRemaining === 0 &&
      host.view.stocks.every(function (count) { return count > 0; }) &&
      host.view.discardTop === keptTop && host.view.discardCount === 1,
      'first empty pile recycles once and exposes only remaining count and preserved discard top');
    splitForEmptyPile(); room.game.turnPhase = 'draw'; room.game.turnState.drew = false;
    send(host, { t: 'action', action: 'draw', piles: [0, 1] });
    await until(host, function (v) { return v.phase === 'roundEnd'; }, 'second stock exhaustion');
    ok(host.view.reshufflesUsed === 1 && host.view.reshufflesRemaining === 0,
      'a later empty pile ends the round rather than granting a second recycle');
    host.ws.close(); guest.ws.close();
  }

  console.log('\n-- dealing --');
  const solo = await client('Solo');
  send(solo, { t: 'practice' });
  await until(solo, function (v) { return v.phase === 'playing'; }, 'practice dealt');
  ok(solo.view.seats.length === 3 && solo.view.solo === true,
    'a practice table keeps all three seats');
  ok(solo.view.you.hand.length === 11, 'and deals you the seat on turn');
  {
    const stranger = await client('Practice-intruder');
    send(stranger, { t: 'resume', code: solo.code });
    await untilTrue(function () { return stranger.errors.length === 1; }, 'private practice refusal');
    ok(stranger.view === null && stranger.chatHistory === null && /do not have a seat/.test(stranger.errors[0]),
      'knowing a practice code never grants another session its cards or chat');
    send(stranger, { t: 'action', action: 'draw', piles: [0, 1] });
    await untilTrue(function () { return stranger.errors.length === 2; }, 'practice action refusal');
    ok(solo.view.turnPhase === 'draw', 'a refused practice guest cannot act on its owner’s hand');
    stranger.ws.close();
    const resumedSolo = await client('Practice-owner');
    resumedSolo.token = solo.token;
    send(resumedSolo, { t: 'resume', code: solo.code });
    await until(resumedSolo, function (v) { return !!v.you; }, 'practice owner resume');
    ok(JSON.stringify(resumedSolo.view.you.hand) === JSON.stringify(solo.view.you.hand),
      'the actual practice owner can still reconnect');
    resumedSolo.ws.close();
  }
  solo.ws.close();

  send(b, { t: 'action', action: 'start' });
  await Promise.all([a, b, d].map(function (c) {
    return until(c, function (v) { return v.phase === 'playing'; }, 'round dealt for ' + c.name);
  }));
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
  const afterDraw = JSON.stringify({ hand: onTurn.view.you.hand, stocks: onTurn.view.stocks });
  const beforeRepeat = onTurn.errors.length;
  send(onTurn, { t: 'action', action: 'draw', piles: [0, 1] });
  await untilTrue(function () { return onTurn.errors.length > beforeRepeat; }, 'duplicate draw refusal');
  ok(afterDraw === JSON.stringify({ hand: onTurn.view.you.hand, stocks: onTurn.view.stocks }) &&
    /already drawn/.test(onTurn.errors[onTurn.errors.length - 1]),
    'a duplicate draw click cannot draw extra cards');
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
  ok(a2.chatHistory.length === 100 && a2.chatHistory[99].text === 'Most recent message',
    'reconnecting restores only that table’s latest chat history');
  await wait(150);
  ok(b.view.seats[0].connected === true, 'and the table shows you back');

  console.log('\n-- a full game --');
  const players = [a2, b, d];
  let turns = 0;
  const started = Date.now();
  const BUDGET = Number(process.env.GAME_BUDGET_MS || 180000);
  let refusalStorm = null;
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
    // A ceiling on actions, not the real stall detector — the time budget above
    // is. Set high enough that an unusually long but perfectly healthy random
    // game does not read as a failure; rules.test.js's 1,200-game sweep is what
    // actually catches a game that cannot finish.
    if (turns > 20000) break;
    /* A refused move changes nothing, so a bot that keeps offering one will
     * offer it until the budget runs out and report only that the game did not
     * finish. Stop at the first sign of that and say which move and whose, so
     * the next person sees the cause instead of the symptom. */
    const stuck = players.find(function (p) { return p.errors.length > 200; });
    if (stuck) {
      refusalStorm = stuck.name + ' had ' + stuck.errors.length + ' moves refused, last: ' +
        JSON.stringify(stuck.errors[stuck.errors.length - 1]);
      break;
    }
  }

  ok(!refusalStorm, 'no player is left offering a move the referee keeps refusing' +
    (refusalStorm ? ' — ' + refusalStorm : ''));

  if (a2.view.phase !== 'gameEnd') {
    console.log('     (reached ' + a2.view.phase + ' after ' + turns + ' actions in ' +
      Math.round((Date.now() - started) / 1000) + 's — budget ' + Math.round(BUDGET / 1000) + 's)');
    if (process.env.DIAG) {
      const v = a2.view;
      console.log('     DIAG round=' + v.round + ' turn=' + v.turn + ' phase=' + v.turnPhase +
        ' stocks=' + JSON.stringify(v.stocks) + ' discard=' + v.discardCount);
      [a2, b, d].forEach(function (c, i) {
        const last = c.errors.slice(-3);
        console.log('     DIAG seat' + i + ' errors=' + c.errors.length +
          ' hand=' + (c.view.you ? c.view.you.hand.length : '?') +
          ' inFoot=' + (c.view.you ? c.view.you.inFoot : '?') +
          ' down=' + (c.view.you ? c.view.you.hasInitialMeld : '?') +
          ' melds=' + c.view.seats[c.view.you.seat].melds.length +
          (last.length ? ' | ' + JSON.stringify(last) : ''));
      });
    }
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

  /* ---------- the pile peek is a rule, and a redaction ---------- */
  console.log('\n-- showing what the pile holds --');

  const cap = a2.view.settings.pileTakeExtra + 1;
  const peek = a2.view.discardPeek;
  ok(Array.isArray(peek), 'the table plays the pile open by default, so the cards come through');
  ok(peek && peek.length <= cap,
    'and never more than a take would actually reach (' + (peek && peek.length) + ' <= ' + cap + ')');
  ok(peek && peek[peek.length - 1] === a2.view.discardTop,
    'the last of them is the top card, the one a take is built on');

  // Everyone sees the same pile: it is a table rule, not a private hint.
  ok(JSON.stringify(b.view.discardPeek) === JSON.stringify(a2.view.discardPeek),
    'every seat is shown the same cards');

  // Turning it off must actually withhold them, not merely hide them in the
  // interface — a browser that ignores the setting has to come up empty.
  send(a2, { t: 'action', action: 'setRule', key: 'revealPileTake', value: false });
  await untilTrue(function () { return a2.view.discardPeek === null; }, 'the pile to close', 3000);
  ok(a2.view.discardPeek === null, 'closing it withholds the cards from the payload, not just the page');
  ok(b.view.discardPeek === null, 'and from every other seat too');
  ok(a2.view.settings.revealPileTake === false, 'the setting itself rides along so the switch can show it');

  const closedPayload = a2.seenPayloads[a2.seenPayloads.length - 1];
  const buried = a2.view.discardCount > cap;
  ok(!buried || !closedPayload.includes('"discardPeek":['),
    'a closed pile sends no cards at all');

  send(a2, { t: 'action', action: 'setRule', key: 'revealPileTake', value: true });
  await untilTrue(function () { return Array.isArray(a2.view.discardPeek); }, 'the pile to reopen', 3000);
  ok(Array.isArray(a2.view.discardPeek), 'and it can be turned back on');

  // The allowlist is the whole point: a client must not be able to reach a
  // rule that decides what is a legal play.
  const bookBefore = a2.view.settings.bookSize;
  const errsBefore = a2.errors.length;
  send(a2, { t: 'action', action: 'setRule', key: 'bookSize', value: true });
  send(a2, { t: 'action', action: 'setRule', key: 'minMelds', value: false });
  await wait(250);
  ok(a2.view.settings.bookSize === bookBefore, 'a client cannot set a rule that decides legal play');
  ok(a2.errors.length > errsBefore, 'and is told the rule is not adjustable');

  /* ---- the Home Screen app ----
   * The icons are compiled into icons.js as base64, so the thing to prove is
   * that they come back out as real images of the size the manifest claims. */
  const man = await get('/manifest.webmanifest');
  ok(man.status === 200, 'the web manifest is served');
  ok(/application\/manifest\+json/.test(man.headers['content-type'] || ''),
    'and with the content type a browser needs to accept it');
  let parsed = null;
  try { parsed = JSON.parse(man.body.toString('utf8')); } catch (e) {}
  ok(parsed !== null, 'and it is valid JSON');
  ok(parsed && parsed.display === 'standalone',
    'the app opens standalone, without the address bar');
  ok(parsed && parsed.start_url === '/', 'and starts at the table');

  // PNG magic number, then the width and height out of the IHDR chunk.
  function png(buf) {
    if (buf.length < 24 || buf.slice(1, 4).toString() !== 'PNG') return null;
    return buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20);
  }
  for (const [file, size] of [
    ['/apple-touch-icon.png', '180x180'],
    ['/icon-192.png', '192x192'],
    ['/icon-512.png', '512x512'],
  ]) {
    const r = await get(file);
    ok(r.status === 200 && r.headers['content-type'] === 'image/png',
      file + ' is served as a PNG');
    ok(png(r.body) === size, 'and it really is ' + size);
  }
  for (const ic of (parsed && parsed.icons) || []) {
    const r = await get(ic.src);
    ok(r.status === 200, 'the manifest icon ' + ic.src + ' exists');
    ok(png(r.body) === ic.sizes, 'and matches the size the manifest declares');
  }

  // Adding an icon route must not have opened a door to the server's own files.
  for (const [file, type] of [['/menu.js', 'text/javascript'], ['/menu.css', 'text/css'], ['/handfoot-mark.svg', 'image/svg+xml']]) {
    const r = await get(file);
    ok(r.status === 200 && (r.headers['content-type'] || '').startsWith(type) && r.body.length > 0,
      file + ' is served with its expected browser content type');
  }
  for (const secret of ['/icons.js', '/game.js', '/bot.js', '/server.js', '/package.json', '/package-lock.json', '/tables.json', '/.test-tables.json']) {
    const r = await get(secret);
    ok(r.status === 404, secret + ' is still not served to browsers');
  }

  const malformed = await get('/%E0%A4%A');
  const health = await get('/health');
  ok(malformed.status === 400 && health.status === 200,
    'a malformed URL is rejected without taking the game server down');

  console.log('\n-- computer seats survive a restart --');
  {
    const owner = await client('Bot-owner');
    send(owner, { t: 'vsbot', name: 'Bot-owner', bots: 2 });
    await until(owner, function (v) { return v.phase === 'playing'; }, 'computer table');
    const room = app.rooms.get(owner.code);
    const originalStyles = room.botStyles.slice();
    ok(owner.view.seats.filter(function (s) { return s.bot; }).length === 2,
      'the computer table identifies its two bot seats');

    room.game.phase = 'roundEnd';
    send(owner, { t: 'action', action: 'nextRound' });
    await until(owner, function (v) { return v.phase === 'playing' && v.round === 1; }, 'next computer round');
    ok(JSON.stringify(room.botStyles) === JSON.stringify(originalStyles),
      'computer personalities stay the same across rounds');

    // Schedule a bot, then disconnect before its delayed move starts.
    room.game.turn = 1;
    const beforePause = JSON.stringify(room.game);
    app.runBots(room);
    owner.ws.close();
    await untilTrue(function () { return room.live.size === 0; }, 'last watcher departure');
    await wait(200);
    ok(JSON.stringify(room.game) === beforePause,
      'a queued bot pauses when the last player disconnects');

    let saved;
    await untilTrue(function () {
      try {
        saved = JSON.parse(require('fs').readFileSync(process.env.SAVE_FILE, 'utf8'));
        return saved.rooms.some(function (r) { return r.code === owner.code && r.game.turn === 1; });
      } catch (e) { return false; }
    }, 'saved computer table', 4000);
    const savedRoom = saved.rooms.find(function (r) { return r.code === owner.code; });
    ok(JSON.stringify(savedRoom.bots) === '[false,true,true]',
      'saved tables include the computer seat flags');
    ok(JSON.stringify(savedRoom.botStyles) === JSON.stringify(originalStyles),
      'saved tables include their private computer personalities');

    // A fresh Node process exercises the actual disk-loading path, including
    // migration of files created before the bot flags were saved.
    function restoreSnapshot(file) {
      const script = [
        "const app = require('./server.js');",
        "app.server.on('listening', function () {",
        'const room = app.rooms.get(' + JSON.stringify(owner.code) + ');',
        "console.log('SNAPSHOT:' + JSON.stringify({bots:room.bots, botStyles:room.botStyles, view:app.viewFor(room,0), chat:room.chat}));",
        'app.server.close();',
        '});',
      ].join('\n');
      const output = require('child_process').execFileSync(process.execPath, ['-e', script], {
        cwd: __dirname,
        env: Object.assign({}, process.env, { PORT: '0', SAVE_FILE: file }),
        encoding: 'utf8', timeout: 5000,
      });
      return JSON.parse(output.split('\n').find(function (line) { return line.startsWith('SNAPSHOT:'); }).slice(9));
    }
    const restored = restoreSnapshot(process.env.SAVE_FILE);
    ok(JSON.stringify(restored.bots) === '[false,true,true]' && restored.view.turn === 1,
      'a restarted server restores the pending computer turn');
    ok(JSON.stringify(restored.botStyles) === JSON.stringify(originalStyles) && restored.view.botStyles === undefined,
      'a restart preserves computer personalities without exposing them to players');
    ok(restored.view.seats[1].bot && restored.view.seats[1].hand === undefined &&
      restored.view.you.hand.length === room.game.players[0].hand.length,
      'restoring a computer table preserves hand privacy');
    ok(restored.chat.length === 0, 'chat history is intentionally kept only for this server session');

    const legacyFile = process.env.SAVE_FILE + '.legacy';
    const legacyRoom = JSON.parse(JSON.stringify(savedRoom));
    delete legacyRoom.bots;
    delete legacyRoom.botStyles;
    require('fs').writeFileSync(legacyFile, JSON.stringify({ v: 1, rooms: [legacyRoom] }));
    try {
      const legacy = restoreSnapshot(legacyFile);
      ok(JSON.stringify(legacy.bots) === '[false,true,true]',
        'older saves recover their named computer seats instead of freezing');
      ok(JSON.stringify(legacy.botStyles) === '[null,"balanced","balanced"]',
        'older saves use the original balanced personality until a rematch');
    } finally { require('fs').unlinkSync(legacyFile); }

    // The four-player limit applies to new setup, never to cards already saved
    // by older versions. Loading a larger table must not truncate its seats.
    const largerFile = process.env.SAVE_FILE + '.larger';
    const largerRoom = JSON.parse(JSON.stringify(savedRoom));
    largerRoom.game = G.createGame(['Owner', 'A (bot)', 'B (bot)', 'C (bot)', 'D (bot)']);
    largerRoom.game.code = owner.code;
    G.startRound(largerRoom.game);
    largerRoom.tokens = [owner.token, null, null, null, null];
    largerRoom.bots = [false, true, true, true, true];
    largerRoom.botStyles = [null, 'builder', 'collector', 'runner', 'balanced'];
    require('fs').writeFileSync(largerFile, JSON.stringify({ v: 1, rooms: [largerRoom] }));
    try {
      const larger = restoreSnapshot(largerFile);
      ok(larger.view.seats.length === 5 && larger.bots.length === 5 &&
        larger.view.seats.every(function (s) { return s.handCount === 11 && s.footCount === 11; }) &&
        JSON.stringify(larger.view.you.hand) === JSON.stringify(largerRoom.game.players[0].hand),
        'legacy tables over four players keep every saved seat and card when restored');
    } finally { require('fs').unlinkSync(largerFile); }

    const returning = await client('Bot-owner-returned');
    returning.token = owner.token;
    send(returning, { t: 'resume', code: owner.code });
    await until(returning, function (v) {
      return v.turn !== 1 || v.turnPhase !== 'draw';
    }, 'computer resumes when watched');
    ok(JSON.stringify(room.game) !== beforePause, 'the computer continues once its player reconnects');
    ok(JSON.stringify(room.botStyles) === JSON.stringify(originalStyles),
      'reconnecting preserves each computer personality');
    room.game.phase = 'gameEnd';
    send(returning, { t: 'action', action: 'rematch' });
    await until(returning, function (v) { return v.phase === 'playing' && v.round === 0 && v.turn === 0; }, 'computer rematch');
    ok(room.botStyles.every(function (style, i) {
      return i === 0 ? style === null : BOT.STYLES.includes(style) && style !== originalStyles[i];
    }), 'a rematch assigns fresh private computer personalities');
    returning.ws.close();
  }

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
