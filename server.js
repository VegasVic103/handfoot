/* Hand and Foot — game server.
 *
 * The server owns the game. Clients never receive another player's cards:
 * every client gets a view redacted for their seat, and every action is
 * re-validated by the rules engine against the real state. A client that
 * lies about which cards it holds is rejected by the engine, not by trust.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const E = require('./engine.js');
const G = require('./game.js');
const BOT = require('./bot.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = __dirname;
// Only these are served to browsers; everything else stays server-side.
const SERVABLE = { '/index.html': 1, '/app.js': 1, '/style.css': 1 };
const SAVE_FILE = process.env.SAVE_FILE || path.join(__dirname, 'tables.json');
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;   // a table is forgotten after 12 quiet hours
const MAX_ROOMS = 200;

/* ---------------- rooms ---------------- */

/** code -> { code, game, tokens[], names[], solo, touched, live:Map(token -> Set<ws>) } */
const rooms = new Map();

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';  // no I or O
function makeCode() {
  for (let tries = 0; tries < 200; tries++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    if (!rooms.has(s)) return s;
  }
  return 'T' + Date.now().toString(36).slice(-3).toUpperCase();
}

function newRoom(seatCount, solo) {
  const names = [];
  for (let i = 0; i < seatCount; i++) names.push(solo ? 'Seat ' + (i + 1) : 'Open seat');
  const room = {
    code: makeCode(),
    game: G.createGame(names),
    tokens: new Array(seatCount).fill(null),
    solo: !!solo,
    bots: new Array(seatCount).fill(false),
    touched: Date.now(),
    live: new Map(),
  };
  room.game.code = room.code;
  rooms.set(room.code, room);
  return room;
}

function seatOf(room, token) {
  return room.tokens.indexOf(token);
}

function seatedCount(room) {
  return room.tokens.filter(function (t, i) {
    return !!t || (room.bots && room.bots[i]);
  }).length;
}

function isBotSeat(room, i) { return !!(room.bots && room.bots[i]); }

function anyoneWatching(room) {
  let n = 0;
  room.live.forEach(function (set) { n += set.size; });
  return n > 0;
}

function connectedSeats(room) {
  return room.tokens.map(function (t) {
    return !!(t && room.live.has(t) && room.live.get(t).size);
  });
}

/* ---------------- redaction ----------------
 * This is the whole reason the server exists. `viewFor` is the only function
 * that turns real state into something a client sees, so a card can only leak
 * if it leaks here. Other players' hands and feet become counts. */

function viewFor(room, seat) {
  const g = room.game;
  const S = g.settings;
  const conn = connectedSeats(room);

  const seats = g.seats.map(function (s, i) {
    const p = g.players[i];
    let red = 0, black = 0;
    p.melds.forEach(function (m) {
      const st = E.meldStats(m, S);
      if (st.isRedBook) red++;
      else if (st.isBlackBook || st.isWildBook) black++;
    });
    return {
      name: s.name,
      bot: !!(room.bots && room.bots[i]),
      seated: !!room.tokens[i] || !!(room.bots && room.bots[i]),
      connected: conn[i],
      handCount: p.hand.length,
      footCount: p.foot.length,
      inFoot: p.inFoot,
      hasInitialMeld: p.hasInitialMeld,
      /* Your own red threes only. At a real table they sit face up, but this
       * table would rather not announce a 100-point penalty to everybody, so
       * each seat is told only about its own. They surface for everyone at
       * the round-end scoring, where they actually count. */
      redThrees: i === seat ? p.redThrees.length : 0,
      redBooks: red,
      blackBooks: black,
      melds: p.melds.map(function (m) {
        return { id: m.id, rank: m.rank, cards: m.cards.slice() };
      }),
      wentOut: p.wentOut,
    };
  });

  const you = seat >= 0 ? {
    seat: seat,
    hand: g.players[seat].hand.slice(),
    inFoot: g.players[seat].inFoot,
    footCount: g.players[seat].foot.length,
    hasInitialMeld: g.players[seat].hasInitialMeld,
    /* The actual cards, so you can see what the penalty is for. A red three
     * never sits in your hand — it lays itself off the moment it is dealt or
     * drawn and a replacement comes in — which is why it needs showing
     * somewhere at all. */
    redThrees: g.players[seat].redThrees.slice(),
    canGoOut: g.phase === 'playing' ? G.canGoOut(g, seat) : { ok: false, reason: '' },
    // Which cards arrived this turn. It rides inside `you`, never in the
    // shared turnState, so it reaches only the seat holding those cards.
    picked: (g.turnState && g.turn === seat && g.turnState.picked)
      ? g.turnState.picked.slice() : [],
  } : null;

  return {
    code: g.code,
    solo: room.solo,
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
      bookSize: S.bookSize,
      drawCount: S.drawCount,
      distinctDrawPiles: S.distinctDrawPiles,
      pileNaturalsRequired: S.pileNaturalsRequired,
      pileTakeExtra: S.pileTakeExtra,
      maxWildsInBook: S.maxWildsInBook,
      minMelds: S.minMelds,
    },
    seats: seats,
    you: you,
    stocks: (g.stocks || []).map(function (p) { return p.length; }),
    discardTop: g.discard.length ? g.discard[g.discard.length - 1] : null,
    discardCount: g.discard.length,
    scores: g.scores,
    roundDetail: g.roundDetail || null,
    outSeat: typeof g.outSeat === 'number' ? g.outSeat : null,
    log: (g.log || []).slice(-8),
    seated: seatedCount(room),
  };
}

