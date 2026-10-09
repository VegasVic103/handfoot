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
const { randomUUID, randomInt } = require('crypto');
const { WebSocketServer } = require('ws');

const E = require('./engine.js');
const G = require('./game.js');
const BOT = require('./bot.js');
const ICONS = require('./icons.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = __dirname;
// Only these are served to browsers; everything else stays server-side.
const SERVABLE = {
  '/index.html': 1, '/app.js': 1, '/style.css': 1, '/manifest.webmanifest': 1,
  '/menu.js': 1, '/menu.css': 1, '/enhancements.css': 1, '/handfoot-mark.svg': 1,
};
const SAVE_FILE = process.env.SAVE_FILE || path.join(__dirname, 'tables.json');
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;   // a table is forgotten after 12 quiet hours
const MAX_ROOMS = 200;
const MAX_NEW_PLAYERS = 4;
const CHAT_LIMIT = 100;
const CHAT_TEXT_LIMIT = 500;
const CHAT_BURST_LIMIT = 5;
const CHAT_WINDOW_MS = 10000;

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

function newRoom(seatCount, solo, settings) {
  const names = [];
  for (let i = 0; i < seatCount; i++) names.push(solo ? 'Seat ' + (i + 1) : 'Open seat');
  const room = {
    code: makeCode(),
    game: G.createGame(names, settings),
    tokens: new Array(seatCount).fill(null),
    solo: !!solo,
    bots: new Array(seatCount).fill(false),
    botStyles: new Array(seatCount).fill(null),
    hostSeat: 0,
    turnId: 0,
    touched: Date.now(),
    live: new Map(),
    chat: [],
    chatRates: new Map(),
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

function assignBotStyles(room, reroll) {
  const previous = room.botStyles || [];
  room.botStyles = room.bots.map(function (isBot, i) {
    if (!isBot) return null;
    if (!reroll && BOT.STYLES.includes(previous[i])) return previous[i];
    const choices = BOT.STYLES.filter(function (style) { return !reroll || style !== previous[i]; });
    return choices[randomInt(choices.length)];
  });
}

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

function publicSettings(settings) {
  const S = Object.assign({}, E.DEFAULTS, settings || {});
  return {
    deckCount: S.deckCount,
    bookSize: S.bookSize,
    drawCount: S.drawCount,
    distinctDrawPiles: S.distinctDrawPiles,
    pileNaturalsRequired: S.pileNaturalsRequired,
    pileTakeExtra: S.pileTakeExtra,
    maxWildsInBook: S.maxWildsInBook,
    minNaturalsInMeld: S.minNaturalsInMeld,
    minNaturalsWithWild: S.minNaturalsWithWild,
    closedBooksLocked: !!S.closedBooksLocked,
    highEightNine: !!S.highEightNine,
    redThreeBonus: !!S.redThreeBonus,
    goOutWithDiscard: !!S.goOutWithDiscard,
    minMelds: S.minMelds.slice(),
    handSize: S.handSize,
    footSize: S.footSize,
    stockPiles: S.stockPiles,
    redBookBonus: S.redBookBonus,
    blackBookBonus: S.blackBookBonus,
    goOutBonus: S.goOutBonus,
    redThreeValue: S.redThreeValue,
    redThreeAutoLayOff: !!S.redThreeAutoLayOff,
    requireRedBook: S.requireRedBook,
    requireBlackBook: S.requireBlackBook,
    revealPileTake: !!S.revealPileTake,
    reshuffleOnce: !!S.reshuffleOnce,
  };
}

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
    turnId: room.turnId,
    turnPhase: g.turnPhase,
    turnState: g.turnState
      ? { melded: g.turnState.melded, tookPile: g.turnState.tookPile, drew: g.turnState.drew }
      : null,
    settings: publicSettings(S),
    pendingSettings: g.pendingSettings ? publicSettings(g.pendingSettings) : null,
    hostSeat: room.hostSeat,
    canConfigureRules: seat >= 0 && (room.solo || seat === room.hostSeat) && !!room.tokens[room.hostSeat],
    reshufflesUsed: Number(g.reshufflesUsed) || 0,
    reshufflesRemaining: S.reshuffleOnce ? Math.max(0, 1 - (Number(g.reshufflesUsed) || 0)) : 0,
    seats: seats,
    you: you,
    stocks: (g.stocks || []).map(function (p) { return p.length; }),
    discardTop: g.discard.length ? g.discard[g.discard.length - 1] : null,
    discardCount: g.discard.length,
    /* The cards a pile-take would bring in, when the table plays the pile
     * open. Capped at what a take actually reaches, so it is never a window
     * onto the rest of the pile — and null when the rule is off, so a browser
     * that ignores the setting still has nothing to show. */
    discardPeek: S.revealPileTake && g.discard.length ? G.pileTakeCards(g) : null,
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
    if (room.game.phase !== 'playing' || !isBotSeat(room, seat) ||
        !anyoneWatching(room) || rooms.get(room.code) !== room) return;

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

    const move = BOT.decide(viewFor(room, seat), room.botStyles && room.botStyles[seat]);
    if (!move) {
      forceBotDiscard(room, seat);
      room.touched = Date.now();
      broadcast(room);
      save();
      return runBots(room);
    }

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
  const before = turnContext(room);
  try { return forceBotDiscardNow(room, seat); }
  finally { advanceTurnId(room, before); }
}

function forceBotDiscardNow(room, seat) {
  const g = room.game;
  if (g.phase !== 'playing' || g.turn !== seat) return;
  if (g.turnPhase === 'draw') {
    const live = [];
    (g.stocks || []).forEach(function (p, i) { if (p.length) live.push(i); });
    G.drawStock(g, seat, live.length >= g.settings.distinctDrawPiles ? [live[0], live[g.settings.distinctDrawPiles === 1 ? 0 : 1]] : []);
  }
  if (g.phase !== 'playing' || g.turn !== seat) return;
  const tryAll = function () {
    const hand = g.players[seat].hand.filter(function (c) { return !E.isRedThree(c); });
    for (const c of hand) { if (G.discard(g, seat, c).ok) return true; }
    // A red three is a legal discard at this table, so fall back to one.
    for (const c of g.players[seat].hand.slice()) { if (G.discard(g, seat, c).ok) return true; }
    return false;
  };
  if (tryAll()) return;
  /* Nothing it holds can be thrown. In the foot that means it has melded down
   * past the two cards the rule makes it keep, so hand back this turn's melds
   * and discard from the hand it started with. A bot should never reach here —
   * layBudget stops it — but a wedged seat would stall the whole table. */
  G.undoTurnMelds(g, seat);
  // Undoing a pile take restores the draw phase; a discard is not legal until
  // the bot has replaced that take with a stock draw.
  if (g.turnPhase === 'draw') {
    const live = [];
    (g.stocks || []).forEach(function (p, i) { if (p.length) live.push(i); });
    G.drawStock(g, seat, live.length >= g.settings.distinctDrawPiles ? [live[0], live[g.settings.distinctDrawPiles === 1 ? 0 : 1]] : []);
  }
  tryAll();
}

function sendTo(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function fail(ws, message, context) {
  sendTo(ws, { t: 'error', message: message, context: context });
}

function joined(ws, room, seat) {
  sendTo(ws, { t: 'joined', code: room.code, seat: seat });
  sendTo(ws, { t: 'chatHistory', messages: room.chat || [] });
}

/* ---------------- actions ---------------- */

function actingSeat(room, token) {
  // A practice table is one person playing every seat.
  return room.solo ? room.game.turn : seatOf(room, token);
}

/* The existing shared preview toggle stays live for every seated player.
 * Structural/scoring rules use the separate host-only validated action. */
const SETTABLE_RULES = ['revealPileTake'];
const TURN_ACTIONS = new Set(['start', 'draw', 'pile', 'meldNew', 'meldAdd',
  'discard', 'undo', 'nextRound', 'rematch']);

function turnContext(room) {
  const g = room.game;
  return [g.phase, g.round, g.turn].join(':');
}

function advanceTurnId(room, before) {
  if (turnContext(room) !== before) room.turnId++;
}

function applyAction(room, token, msg, forcedSeat) {
  const before = turnContext(room);
  const result = dispatchAction(room, token, msg, forcedSeat);
  if (result && result.ok) advanceTurnId(room, before);
  return result;
}

function dispatchAction(room, token, msg, forcedSeat) {
  const g = room.game;
  const seat = typeof forcedSeat === 'number' ? forcedSeat : actingSeat(room, token);
  if (seat < 0) return { ok: false, reason: 'You are not seated at this table.' };
  if (typeof forcedSeat !== 'number' && seatOf(room, token) < 0) {
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
        const botStyles = keep.map(function (i) { return (room.botStyles || [])[i] || null; });
        room.game = G.createGame(names, g.settings);
        room.game.code = room.code;
        room.tokens = tokens;
        room.bots = bots;
        room.botStyles = botStyles;
        room.hostSeat = keep.indexOf(room.hostSeat);
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
    case 'configureRules': {
      if (typeof forcedSeat === 'number' || token !== room.tokens[room.hostSeat]) {
        return { ok: false, reason: 'Only the host can change the table rules.' };
      }
      const checked = E.validateSettings(msg.rules, g.seats.length, g.pendingSettings || g.settings);
      if (!checked.ok) return checked;
      if (g.phase === 'lobby') {
        g.settings = checked.settings;
        g.pendingSettings = null;
      } else {
        // Never rewrite the referee underneath cards already dealt. A full
        // validated snapshot is persisted and applied by startRound instead.
        g.pendingSettings = JSON.stringify(publicSettings(checked.settings)) ===
          JSON.stringify(publicSettings(g.settings)) ? null : checked.settings;
      }
      return { ok: true };
    }
    case 'setRule': {
      const key = String(msg.key || '');
      if (SETTABLE_RULES.indexOf(key) === -1) return { ok: false, reason: 'That rule is not adjustable.' };
      const value = !!msg.value;
      if (g.pendingSettings) g.pendingSettings[key] = value;
      if (g.settings[key] === value) return { ok: true };
      g.settings[key] = value;
      G.logRule(g, seat, key, value);
      return { ok: true };
    }
    case 'nextRound':
      if (g.phase !== 'roundEnd') return { ok: false, reason: 'The round is still in play.' };
      return G.nextRound(g);
    case 'rematch':
      if (g.phase !== 'gameEnd') return { ok: false, reason: 'Finish this game first.' };
      assignBotStyles(room, true);
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

function initialRules(msg, seatCount) {
  const input = msg.rules === undefined ? {} : msg.rules;
  const checked = E.validateSettings(input, seatCount);
  if (!checked.ok) return checked;
  // Retain the established setup checkbox without trusting arbitrary settings.
  if (typeof msg.revealDiscard === 'boolean') checked.settings.revealPileTake = msg.revealDiscard;
  return checked;
}

/* ---------------- websocket wiring ---------------- */

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, maxPayload: 16384 });

wss.on('connection', function (ws) {
  ws.token = null;
  ws.room = null;
  ws.isAlive = true;
  ws.on('pong', function () { ws.isAlive = true; });

  ws.on('message', function (raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch (e) { return fail(ws, 'Bad message.'); }
    if (!msg || typeof msg !== 'object') return fail(ws, 'Bad message.');

    const token = typeof msg.token === 'string' && msg.token.length >= 8 && msg.token.length <= 64
      ? msg.token : null;
    if (!token) return fail(ws, 'Missing session token. Reload the page.');
    // A socket belongs to the session that attached it. An unsuccessful join
    // or a message with another token must not change who gets its snapshots.
    if (ws.token && ws.token !== token) return fail(ws, 'Session changed. Reconnect to continue.');

    if (msg.t === 'vsbot') {
      const opponents = msg.bots == null ? 2 :
        (typeof msg.bots === 'number' || typeof msg.bots === 'string') ? Number(msg.bots) : NaN;
      if (!Number.isInteger(opponents) || opponents < 1 || opponents >= MAX_NEW_PLAYERS) {
        return fail(ws, 'Choose between 1 and 3 computer opponents.');
      }
      const checked = initialRules(msg, opponents + 1);
      if (!checked.ok) return fail(ws, checked.reason);
      if (rooms.size >= MAX_ROOMS) sweep(true);
      if (rooms.size >= MAX_ROOMS) return fail(ws, 'The server is full right now. Try again shortly.');
      const room = newRoom(opponents + 1, false, checked.settings);
      room.tokens[0] = token;
      room.game.seats[0].name = cleanName(msg.name) || 'You';
      const BOT_NAMES = ['Ace', 'Deuce', 'Trey', 'Cleo', 'Rook'];
      for (let i = 1; i <= opponents; i++) {
        room.bots[i] = true;
        room.game.seats[i].name = BOT_NAMES[i - 1] + ' (bot)';
      }
      assignBotStyles(room, false);
      G.startRound(room.game);
      room.turnId++;
      attach(ws, room, token);
      joined(ws, room, 0);
      broadcast(room);
      save();
      runBots(room);
      return;
    }

    if (msg.t === 'create' || msg.t === 'practice') {
      const solo = msg.t === 'practice';
      const seats = solo || msg.seats == null ? 3 :
        (typeof msg.seats === 'number' || typeof msg.seats === 'string') ? Number(msg.seats) : NaN;
      if (!Number.isInteger(seats) || seats < 2 || seats > MAX_NEW_PLAYERS) {
        return fail(ws, 'Choose between 2 and 4 total players.');
      }
      const checked = initialRules(msg, seats);
      if (!checked.ok) return fail(ws, checked.reason);
      if (rooms.size >= MAX_ROOMS) sweep(true);
      if (rooms.size >= MAX_ROOMS) return fail(ws, 'The server is full right now. Try again shortly.');
      const room = newRoom(seats, solo, checked.settings);
      room.tokens[0] = token;
      if (!solo) room.game.seats[0].name = cleanName(msg.name) || 'Host';
      if (solo) { G.startRound(room.game); room.turnId++; }
      attach(ws, room, token);
      joined(ws, room, 0);
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
        if (room.hostSeat < 0) room.hostSeat = seat;
      }
      room.game.seats[seat].name = cleanName(msg.name) || room.game.seats[seat].name || 'Player';
      attach(ws, room, token);
      joined(ws, room, seat);
      broadcast(room);
      save();
      return;
    }

    if (msg.t === 'resume') {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room) return fail(ws, 'That table is no longer open.');
      const seat = seatOf(room, token);
      if (seat === -1) return fail(ws, 'You do not have a seat at that table.');
      attach(ws, room, token);
      joined(ws, room, room.solo ? room.game.turn : seat);
      broadcast(room);
      runBots(room);
      return;
    }

    if (msg.t === 'leave') {
      leave(ws);
      return;
    }

    if (msg.t === 'chat') {
      const room = ws.room;
      if (!room || seatOf(room, token) < 0) return fail(ws, 'You are not seated at this table.', 'chat');
      if (typeof msg.text !== 'string') return fail(ws, 'Write a message first.', 'chat');
      const body = msg.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
      if (!body) return fail(ws, 'Write a message first.', 'chat');
      if (body.length > CHAT_TEXT_LIMIT) return fail(ws, 'Messages can be up to 500 characters.', 'chat');
      const now = Date.now();
      const recent = (room.chatRates.get(token) || []).filter(function (at) {
        return now - at < CHAT_WINDOW_MS;
      });
      if (recent.length >= CHAT_BURST_LIMIT) return fail(ws, 'A little slower — try again in a few seconds.', 'chat');
      recent.push(now);
      room.chatRates.set(token, recent);
      const seat = actingSeat(room, token);
      const message = {
        id: randomUUID(), seat: seat,
        name: room.game.seats[seat].name, text: body, at: now,
      };
      room.chat.push(message);
      if (room.chat.length > CHAT_LIMIT) room.chat.splice(0, room.chat.length - CHAT_LIMIT);
      room.touched = now;
      room.live.forEach(function (sockets) {
        sockets.forEach(function (socket) { sendTo(socket, { t: 'chat', message: message }); });
      });
      return;
    }

    if (msg.t === 'action') {
      const room = ws.room;
      if (!room) return fail(ws, 'You are not at a table.');
      if (TURN_ACTIONS.has(msg.action) &&
          (!Number.isSafeInteger(msg.turnId) || msg.turnId !== room.turnId)) {
        fail(ws, 'That turn has changed. Your table has been refreshed.', 'staleTurn');
        sendTo(ws, { t: 'state', view: viewFor(room, actingSeat(room, token)) });
        return;
      }
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

function leave(ws) {
  const room = ws.room;
  if (!room) return sendTo(ws, { t: 'left' });
  const token = ws.token;
  const seat = seatOf(room, token);
  if (room.game.phase === 'lobby' && seat >= 0) {
    room.tokens[seat] = null;
    room.game.seats[seat].name = 'Open seat';
    room.chatRates.delete(token);
    if (room.hostSeat === seat) {
      room.hostSeat = room.tokens.findIndex(function (t) { return !!t; });
    }
    // A reservation belongs to the session, including its other open tabs.
    const sockets = room.live.get(token) || new Set([ws]);
    sockets.forEach(function (socket) {
      socket.room = null;
      sendTo(socket, { t: 'left' });
    });
    room.live.delete(token);
  } else {
    const sockets = room.live.get(token);
    if (sockets) {
      sockets.delete(ws);
      if (!sockets.size) room.live.delete(token);
    }
    ws.room = null;
    sendTo(ws, { t: 'left' });
  }
  room.touched = Date.now();
  broadcast(room);
  save();
}

function attach(ws, room, token) {
  const previous = ws.room;
  if (previous && previous !== room) {
    const old = previous.live.get(ws.token);
    if (old) { old.delete(ws); if (!old.size) previous.live.delete(ws.token); }
    broadcast(previous);
  }
  ws.room = room;
  ws.token = token;
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
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }
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
  // App icons. These are compiled into icons.js as base64 rather than kept as
  // .png files, because this repository is edited through a text-only editor.
  // They never change between deploys, so they are safe to cache hard.
  const art = ICONS.icon(rel.slice(1));
  if (art) {
    res.writeHead(200, {
      'content-type': TYPES['.png'],
      'content-length': art.length,
      'cache-control': 'public, max-age=604800',
    });
    return res.end(art);
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
    flushSave();
  }, 1500);
}

function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const out = [];
  rooms.forEach(function (room) {
    out.push({
      code: room.code, game: room.game, tokens: room.tokens,
      solo: room.solo, bots: room.bots, botStyles: room.botStyles,
      hostSeat: room.hostSeat, turnId: room.turnId, touched: room.touched,
    });
  });
  const temporary = SAVE_FILE + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ v: 1, rooms: out }));
    fs.renameSync(temporary, SAVE_FILE);
    return true;
  } catch (e) {
    console.error('Could not save tables: ' + e.message);
    try { fs.unlinkSync(temporary); } catch (ignored) {}
    return false;
  }
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    (data.rooms || []).forEach(function (r) {
      if (!r || !r.code || !r.game) return;
      if (Date.now() - (r.touched || 0) > ROOM_TTL_MS) return;
      // New settings have safe defaults for old saves; keep their cards and
      // all existing rules intact, including legacy tables over four seats.
      r.game.settings = Object.assign({}, E.DEFAULTS, r.game.settings || {});
      if (!Number.isInteger(r.game.reshufflesUsed)) r.game.reshufflesUsed = 0;
      const restored = {
        code: r.code, game: r.game, tokens: r.tokens || [],
        solo: !!r.solo,
        hostSeat: Number.isInteger(r.hostSeat) && (r.tokens || [])[r.hostSeat]
          ? r.hostSeat : (r.tokens || []).findIndex(function (t) { return !!t; }),
        turnId: Number.isSafeInteger(r.turnId) && r.turnId >= 0 ? r.turnId : 0,
        // Older saves did not store bot flags. Their unclaimed, named bot
        // seats are unambiguous, and must resume as computer opponents.
        bots: r.game.seats.map(function (s, i) {
          return Array.isArray(r.bots) ? !!r.bots[i] :
            !r.solo && !(r.tokens || [])[i] && / \(bot\)$/.test(s.name);
        }),
        botStyles: Array.isArray(r.botStyles) ? r.botStyles : [],
        touched: r.touched || Date.now(), live: new Map(), chat: [], chatRates: new Map(),
      };
      // Old saves use the original balanced player until their next rematch;
      // reconnecting must not silently change their personality each time.
      restored.botStyles = restored.bots.map(function (isBot, i) {
        if (!isBot) return null;
        return BOT.STYLES.includes(restored.botStyles[i]) ? restored.botStyles[i] : 'balanced';
      });
      rooms.set(r.code, restored);
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

/* A missing pong is a lost connection, not an indefinitely occupied socket. */
function heartbeat() {
  wss.clients.forEach(function (ws) {
    if (ws.readyState !== 1) return;
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}
const heartbeatTimer = setInterval(heartbeat, 25000);
heartbeatTimer.unref();

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeatTimer);
  rooms.forEach(function (room) { if (room.botTimer) clearTimeout(room.botTimer); });
  const saved = flushSave();
  wss.clients.forEach(function (ws) { ws.terminate(); });
  wss.close();
  server.close(function () { process.exit(saved ? 0 : 1); });
  setTimeout(function () { process.exit(saved ? 0 : 1); }, 1000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

load();
server.listen(PORT, function () {
  console.log('Hand and Foot server listening on ' + PORT);
});

module.exports = { server, rooms, viewFor, runBots, heartbeat, flushSave };