function broadcast(room) {
  room.live.forEach(function (sockets, token) {
    const seat = room.solo ? room.game.turn : seatOf(room, token);
    const payload = JSON.stringify({ t: 'state', view: viewFor(room, seat) });
    sockets.forEach(function (ws) {
      if (ws.readyState === 1) ws.send(payload);
    });
  });
}

/* ---------------- the computer opponent ----------------
 * A bot seat is driven from the same redacted view a human at that seat would
 * get, and its move goes through applyAction like anyone else's. Moves are
 * paced so a person can follow what happened. */

const BOT_PACE_MS = Number(process.env.BOT_PACE_MS || 850);

function runBots(room) {
  if (!room || room.botTimer) return;
  const g = room.game;
  if (!g || g.phase !== 'playing') return;
  if (!isBotSeat(room, g.turn)) return;
  if (!anyoneWatching(room)) return;   // nobody is looking; don't burn the free tier

  room.botTimer = setTimeout(function () {
    room.botTimer = null;
    const seat = room.game.turn;
    if (room.game.phase !== 'playing' || !isBotSeat(room, seat)) return;

    /* A turn is a draw, a handful of melds and a discard. If a bot ever takes
     * far more moves than that it is going round in a circle — laying cards
     * and taking them back, say — so cut the turn short rather than let the
     * table tick over at one move a second forever. */
    if (!room.botRun || room.botRun.seat !== seat || room.game.turnPhase === 'draw') {
      room.botRun = { seat: seat, n: 0 };
    }
    if (++room.botRun.n > 40) {
      room.botFaults = (room.botFaults || []).concat([{
        seat: seat, action: 'loop', reason: 'too many moves in one turn', at: Date.now(),
      }]).slice(-20);
      console.error('bot looped at seat ' + seat + '; forcing a discard');
      forceBotDiscard(room, seat);
      broadcast(room);
      save();
      return runBots(room);
    }

    const move = BOT.decide(viewFor(room, seat));
    if (!move) { forceBotDiscard(room, seat); broadcast(room); return runBots(room); }

    const msg = Object.assign({ t: 'action' }, move);
    const r = applyAction(room, room.tokens[seat] || ('bot:' + seat), msg, seat);
    if (!r || !r.ok) {
      // The bot proposed something the referee refused. That is a bug worth
      // seeing, so record it and fall back to a legal discard rather than
      // leaving the table frozen.
      room.botFaults = (room.botFaults || []).concat([{
        seat: seat, action: move.action, reason: r && r.reason, at: Date.now(),
      }]).slice(-20);
      console.error('bot move refused at seat ' + seat + ': ' + move.action +
        ' -> ' + (r && r.reason));
      forceBotDiscard(room, seat);
    }
    room.touched = Date.now();
    broadcast(room);
    save();
    runBots(room);
  }, BOT_PACE_MS);
}

/* last resort so a refused bot move can never stall the table */
function forceBotDiscard(room, seat) {
  const g = room.game;
  if (g.phase !== 'playing' || g.turn !== seat) return;
  if (g.turnPhase === 'draw') {
    const live = [];
    (g.stocks || []).forEach(function (p, i) { if (p.length) live.push(i); });
    G.drawStock(g, seat, live.length >= g.settings.distinctDrawPiles ? [live[0], live[1]] : []);
  }
  if (g.phase !== 'playing' || g.turn !== seat) return;
  const hand = g.players[seat].hand.filter(function (c) { return !E.isRedThree(c); });
  for (const c of hand) { if (G.discard(g, seat, c).ok) return; }
}

function sendTo(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function fail(ws, message) { sendTo(ws, { t: 'error', message: message }); }

/* ---------------- actions ---------------- */

function actingSeat(room, token) {
  // A practice table is one person playing every seat.
  return room.solo ? room.game.turn : seatOf(room, token);
}

function applyAction(room, token, msg, forcedSeat) {
  const g = room.game;
  const seat = typeof forcedSeat === 'number' ? forcedSeat : actingSeat(room, token);
  if (seat < 0) return { ok: false, reason: 'You are not seated at this table.' };
  if (typeof forcedSeat !== 'number' && !room.solo && seatOf(room, token) < 0) {
    return { ok: false, reason: 'You are not seated at this table.' };
  }

  switch (msg.action) {
    case 'start': {
      if (g.phase !== 'lobby') return { ok: false, reason: 'The game has already started.' };
      if (!room.solo && seatedCount(room) < 2) {
        return { ok: false, reason: 'You need at least two players before dealing.' };
      }
      // Drop seats nobody claimed, so a no-show is not dealt in and does not
      // stall the game when their turn comes round.
      if (!room.solo && seatedCount(room) < room.tokens.length) {
        const keep = [];
        room.tokens.forEach(function (t, i) { if (t || isBotSeat(room, i)) keep.push(i); });
        const names = keep.map(function (i) { return room.game.seats[i].name; });
        const tokens = keep.map(function (i) { return room.tokens[i]; });
        const bots = keep.map(function (i) { return isBotSeat(room, i); });
        room.game = G.createGame(names);
        room.game.code = room.code;
        room.tokens = tokens;
        room.bots = bots;
        return G.startRound(room.game);
      }
      return G.startRound(g);
    }
    case 'draw':
      return G.drawStock(g, seat, Array.isArray(msg.piles) ? msg.piles.map(Number) : []);
    case 'pile':
      return G.takePile(g, seat, sanitizeCards(msg.cards));
    case 'meldNew':
      return G.meldNew(g, seat, String(msg.rank || ''), sanitizeCards(msg.cards));
    case 'meldAdd':
      return G.meldAdd(g, seat, String(msg.meldId || ''), sanitizeCards(msg.cards));
    case 'discard':
      return G.discard(g, seat, String(msg.card || ''));
    case 'undo':
      return G.undoTurnMelds(g, seat);
    case 'nextRound':
      if (g.phase !== 'roundEnd') return { ok: false, reason: 'The round is still in play.' };
      return G.nextRound(g);
    case 'rematch':
      if (g.phase !== 'gameEnd') return { ok: false, reason: 'Finish this game first.' };
      g.round = 0; g.scores = []; g.roundDetail = null; g.outSeat = null;
      return G.startRound(g);
    default:
      return { ok: false, reason: 'Unknown action.' };
  }
}

function sanitizeCards(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(function (c) { return typeof c === 'string' && c.length <= 5; }).slice(0, 40);
}

function cleanName(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
}

/* ---------------- websocket wiring ---------------- */

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

wss.on('connection', function (ws) {
  ws.token = null;
  ws.room = null;

  ws.on('message', function (raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch (e) { return fail(ws, 'Bad message.'); }
    if (!msg || typeof msg !== 'object') return fail(ws, 'Bad message.');

    const token = typeof msg.token === 'string' && msg.token.length >= 8 && msg.token.length <= 64
      ? msg.token : null;
    if (!token) return fail(ws, 'Missing session token. Reload the page.');
    ws.token = token;

    if (msg.t === 'vsbot') {
      if (rooms.size >= MAX_ROOMS) sweep(true);
      if (rooms.size >= MAX_ROOMS) return fail(ws, 'The server is full right now. Try again shortly.');
      const opponents = Math.max(1, Math.min(5, parseInt(msg.bots, 10) || 2));
      const room = newRoom(opponents + 1, false);
      room.tokens[0] = token;
      room.game.seats[0].name = cleanName(msg.name) || 'You';
      const BOT_NAMES = ['Ace', 'Deuce', 'Trey', 'Cleo', 'Rook'];
      for (let i = 1; i <= opponents; i++) {
        room.bots[i] = true;
        room.game.seats[i].name = BOT_NAMES[i - 1] + ' (bot)';
      }
      G.startRound(room.game);
      attach(ws, room, token);
      sendTo(ws, { t: 'joined', code: room.code, seat: 0 });
      broadcast(room);
      save();
      runBots(room);
      return;
    }

    if (msg.t === 'create' || msg.t === 'practice') {
      if (rooms.size >= MAX_ROOMS) sweep(true);
      if (rooms.size >= MAX_ROOMS) return fail(ws, 'The server is full right now. Try again shortly.');
      const solo = msg.t === 'practice';
      let seats = solo ? 3 : Math.max(2, Math.min(6, parseInt(msg.seats, 10) || 3));
      const room = newRoom(seats, solo);
      room.tokens[0] = token;
      if (!solo) room.game.seats[0].name = cleanName(msg.name) || 'Host';
      if (solo) { G.startRound(room.game); }
      attach(ws, room, token);
      sendTo(ws, { t: 'joined', code: room.code, seat: 0 });
      broadcast(room);
      save();
      return;
    }

    if (msg.t === 'join') {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room) return fail(ws, 'No table with the code ' + (code || '????') + '.');
      if (room.solo) return fail(ws, 'That is a practice table — it takes only one player.');

      let seat = seatOf(room, token);
      if (seat === -1) {
        seat = room.tokens.indexOf(null);
        if (seat === -1) return fail(ws, 'That table is full.');
        if (room.game.phase !== 'lobby') {
          return fail(ws, 'That game has already started.');
        }
        room.tokens[seat] = token;
      }
      room.game.seats[seat].name = cleanName(msg.name) || room.game.seats[seat].name || 'Player';
      attach(ws, room, token);
      sendTo(ws, { t: 'joined', code: room.code, seat: seat });
      broadcast(room);
      save();
      return;
    }

    if (msg.t === 'resume') {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room) return fail(ws, 'That table is no longer open.');
      const seat = seatOf(room, token);
      if (seat === -1 && !room.solo) return fail(ws, 'You do not have a seat at that table.');
      attach(ws, room, token);
      sendTo(ws, { t: 'joined', code: room.code, seat: room.solo ? room.game.turn : seat });
      broadcast(room);
      runBots(room);
      return;
    }

    if (msg.t === 'action') {
      const room = ws.room;
      if (!room) return fail(ws, 'You are not at a table.');
      room.touched = Date.now();
      const r = applyAction(room, token, msg);
      if (!r || !r.ok) return fail(ws, (r && r.reason) || 'Not a legal play.');
      broadcast(room);
      save();
      runBots(room);
      return;
    }

    if (msg.t === 'ping') return sendTo(ws, { t: 'pong' });
    fail(ws, 'Unknown message.');
  });

  ws.on('close', function () {
    const room = ws.room;
    if (!room || !ws.token) return;
    const set = room.live.get(ws.token);
    if (set) {
      set.delete(ws);
      if (!set.size) room.live.delete(ws.token);
    }
    broadcast(room);
  });

  ws.on('error', function () { /* the close handler does the cleanup */ });
});

function attach(ws, room, token) {
  if (ws.room && ws.room !== room) {
    const old = ws.room.live.get(token);
    if (old) { old.delete(ws); if (!old.size) ws.room.live.delete(token); }
  }
  ws.room = room;
  room.touched = Date.now();
  if (!room.live.has(token)) room.live.set(token, new Set());
  room.live.get(token).add(ws);
}

/* ---------------- static files ---------------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, tables: rooms.size }));
  }
  // The browser needs the engine's pure display helpers (card colors, values,
  // meld legality for enabling buttons). Serve them from the one source file so
  // the client and server can never drift apart. game.js never leaves the server.
  if (rel === '/engine.js') {
    try {
      const src = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
      res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-cache' });
      return res.end(src.replace(/^module\.exports = \{/m, 'window.E = {'));
    } catch (e) { res.writeHead(500); return res.end('engine unavailable'); }
  }
  if (!SERVABLE[rel]) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(PUBLIC, rel.slice(1));
  fs.readFile(file, function (err, body) {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  });
}

/* ---------------- persistence ----------------
 * Tables survive a restart or a redeploy, so a game night is not lost when the
 * host goes to sleep and wakes up. Live sockets are not saved, only the game. */

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    const out = [];
    rooms.forEach(function (room) {
      out.push({
        code: room.code, game: room.game, tokens: room.tokens,
        solo: room.solo, touched: room.touched,
      });
    });
    try {
      fs.writeFileSync(SAVE_FILE, JSON.stringify({ v: 1, rooms: out }));
    } catch (e) { /* a read-only disk just means tables live in memory only */ }
  }, 1500);
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    (data.rooms || []).forEach(function (r) {
      if (!r || !r.code || !r.game) return;
      if (Date.now() - (r.touched || 0) > ROOM_TTL_MS) return;
      rooms.set(r.code, {
        code: r.code, game: r.game, tokens: r.tokens || [],
        solo: !!r.solo, touched: r.touched || Date.now(), live: new Map(),
      });
    });
    if (rooms.size) console.log('restored ' + rooms.size + ' table(s)');
  } catch (e) { /* first boot, or nothing saved yet */ }
}

function sweep(force) {
  const now = Date.now();
  rooms.forEach(function (room, code) {
    const idle = now - room.touched;
    if (idle > ROOM_TTL_MS || (force && idle > 60 * 60 * 1000 && !room.live.size)) {
      rooms.delete(code);
    }
  });
}
setInterval(function () { sweep(false); }, 15 * 60 * 1000).unref();

/* keep proxies from dropping idle sockets */
setInterval(function () {
  wss.clients.forEach(function (ws) { if (ws.readyState === 1) ws.ping(); });
}, 25000).unref();

load();
server.listen(PORT, function () {
  console.log('Hand and Foot server listening on ' + PORT);
});

module.exports = { server, rooms, viewFor, runBots };
