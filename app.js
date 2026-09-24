/* Client. The server owns the game; this renders the view it sends and
 * forwards actions. It never holds another player's cards, because it is
 * never sent them. */

var ws = null, view = null, token = null;
var myCode = null, retry = 0, retryTimer = null, closedByUs = false;
var sel = [];          // selected card ids, in click order
var pileSel = [];      // chosen draw piles, in click order
var sortMode = 'rank';
var handLayout = 'spread';   // 'spread' = side by side, 'layered' = overlapped rows
var PER_ROW = 6;             // cards per row when layered
var notice = '', noticeBad = false;
var lastTurn = null;
var nudgeOn = true;      // announce the turn coming round to you

var $ = function (id) { return document.getElementById(id); };
var SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣', R: '★', B: '★' };

/* ---------------- how it looks ----------------
 * Yours alone. Nobody else at the table sees your choice and none of it
 * reaches the server, so two people can sit at the same table with different
 * decks and different cloth. It is kept in this browser, which means it
 * follows you between games but not between devices. */

var CARD_STYLES = [
  { id: 'classic', name: 'Classic',
    note: 'Bone faces with a red or black pip, the way a real deck is printed.' },
  { id: 'two', name: 'Two colour',
    note: 'The whole face is red or black. Easiest to read across a table.' },
  { id: 'four', name: 'Four colour',
    note: 'Spades black, hearts red, diamonds blue, clubs green, as the online rooms do it.' },
];
/* Each swatch is a miniature of the real table: the same three stops the body
 * wash uses, so what you pick is what you get. */
var THEMES = [
  { id: 'room', name: 'Card room', hi: '#1d4136', mid: '#16332b', lo: '#0e221c' },
  { id: 'midnight', name: 'Midnight', hi: '#1f2d45', mid: '#182234', lo: '#0d1420' },
  { id: 'claret', name: 'Claret', hi: '#371c21', mid: '#2a1519', lo: '#1a0c0f' },
  { id: 'graphite', name: 'Graphite', hi: '#2b3036', mid: '#22262b', lo: '#15181c' },
  { id: 'mahogany', name: 'Mahogany', hi: '#38271b', mid: '#2b1d14', lo: '#1a110b' },
];
var cardStyle = 'classic';
var theme = 'room';

/* ---------------- storage (never load-bearing) ---------------- */

function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } }
function del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

function has(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return true;
  return false;
}

/* Written straight onto <html>, so a theme or a deck is one attribute and the
 * stylesheet does the rest. Applied before the first paint, not on render, so
 * nobody watches the table change colour a moment after it appears. */
function applyLook() {
  var el = document.documentElement;
  el.setAttribute('data-cards', cardStyle);
  el.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content',
      getComputedStyle(el).getPropertyValue('--felt').trim() || '#16332b');
  }
}

function loadLook() {
  var c = get('hf_cards'), t = get('hf_theme');
  if (c && has(CARD_STYLES, c)) cardStyle = c;
  if (t && has(THEMES, t)) theme = t;
  applyLook();
}
loadLook();

var memory = {};
function sessionToken() {
  var t = get('hf_token') || memory.token;
  if (!t) {
    t = 'p' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    memory.token = t; set('hf_token', t);
  }
  return t;
}

function say(msg, bad) { notice = msg || ''; noticeBad = !!bad; render(); }

/* ---------------- connection ---------------- */

function connect() {
  var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  try { ws = new WebSocket(proto + location.host); }
  catch (e) { return scheduleRetry(); }

  ws.onopen = function () {
    retry = 0;
    $('connBar').hidden = true;
    if (myCode) send({ t: 'resume', code: myCode });
  };

  ws.onmessage = function (ev) {
    var msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }

    if (msg.t === 'state') {
      var first = !view;
      view = msg.view;
      if (view.turn !== lastTurn) {
        var was = lastTurn;
        sel = []; pileSel = []; lastTurn = view.turn;
        /* Bot turns go by in a second or two and it is easy to look away and
         * miss your own coming round. Not on the first state of a session: that
         * arrives on a reload, and buzzing at somebody for reopening the page
         * teaches them to turn the whole thing off. */
        if (!first && was !== null && isMyTurn() && view.phase === 'playing') announceTurn();
        else hideTurnBanner();
      }
      /* Melding or discarding takes cards out of the hand, but they stayed in
       * the selection — so the next thing you picked up was judged together
       * with cards you had already laid down, and no legal play could be
       * found. Keep only what is still in hand. A refused move leaves the hand
       * untouched, so a selection worth retrying survives this. */
      if (view.you && view.you.hand) {
        var inHand = view.you.hand;
        sel = sel.filter(function (c) { return inHand.indexOf(c) !== -1; });
      }
      if (first) { notice = ''; noticeBad = false; }
      showTable();
      render();
      return;
    }
    if (msg.t === 'joined') {
      myCode = msg.code;
      set('hf_code', myCode);
      $('lobbyErr').hidden = true;
      return;
    }
    if (msg.t === 'error') {
      if (view) say(msg.message, true);
      else lobbyError(msg.message);
      return;
    }
  };

  ws.onclose = function () {
    if (closedByUs) return;
    $('connBar').hidden = false;
    $('connBar').textContent = 'Reconnecting…';
    scheduleRetry();
  };

  ws.onerror = function () { /* onclose does the work */ };
}

function scheduleRetry() {
  if (retryTimer) return;
  retry = Math.min(retry + 1, 6);
  var wait = Math.min(500 * Math.pow(2, retry - 1), 8000);
  retryTimer = setTimeout(function () { retryTimer = null; connect(); }, wait);
}

function send(obj) {
  if (!ws || ws.readyState !== 1) {
    $('connBar').hidden = false;
    $('connBar').textContent = 'Not connected — reconnecting…';
    return false;
  }
  obj.token = token;
  ws.send(JSON.stringify(obj));
  return true;
}

function act(action, extra) {
  var msg = { t: 'action', action: action };
  if (extra) for (var k in extra) msg[k] = extra[k];
  if (send(msg)) { notice = ''; noticeBad = false; }
}

/* ---------------- lobby ---------------- */

function lobbyError(m) {
  $('lobbyErr').hidden = false;
  $('lobbyErr').textContent = m || 'Something went wrong.';
}

function showTable() { $('lobby').hidden = true; $('table').hidden = false; }
function showLobby() { $('table').hidden = true; $('lobby').hidden = false; }

function wire() {
  $('createBtn').onclick = function () {
    send({ t: 'create', name: $('hostName').value, seats: $('seatCount').value });
  };
  $('joinBtn').onclick = function () {
    var code = ($('joinCode').value || '').trim().toUpperCase();
    if (code.length !== 4) return lobbyError('A table code is four letters.');
    send({ t: 'join', code: code, name: $('joinName').value });
  };
  $('practiceBtn').onclick = function () { send({ t: 'practice' }); };
  $('vsBotBtn').onclick = function () {
    send({ t: 'vsbot', name: $('botName').value, bots: $('botCount').value });
  };
  $('scoresBtn').onclick = function () { $('scoreSheet').hidden = false; renderScores(); };
  $('closeScores').onclick = function () { $('scoreSheet').hidden = true; };
  $('rulesBtn').onclick = function () { $('rulesSheet').hidden = false; renderRules(); };
  $('closeRules').onclick = function () { $('rulesSheet').hidden = true; };
  $('closePeek').onclick = function () { $('peekSheet').hidden = true; };
  $('leaveBtn').onclick = function () {
    del('hf_code'); myCode = null; view = null; lastTurn = null;
    sel = []; pileSel = [];
    showLobby();
  };
  syncSortBtn();
  $('sortBtn').onclick = function () {
    sortMode = sortMode === 'rank' ? 'group' : 'rank';
    syncSortBtn();
    render();
  };
  handLayout = get('hf_layout') === 'layered' ? 'layered' : 'spread';
  syncLayoutBtn();
  $('layoutBtn').onclick = function () {
    handLayout = handLayout === 'spread' ? 'layered' : 'spread';
    set('hf_layout', handLayout);
    syncLayoutBtn();
    render();
  };
  $('clearSel').onclick = function () { sel = []; render(); };
  nudgeOn = get('hf_nudge') !== 'off';
  $('joinCode').oninput = function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z]/g, '');
  };
  $('copyLink').onclick = function () {
    var url = location.origin + '/?table=' + view.code;
    var done = function () {
      $('copyNote').textContent = 'Copied.';
      setTimeout(function () { $('copyNote').textContent = ''; }, 2500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () {
        $('copyNote').textContent = url;
      });
    } else {
      $('copyNote').textContent = url;
    }
  };
}

/* ---------------- selection helpers ---------------- */

/* Both buttons name what the hand is doing now, not what a click would do, and
 * the explanation rides in the tooltip — labels short enough that the hand's
 * controls stay on one line on a phone. */
function syncLayoutBtn() {
  var b = $('layoutBtn');
  if (!b) return;
  b.textContent = handLayout === 'spread' ? 'Spread' : 'Layered';
  b.title = handLayout === 'spread'
    ? 'Every card fully visible, wrapping as it needs to. Click to overlap them instead.'
    : 'Cards overlapped ' + PER_ROW + ' to a row, like a hand you are holding. Click to spread them out.';
}

function syncSortBtn() {
  var b = $('sortBtn');
  if (!b) return;
  b.textContent = sortMode === 'rank' ? 'By rank' : 'By count';
  b.title = sortMode === 'rank'
    ? 'Wilds first, then low to high. Click to bring your biggest groups to the front instead.'
    : 'Your biggest groups first, so near-books are together. Click to sort by rank instead.';
}

function meSeat() { return view && view.you ? view.you.seat : -1; }
function myHand() { return view && view.you ? view.you.hand : []; }

/* Cards that came into the hand this turn, in the order they arrived. The
 * server only sends these to the seat holding them. */
function justPicked() {
  if (!view || !view.you || !view.you.picked) return [];
  var hand = myHand();
  return view.you.picked.filter(function (c) { return hand.indexOf(c) !== -1; });
}
function myMelds() {
  var s = meSeat();
  return s >= 0 && view.seats[s] ? view.seats[s].melds : [];
}
function isMyTurn() { return view && view.phase === 'playing' && view.turn === meSeat(); }

function selRank() {
  var nat = sel.filter(function (c) { return !E.isWild(c); });
  if (!nat.length) return null;
  var r = E.rankOf(nat[0]);
  return nat.every(function (c) { return E.rankOf(c) === r; }) ? r : null;
}

function pileOffer() {
  if (!view.discardTop) return null;
  var top = view.discardTop;
  if (E.isWild(top) || E.isBlackThree(top) || E.isRedThree(top)) return null;
  var r = E.rankOf(top);
  var nat = sel.filter(function (c) { return !E.isWild(c) && E.rankOf(c) === r; });
  if (nat.length < view.settings.pileNaturalsRequired) return null;
  return { rank: r, take: Math.min(view.settings.pileTakeExtra + 1, view.discardCount) };
}

/* Whether the pile is takeable from this hand at all — as opposed to
 * pileOffer, which asks whether the cards to take it with are selected right
 * now. The difference is the whole play: without this you have to already know
 * the rule to notice the chance, and a phone has no hover to explain it. */
function pileChance() {
  if (!view.discardTop || !view.discardCount) return null;
  var top = view.discardTop;
  if (E.isWild(top) || E.isBlackThree(top) || E.isRedThree(top)) return null;
  var r = E.rankOf(top);
  var need = view.settings.pileNaturalsRequired;
  var nat = myHand().filter(function (c) { return !E.isWild(c) && E.rankOf(c) === r; });
  if (nat.length < need) return null;
  return { rank: r, need: need, take: Math.min(view.settings.pileTakeExtra + 1, view.discardCount) };
}

function meldStatsOf(m) {
  return E.meldStats(m, { bookSize: view.settings.bookSize });
}

/* Books in rank order rather than the order they happened to be laid, so a
 * table you glance at twice looks the same both times. Inside a book the
 * naturals come first and the wilds sit at the end, where they are easy to
 * count. Display only — the server's order is untouched and meld ids are what
 * actually identify a book. */
function rankIndex(r) {
  var i = E.RANKS.indexOf(r);
  return i === -1 ? 99 : i;
}
function orderMelds(melds) {
  return melds.slice().sort(function (a, b) {
    return rankIndex(a.rank) - rankIndex(b.rank) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
function orderCards(cards) {
  return cards.slice().sort(function (a, b) {
    return (E.isWild(a) ? 1 : 0) - (E.isWild(b) ? 1 : 0) ||
      E.cardValue(b) - E.cardValue(a) ||
      (a < b ? -1 : a > b ? 1 : 0);
  });
}

/* ---------------- noticing what everyone else played ----------------
 * A bot finishes its turn in under a second, so cards can appear on the table
 * and be old news before you have looked up. Every card added to anyone's book
 * is remembered for a few seconds and drawn glowing, so a glance at the top of
 * the screen tells you what just happened. */
var seenCards = null;          // every meld card already accounted for
var freshPlays = {};           // card -> when it appeared
var freshTimer = null;
var FRESH_MS = 4000;

function notePlays() {
  var now = Date.now();
  var current = {};
  view.seats.forEach(function (s) {
    s.melds.forEach(function (m) {
      m.cards.forEach(function (c) { current[c] = true; });
    });
  });
  // The first view of a table is not news — only changes after it are.
  if (seenCards) {
    Object.keys(current).forEach(function (c) {
      if (!seenCards[c]) freshPlays[c] = now;
    });
  }
  seenCards = current;

  var live = false;
  Object.keys(freshPlays).forEach(function (c) {
    if (now - freshPlays[c] > FRESH_MS || !current[c]) delete freshPlays[c];
    else live = true;
  });

  // Re-render once the glow has expired so it actually goes away.
  if (live && !freshTimer) {
    freshTimer = setTimeout(function () { freshTimer = null; render(); }, 700);
  }
}
function isFreshPlay(c) { return Object.prototype.hasOwnProperty.call(freshPlays, c); }

/* ---------------- rendering ---------------- */

/* A joker is worth 50 and a deuce 20, so they must never look alike on the
 * table. Each gets its own colour, here and on the little blocks that stand in
 * for an opponent's book. */
function wildClass(id) {
  if (E.isJoker(id)) return ' wild joker';
  if (E.rankOf(id) === '2') return ' wild deuce';
  // A red three is 100 against you and can never be melded, so it is banded in
  // rouge to stand out from every other card in the hand as something to shed.
  if (E.isRedThree(id)) return ' wild dead';
  return '';
}

function cardEl(id, opts) {
  opts = opts || {};
  var b = document.createElement(opts.click ? 'button' : 'div');
  b.className = 'card' + (E.isRed(id) ? ' red' : '') +
    ' su-' + E.suitOf(id).toLowerCase() + (opts.tiny ? ' tiny' : '') +
    (opts.selected ? ' sel' : '') + wildClass(id);
  var r = document.createElement('span'); r.className = 'r';
  var s = document.createElement('span'); s.className = 's';
  if (E.isJoker(id)) {
    r.textContent = 'JKR'; r.style.fontSize = opts.tiny ? '7px' : '9px';
    s.textContent = SUIT_GLYPH[E.suitOf(id)];
  } else {
    r.textContent = E.rankOf(id) === 'T' ? '10' : E.rankOf(id);
    s.textContent = SUIT_GLYPH[E.suitOf(id)];
  }
  b.appendChild(r); b.appendChild(s);
  if (opts.click) b.onclick = opts.click;
  if (opts.title) b.title = opts.title;
  return b;
}

function sortHand(cards) {
  var order = { X: 0, '2': 1 };
  var idx = function (c) {
    if (order[E.rankOf(c)] !== undefined) return order[E.rankOf(c)];
    return 2 + E.RANKS.indexOf(E.rankOf(c));
  };
  var out = cards.slice();
  if (sortMode === 'rank') {
    out.sort(function (a, b) { return idx(a) - idx(b) || E.suitOf(a).localeCompare(E.suitOf(b)); });
  } else {
    var count = {};
    cards.forEach(function (c) { var r = E.rankOf(c); count[r] = (count[r] || 0) + 1; });
    out.sort(function (a, b) {
      return (count[E.rankOf(b)] || 0) - (count[E.rankOf(a)] || 0) || idx(a) - idx(b);
    });
  }
  return out;
}

function render() {
  if (!view) return;
  $('tableCode').textContent = view.code || '—';
  $('roundLabel').textContent = (view.round + 1) + ' of ' + view.roundsTotal;
  $('minLabel').textContent = view.minMeld;

  var pill = $('turnPill');
  if (view.phase === 'lobby') {
    pill.textContent = view.seated + ' of ' + view.seats.length + ' seated';
    pill.className = 'pill';
  } else if (view.phase === 'playing') {
    var mine = isMyTurn();
    pill.textContent = mine ? 'Your turn' : view.seats[view.turn].name + '’s turn';
    // Pulses for as long as the turn is yours, so a glance at the top of the
    // screen answers the question without anything having to flash at you.
    pill.className = 'pill' + (mine ? ' you waiting-on-you' : '');
  } else {
    pill.textContent = view.phase === 'gameEnd' ? 'Game over' : 'Round over';
    pill.className = 'pill';
  }

  syncTitle();

  var share = $('shareBox');
  share.hidden = !(view.phase === 'lobby' && !view.solo);
  if (!share.hidden) $('shareCode').textContent = view.code;

  notePlays();
  renderSeats();
  renderCenter();
  renderMine();
  renderActions();
  renderLog();
  sizeBoard();
  // Sheets left open follow the table rather than freezing at the moment they
  // were opened — someone else turning the rule off should show there at once.
  if (!$('rulesSheet').hidden) renderRules();
  if (!$('peekSheet').hidden) {
    if (view.discardPeek && view.discardPeek.length) showPeek();
    else $('peekSheet').hidden = true;
  }
  if (!$('scoreSheet').hidden) renderScores();
  if (view.phase === 'roundEnd' || view.phase === 'gameEnd') {
    $('scoreSheet').hidden = false; renderScores();
  }
}

function chip(text, cls) {
  var s = document.createElement('span');
  s.className = 'chip' + (cls ? ' ' + cls : '');
  s.textContent = text;
  return s;
}

/* The little badges describing a seat's standing. Built in one place because
 * they appear twice: on every seat, and — since a phone hides your own seat to
 * save a row — beside your own books. */
function seatChips(s, mine) {
  var out = [];
  // No "Computer" badge: the seat is named "… (bot)" already, and a row that
  // says the same thing twice is a row of screen nobody gets back.
  if (!s.bot && s.seated && !s.connected && !view.solo) out.push(chip('Disconnected'));
  if (s.redBooks) out.push(chip(s.redBooks + ' red book' + (s.redBooks > 1 ? 's' : ''), 'red'));
  if (s.blackBooks) out.push(chip(s.blackBooks + ' black book' + (s.blackBooks > 1 ? 's' : ''), 'black'));
  if (s.inFoot) out.push(chip('In foot', 'foot'));
  if (view.phase === 'playing' && !s.hasInitialMeld) out.push(chip('No initial meld'));
  /* Only ever your own — the server sends nobody else's. Spelling out the
   * penalty stops it reading as something you are holding. */
  if (mine && s.redThrees) {
    var many = s.redThrees > 1;
    out.push(chip(s.redThrees + ' red three' + (many ? 's' : '') + ' · −100' + (many ? ' each' : ''), 'red'));
  }
  return out;
}

function renderSeats() {
  var wrap = $('seats'); wrap.innerHTML = '';
  view.seats.forEach(function (s, i) {
    var d = document.createElement('div');
    d.className = 'seat' + (view.phase === 'playing' && view.turn === i ? ' active' : '') +
      (i === meSeat() ? ' me' : '');

    var top = document.createElement('div'); top.className = 'seat-top';
    var nm = document.createElement('span'); nm.className = 'seat-name';
    nm.textContent = s.name + (i === meSeat() && !view.solo ? ' (you)' : '');
    var meta = document.createElement('span'); meta.className = 'seat-meta';
    // Short enough that a seat's badges still fit beside it on a phone.
    meta.textContent = view.phase === 'lobby'
      ? (s.seated ? 'seated' : 'empty')
      : s.handCount + ' hand · ' + (s.inFoot ? 'in foot' : s.footCount + ' foot');
    meta.title = s.handCount + ' cards in hand, ' +
      (s.inFoot ? 'already in their foot' : s.footCount + ' waiting in their foot');
    top.appendChild(nm); top.appendChild(meta);
    d.appendChild(top);

    var chips = document.createElement('div'); chips.className = 'chips';
    seatChips(s, i === meSeat()).forEach(function (c) { chips.appendChild(c); });
    if (chips.children.length) d.appendChild(chips);

    if (s.melds.length) {
      var ms = document.createElement('div'); ms.className = 'melds';
      var seatFresh = false;
      orderMelds(s.melds).forEach(function (m) {
        var st = meldStatsOf(m);
        var box = document.createElement('div');
        box.className = 'meld ' + (st.wilds === 0 ? 'clean' : 'dirty') +
          (st.complete ? ' done' : '');
        var head = document.createElement('div'); head.className = 'meld-top';
        head.textContent = E.rankName(m.rank) + 's · ' + m.cards.length;
        var mini = document.createElement('div'); mini.className = 'meld-mini';
        orderCards(m.cards).forEach(function (c) {
          var sp = document.createElement('span');
          sp.className = 'mini' + wildClass(c) + (isFreshPlay(c) ? ' just-played' : '');
          if (isFreshPlay(c)) seatFresh = true;
          sp.title = E.label(c) + ' · ' + E.cardValue(c) + ' points';
          mini.appendChild(sp);
        });
        box.appendChild(head); box.appendChild(mini);
        ms.appendChild(box);
      });
      if (seatFresh) d.classList.add('just-played-seat');
      d.appendChild(ms);
    }
    wrap.appendChild(d);
  });
}

function stackbox(tag, cardNode, count, opts) {
  opts = opts || {};
  var box = document.createElement(opts.click ? 'button' : 'div');
  box.className = 'stackbox' + (opts.click ? ' pick' : '') + (opts.on ? ' on' : '') +
    (opts.out ? ' out' : '');
  var t = document.createElement('div'); t.className = 'tag'; t.textContent = tag;
  var c = document.createElement('div'); c.className = 'pilecount'; c.textContent = count;
  box.appendChild(t); box.appendChild(cardNode); box.appendChild(c);
  if (opts.click) box.onclick = opts.click;
  return box;
}

function livePiles() {
  var out = [];
  (view.stocks || []).forEach(function (n, i) { if (n > 0) out.push(i); });
  return out;
}

function renderCenter() {
  var row = $('centerRow'); row.innerHTML = '';
  var live = livePiles();
  var choosing = isMyTurn() && view.turnPhase === 'draw' &&
    live.length >= view.settings.distinctDrawPiles;

  (view.stocks || []).forEach(function (n, i) {
    var back = document.createElement('div');
    back.className = n ? 'card back' : 'card empty';
    row.appendChild(stackbox('Pile ' + (i + 1), back, n ? n : 'empty', {
      on: pileSel.indexOf(i) !== -1,
      out: !n,
      click: choosing && n ? function () {
        var at = pileSel.indexOf(i);
        if (at !== -1) pileSel.splice(at, 1);
        else if (pileSel.length < view.settings.drawCount) pileSel.push(i);
        else pileSel = [pileSel[pileSel.length - 1], i];
        render();
      } : null,
    }));
  });

  var div = document.createElement('div'); div.className = 'divider';
  row.appendChild(div);

  var top;
  if (view.discardTop) top = cardEl(view.discardTop, {});
  else { top = document.createElement('div'); top.className = 'card empty'; }
  var frozen = view.discardTop &&
    (E.isWild(view.discardTop) || E.isBlackThree(view.discardTop) || E.isRedThree(view.discardTop));
  /* When the table plays the pile open, the top card is the way in to what a
   * take would bring — tap it and see the seven. Nothing here decides anything;
   * it only shows what the server already sent. */
  var peek = view.discardPeek && view.discardPeek.length;
  row.appendChild(stackbox('Discard', top,
    view.discardCount + ' card' + (view.discardCount === 1 ? '' : 's') + (frozen ? ' · frozen' : ''),
    peek ? { click: showPeek } : null));
}

function renderMine() {
  var wrap = $('myMelds'); wrap.innerHTML = '';
  var melds = myMelds();
  var canTarget = isMyTurn() && view.turnPhase === 'play' && sel.length > 0;

  /* Red threes laid off under the other rule \u2014 this table keeps them in hand,
   * so this is normally empty and nothing is drawn. */
  var threes = (view.you && view.you.redThrees) || [];
  if (threes.length) {
    var tb = document.createElement('div');
    tb.className = 'meld threes';
    var th = document.createElement('div'); th.className = 'meld-top';
    th.textContent = 'Red threes \u00b7 \u2212100 each';
    var tc = document.createElement('div'); tc.className = 'meld-cards';
    threes.forEach(function (c) {
      tc.appendChild(cardEl(c, { tiny: true, title: E.label(c) + ' \u00b7 counts \u2212100 against you' }));
    });
    tb.appendChild(th); tb.appendChild(tc);
    wrap.appendChild(tb);
  }

  if (!melds.length && !threes.length) {
    var empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = 'Nothing down yet.';
    wrap.appendChild(empty);
  }

  orderMelds(melds).forEach(function (m) {
    var st = meldStatsOf(m);
    /* A closed book still takes cards, so it stays a target — except a red one
     * when a wild is selected, which the referee refuses rather than quietly
     * turning 500 points into 300. */
    var spoilsRed = st.isRedBook && sel.some(function (c) { return E.isWild(c); });
    var open = canTarget && !spoilsRed;
    var box = document.createElement(open ? 'button' : 'div');
    /* Ringed red while it is still clean and black the moment a wild goes in,
     * whether or not it has reached seven. The colour is what the book is worth
     * if you finish it, which is the thing you are deciding about. */
    box.className = 'meld ' + (st.wilds === 0 ? 'clean' : 'dirty') +
      (st.complete ? ' done' : '') + (open ? ' target' : '');
    var head = document.createElement('div'); head.className = 'meld-top';
    // Seven is when a pile becomes a book, not a ceiling, so a closed one counts
    // up rather than showing a fraction it has already passed.
    head.textContent = E.rankName(m.rank) + 's · ' +
      (st.complete ? m.cards.length + (st.isRedBook ? ' · red book' : ' · black book')
                   : m.cards.length + '/' + view.settings.bookSize);
    if (spoilsRed) box.title = 'A wild would turn this red book black. Start another book of that rank.';
    var cards = document.createElement('div'); cards.className = 'meld-cards';
    /* Jokers and twos sort to the end of the book and sit at the back of the
     * squared-up pile: the cards overlap, and painting each one over the next
     * puts the naturals in front, so the wilds show as a sliver at the tail
     * rather than covering the real cards. Descending z-index rather than
     * reversing the order, because the order is the order of the book. */
    var ordered = orderCards(m.cards);
    ordered.forEach(function (c, i) {
      var el = cardEl(c, { tiny: true });
      if (isFreshPlay(c)) el.classList.add('just-played');
      el.style.zIndex = String(ordered.length - i);
      cards.appendChild(el);
    });
    box.appendChild(head); box.appendChild(cards);
    if (open) {
      box.onclick = function () { act('meldAdd', { meldId: m.id, cards: sel.slice() }); };
    }
    wrap.appendChild(box);
  });

  $('meldHint').textContent = canTarget
    ? 'Click a book to add ' + sel.length + ' card' + (sel.length > 1 ? 's' : '') + '.'
    : '';

  var mc = $('myChips'); mc.innerHTML = '';
  var meSeatObj = meSeat() >= 0 ? view.seats[meSeat()] : null;
  if (meSeatObj) seatChips(meSeatObj, true).forEach(function (c) { mc.appendChild(c); });

  renderHand();
  $('clearSel').hidden = sel.length === 0;
}

/* The hand, in whichever arrangement this player prefers.
 *
 * Cards picked up this turn are held back and shown last — their own row when
 * layered, set apart by a gap when spread — so you can always tell at a glance
 * what just arrived, whatever the sort is doing to everything else. */
function renderHand() {
  var wrap = $('myHand');
  wrap.innerHTML = '';
  wrap.className = 'hand' + (handLayout === 'layered' ? ' layered' : '');

  var fresh = justPicked();
  var settled = myHand().filter(function (c) { return fresh.indexOf(c) === -1; });

  var make = function (c, isFresh, firstFresh) {
    var el = cardEl(c, {
      click: function () {
        var i = sel.indexOf(c);
        if (i === -1) sel.push(c); else sel.splice(i, 1);
        render();
      },
      selected: sel.indexOf(c) !== -1,
      title: E.label(c) + ' · ' +
        (E.isRedThree(c) ? '−100 if you are still holding it — discard it' : E.cardValue(c) + ' points') +
        (isFresh ? ' · just picked up' : ''),
    });
    if (isFresh) el.classList.add('fresh');
    if (firstFresh) el.classList.add('fresh-first');
    return el;
  };

  if (handLayout === 'layered') {
    var row = null;
    sortHand(settled).forEach(function (c, i) {
      if (i % PER_ROW === 0) {
        row = document.createElement('div');
        row.className = 'hand-row';
        wrap.appendChild(row);
      }
      row.appendChild(make(c, false, false));
    });
    if (fresh.length) {
      var freshRow = document.createElement('div');
      freshRow.className = 'hand-row fresh-row';
      fresh.forEach(function (c) { freshRow.appendChild(make(c, true, false)); });
      wrap.appendChild(freshRow);
    }
  } else {
    sortHand(settled).forEach(function (c) { wrap.appendChild(make(c, false, false)); });
    fresh.forEach(function (c, i) { wrap.appendChild(make(c, true, i === 0)); });
  }

  /* The hand builds upwards from the bottom edge, so when it is deep enough to
   * scroll the rows worth seeing are the last ones — the cards nearest your
   * thumb, including whatever you just picked up. */
  wrap.scrollTop = wrap.scrollHeight;

  var n = myHand().length;
  $('handPill').textContent = n + ' card' + (n === 1 ? '' : 's') +
    (fresh.length ? ' · ' + fresh.length + ' new' : '') +
    (view.you && view.you.inFoot ? ' · in foot' : '');
  $('handPill').title = fresh.length
    ? 'The ' + fresh.length + ' card' + (fresh.length > 1 ? 's' : '') +
      ' you just picked up sit last, dotted in brass.'
    : '';
}

/* Your turn, said loudly and silently. A web page cannot make an iPhone
 * vibrate — Safari has no Vibration API at all — so on a phone this notice is
 * the whole alert, and it has to be impossible to miss without eating any of
 * the one screen the table has to fit on. Three parts: a banner that shows
 * itself and then gets out of the way, a pill that keeps pulsing for as long as
 * the turn is yours, and the tab title for when the page is behind something
 * else. navigator.vibrate is still called for anyone playing on Android. */
function announceTurn() {
  if (!nudgeOn) return;
  try { if (navigator.vibrate) navigator.vibrate([90, 70, 90]); } catch (e) {}
  showTurnBanner();
}

var bannerTimer = null;

function showTurnBanner() {
  var el = $('turnBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'turnBanner';
    el.className = 'turn-banner';
    el.onclick = hideTurnBanner;
    document.body.appendChild(el);
  }
  el.innerHTML = '<b>Your turn</b><span class="note">Round ' + (view.round + 1) +
    ' of ' + view.roundsTotal + ' · tap to dismiss</span>';
  el.classList.remove('gone');
  // Restart the animation if two turns come round in quick succession.
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideTurnBanner, 4500);
}

function hideTurnBanner() {
  var el = $('turnBanner');
  if (el) { el.classList.remove('show'); el.classList.add('gone'); }
  clearTimeout(bannerTimer);
}

/* The tab title, for a phone that has wandered off to another app or a laptop
 * with the game in a background tab. */
function syncTitle() {
  var mine = view && view.phase === 'playing' && isMyTurn();
  document.title = (mine ? '▶ Your turn · ' : '') + 'Hand & Foot';
}

function btn(label, fn, ghost) {
  var b = document.createElement('button');
  b.className = 'btn' + (ghost ? ' ghost' : '');
  b.textContent = label;
  b.onclick = fn;
  return b;
}

function esc(s) {
  return String(s).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  });
}

function renderActions() {
  var bar = $('actionBar'); bar.innerHTML = '';
  var hint = document.createElement('div');
  hint.className = 'hint' + (noticeBad ? ' warn' : '');

  if (view.phase === 'lobby') {
    hint.textContent = view.seated < 2
      ? 'Waiting for players — ' + view.seated + ' of ' + view.seats.length + ' seated.'
      : view.seated + ' of ' + view.seats.length + ' seated. Deal when everyone is in.';
    bar.appendChild(hint);
    var deal = btn('Deal the first round', function () { act('start'); });
    deal.disabled = view.seated < 2;
    bar.appendChild(deal);
    return;
  }

  if (view.phase === 'roundEnd') {
    hint.textContent = view.outSeat != null
      ? view.seats[view.outSeat].name + ' went out.'
      : 'The cards ran out — the round ends there.';
    bar.appendChild(hint);
    bar.appendChild(btn('Next round', function () {
      $('scoreSheet').hidden = true; act('nextRound');
    }));
    return;
  }

  if (view.phase === 'gameEnd') {
    hint.textContent = 'Four rounds played.';
    bar.appendChild(hint);
    bar.appendChild(btn('Play again', function () {
      $('scoreSheet').hidden = true; act('rematch');
    }));
    bar.appendChild(btn('Scores', function () {
      $('scoreSheet').hidden = false; renderScores();
    }, true));
    return;
  }

  if (!isMyTurn()) {
    var turnSeat = view.seats[view.turn];
    hint.textContent = notice || (turnSeat.bot
      ? turnSeat.name + ' is thinking\u2026'
      : 'Waiting on ' + turnSeat.name + '.');
    bar.appendChild(hint);
    return;
  }

  var S = view.settings;

  if (view.turnPhase === 'draw') {
    var live = livePiles();
    var spread = live.length >= S.distinctDrawPiles;
    var left = S.drawCount - pileSel.length;

    /* Kept short so the bar stays one line on a phone, with the rest of each
     * rule on the button it belongs to as a tooltip — except the pile, which is
     * a play you can miss entirely, so it is spelled out below. */
    var chance = pileChance();
    if (notice) hint.innerHTML = esc(notice);
    else if (!spread) {
      hint.innerHTML = 'Only pile <b>' + (live[0] + 1) + '</b> left — both cards come from it.';
    } else if (left > 0) {
      hint.innerHTML = pileSel.length
        ? 'Pick <b>1 more pile</b>.'
        : 'Pick <b>2 different piles</b>.';
    } else {
      hint.innerHTML = 'Drawing from piles <b>' +
        pileSel.map(function (i) { return i + 1; }).join('</b> and <b>') + '</b>.';
    }

    /* You are holding what the pile costs. Say so, and say what to tap — a
     * tooltip cannot reach anyone on a phone. */
    if (!notice && chance) {
      var offered = pileOffer();
      var cards = chance.take + ' card' + (chance.take === 1 ? '' : 's');
      hint.innerHTML += offered
        ? ' Or press <b>Take pile</b> for ' + cards + '.'
        : ' Or select <b>' + chance.need + ' ' + E.rankName(chance.rank) + 's</b>' +
          ' to take the pile — ' + cards + '.';
      /* Taking the pile before you are down is a part payment towards the
       * minimum, not the whole of it. Saying so here is the difference between
       * a play you make and a refusal you do not understand. */
      if (view.you && !view.you.hasInitialMeld) {
        hint.innerHTML += ' It counts towards your ' + view.minMeld +
          ' — lay the rest before you discard.';
      }
    }
    bar.appendChild(hint);

    var label = spread
      ? (left === 0 ? 'Draw from ' + pileSel.map(function (i) { return i + 1; }).join(' and ') : 'Draw 2')
      : 'Draw 2 from pile ' + (live[0] + 1);
    var d = btn(label, function () {
      act('draw', { piles: spread ? pileSel.slice() : [] });
    });
    d.disabled = spread && left !== 0;
    d.title = spread
      ? 'Your two cards must come from two different draw piles.'
      : 'One pile left, so the two-different-piles rule relaxes.';
    bar.appendChild(d);

    var offer = pileOffer();
    var take = btn('Take pile' +
      (offer ? ' · ' + offer.take + ' card' + (offer.take === 1 ? '' : 's') : ''), function () {
      act('pile', { cards: sel.slice() });
    }, true);
    take.disabled = !offer;
    take.title = offer
      ? 'Takes the top card plus the ' + view.settings.pileTakeExtra + ' behind it.'
      : 'Select ' + view.settings.pileNaturalsRequired +
        ' naturals matching the top discard, then take the pile.';
    bar.appendChild(take);
    return;
  }

  // play phase
  var msgs = [];
  if (view.you && !view.you.hasInitialMeld) {
    // The running total against the round's minimum, and nothing else — the
    // header already carries the number, and the rule is in the lobby notes.
    msgs.push('Down needs ' + view.minMeld + ' · laid ' +
      (view.turnState ? view.turnState.melded : 0) + '.');
  }
  if (view.you && view.you.inFoot) {
    msgs.push(view.you.canGoOut.ok
      ? 'You can go out — meld every card in your hand. No discard.'
      : 'To go out: ' + String(view.you.canGoOut.reason || '').toLowerCase());
  }
  hint.innerHTML = notice ? esc(notice) : esc(msgs.join(' '));
  bar.appendChild(hint);

  var r = selRank();
  var have = myMelds().some(function (m) { return m.rank === r; });
  if (r && sel.length >= 3 && !have) {
    var chk = E.checkMeld(r, sel, {
      bookSize: S.bookSize, maxWildsInBook: S.maxWildsInBook, allowWildBooks: false,
    });
    var mb = btn('Meld ' + sel.length + ' ' + E.rankName(r) + 's', function () {
      act('meldNew', { rank: r, cards: sel.slice() });
    });
    mb.disabled = !chk.ok;
    if (!chk.ok) mb.title = chk.reason;
    bar.appendChild(mb);
  }

  if (sel.length === 1) {
    bar.appendChild(btn('Discard ' + E.label(sel[0]), function () {
      act('discard', { card: sel[0] });
    }));
  }

  /* Undoing a pile take hands the whole pile back and returns you to the draw,
   * which is the only way out of taking it and then falling short of the
   * minimum. Say which one the button is about to do. */
  if (view.turnState && view.turnState.melded > 0) {
    bar.appendChild(btn(view.turnState.tookPile ? 'Put the pile back' : 'Take melds back',
      function () { act('undo'); }, true));
  }
}

function renderLog() {
  var names = view.seats.map(function (s) { return s.name; });
  var lines = (view.log || []).slice().reverse().map(function (e) {
    switch (e.t) {
      case 'round': return 'Round dealt · initial meld ' + e.min;
      case 'draw': return names[e.seat] + ' drew ' + e.n +
        (e.piles && e.piles.length === 2 && e.piles[0] !== e.piles[1]
          ? ' from piles ' + e.piles[0] + ' and ' + e.piles[1] : '');
      case 'pile': return names[e.seat] + ' took ' + e.n + ' from the pile on ' + E.rankName(e.rank) + 's';
      case 'meld': return names[e.seat] + ' laid ' + e.n + ' ' + E.rankName(e.rank) + (e.n > 1 ? 's' : '');
      case 'discard': return names[e.seat] + ' discarded ' + E.label(e.card);
      case 'foot': return names[e.seat] + ' picked up their foot';
      case 'stockout': return 'The draw piles ran out';
      case 'end': return e.seat != null ? names[e.seat] + ' went out' : 'Round over';
      case 'rule': return names[e.seat] + (e.value ? ' opened' : ' closed') + ' the discard pile';
      default: return '';
    }
  }).filter(Boolean);
  $('logBox').textContent = lines.join('  ·  ');
}

/* What a pile-take would bring in, top card first. Shown only because the
 * server sent it; if the table plays the pile closed, view.discardPeek is null
 * and the pile is not even clickable. */
function showPeek() {
  var cards = (view.discardPeek || []).slice().reverse();
  if (!cards.length) return;
  var body = $('peekBody'); body.innerHTML = '';

  $('peekTitle').textContent = 'You would take ' + cards.length + ' card' + (cards.length === 1 ? '' : 's');

  var lead = document.createElement('p');
  lead.className = 'note';
  lead.style.margin = '0 0 12px';
  var top = view.discardTop;
  var frozen = top && (E.isWild(top) || E.isBlackThree(top) || E.isRedThree(top));
  lead.textContent = frozen
    ? 'The pile is frozen — ' + E.label(top) + ' on top means nobody can take it. This is what is sitting under it.'
    : 'The top card and the ' + (cards.length - 1) + ' behind it. Taking the pile needs ' +
      view.settings.pileNaturalsRequired + ' naturals in hand matching ' + E.label(top) + '.';
  body.appendChild(lead);

  var row = document.createElement('div');
  row.className = 'peek-cards';
  cards.forEach(function (c, i) {
    var wrap = document.createElement('div');
    wrap.className = 'peek-card';
    wrap.appendChild(cardEl(c, { title: E.label(c) + ' · ' + E.cardValue(c) + ' points' }));
    var cap = document.createElement('div');
    cap.className = 'tag';
    cap.textContent = i === 0 ? 'top' : String(i);
    wrap.appendChild(cap);
    row.appendChild(wrap);
  });
  body.appendChild(row);

  var worth = cards.reduce(function (s, c) { return s + E.cardValue(c); }, 0);
  var sum = document.createElement('p');
  sum.className = 'note';
  sum.style.marginTop = '12px';
  sum.textContent = 'Worth ' + worth + ' points in hand. The pile is ' + view.discardCount + ' cards deep.';
  body.appendChild(sum);

  $('peekSheet').hidden = false;
}

/* The house rules, with the ones this table can actually change as switches.
 * Everything else is shown so nobody has to remember, and so a disagreement
 * mid-game has somewhere to be settled. */
/* A row of choices with a live sample beside them. The sample is built from
 * real card elements rather than a picture, so it is always exactly what the
 * table will look like — there is nothing to keep in step. */
function lookPicker(label, blurb, options, current, onPick, sample) {
  var wrap = document.createElement('div');
  wrap.className = 'look-row';

  var head = document.createElement('div');
  head.className = 'rule-title';
  head.textContent = label;
  wrap.appendChild(head);

  if (blurb) {
    var b = document.createElement('div');
    b.className = 'note';
    b.textContent = blurb;
    wrap.appendChild(b);
  }

  var opts = document.createElement('div');
  opts.className = 'look-opts';
  options.forEach(function (o) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'look-opt' + (o.id === current ? ' on' : '');
    btn.setAttribute('aria-pressed', o.id === current ? 'true' : 'false');
    if (sample) btn.appendChild(sample(o));
    var n = document.createElement('span');
    n.className = 'look-name';
    n.textContent = o.name;
    btn.appendChild(n);
    btn.onclick = function () { onPick(o.id); };
    opts.appendChild(btn);
  });
  wrap.appendChild(opts);

  var note = null;
  options.forEach(function (o) { if (o.id === current && o.note) note = o.note; });
  if (note) {
    var nd = document.createElement('div');
    nd.className = 'note look-note';
    nd.textContent = note;
    wrap.appendChild(nd);
  }
  return wrap;
}

/* Four cards that between them show everything the deck has to say: a red
 * suit, a black suit, the two other suits the four-colour deck splits out,
 * and a deuce, whose band changes on a solid face. */
var LOOK_SAMPLE = ['AH', 'KS', 'QD', '2C'];

function deckSample(styleId) {
  var box = document.createElement('span');
  box.className = 'deck-sample';
  // The sample must ignore whatever is currently applied to the page and show
  // the style being offered, so it carries its own data-cards.
  box.setAttribute('data-cards', styleId);
  LOOK_SAMPLE.forEach(function (c) {
    box.appendChild(cardEl(c, { tiny: true }));
  });
  return box;
}

function themeSample(t) {
  var s = document.createElement('span');
  s.className = 'theme-sample';
  s.style.background = 'radial-gradient(120% 90% at 50% 0%, ' +
    t.hi + ' 0%, ' + t.mid + ' 45%, ' + t.lo + ' 100%)';
  return s;
}

function renderLook(body) {
  var h = document.createElement('h3');
  h.className = 'rule-head';
  h.textContent = 'Just for you';
  body.appendChild(h);

  var intro = document.createElement('div');
  intro.className = 'note';
  intro.style.marginBottom = '12px';
  intro.textContent = 'Nobody else at the table sees these. They are kept in this ' +
    'browser, so they follow you from game to game but not onto another device.';
  body.appendChild(intro);

  body.appendChild(lookPicker(
    'Cards', null, CARD_STYLES, cardStyle,
    function (id) {
      cardStyle = id; set('hf_cards', id); applyLook(); renderRules(); render();
    },
    function (o) { return deckSample(o.id); }
  ));

  body.appendChild(lookPicker(
    'Table', null, THEMES, theme,
    function (id) {
      theme = id; set('hf_theme', id); applyLook(); renderRules();
    },
    themeSample
  ));

  /* Also yours alone, and for the same reason it does not go through setRule. */
  var nbox = document.createElement('div');
  nbox.className = 'rule-toggle';
  var nin = document.createElement('input');
  nin.type = 'checkbox'; nin.id = 'ruleNudge'; nin.checked = nudgeOn;
  nin.onchange = function () {
    nudgeOn = nin.checked;
    set('hf_nudge', nudgeOn ? 'on' : 'off');
    if (nudgeOn) announceTurn();
  };
  var nlab = document.createElement('label');
  nlab.setAttribute('for', 'ruleNudge');
  var nt = document.createElement('div');
  nt.className = 'rule-title';
  nt.textContent = 'Show a notice when it is my turn';
  var nd = document.createElement('div');
  nd.className = 'note';
  nd.textContent = 'A banner across the top for a few seconds, and the turn pill keeps ' +
    'pulsing until you play. No sound. On an Android phone it buzzes as well — an ' +
    'iPhone cannot be made to vibrate from a web page.';
  nlab.appendChild(nt); nlab.appendChild(nd);
  nbox.appendChild(nin); nbox.appendChild(nlab);
  body.appendChild(nbox);
}

function renderRules() {
  var body = $('rulesBody'); body.innerHTML = '';
  var S = view.settings;

  renderLook(body);

  var rh = document.createElement('h3');
  rh.className = 'rule-head';
  rh.textContent = 'Agreed at this table';
  body.appendChild(rh);

  var box = document.createElement('div');
  box.className = 'rule-toggle';
  var id = 'ruleReveal';
  var input = document.createElement('input');
  input.type = 'checkbox'; input.id = id; input.checked = !!S.revealPileTake;
  input.onchange = function () {
    act('setRule', { key: 'revealPileTake', value: input.checked });
  };
  var lab = document.createElement('label');
  lab.setAttribute('for', id);
  var t = document.createElement('div');
  t.className = 'rule-title';
  t.textContent = 'Show what you would take from the discard pile';
  var d = document.createElement('div');
  d.className = 'note';
  d.textContent = 'On, the top card can be tapped to see all ' + (S.pileTakeExtra + 1) +
    ' cards a take would bring in. Off, only the top card shows and taking the pile is a gamble, ' +
    'the way a squared-up pile plays at a real table. This applies to everyone at the table.';
  lab.appendChild(t); lab.appendChild(d);
  box.appendChild(input); box.appendChild(lab);
  body.appendChild(box);

  var h = document.createElement('h3');
  h.className = 'rule-head';
  h.textContent = 'Fixed for this table';
  body.appendChild(h);

  var rows = [
    ['Decks', 'players + 2'],
    ['Deal', S.handSize + ' to the hand, ' + S.footSize + ' to the foot'],
    ['Draw piles', S.stockPiles + ', and a two-card draw takes one from each of ' +
      S.distinctDrawPiles + ' different piles'],
    ['Taking the pile', S.pileNaturalsRequired + ' naturals matching the top card; you get it plus the ' +
      S.pileTakeExtra + ' behind it. Before you are down it counts towards the minimum ' +
      'rather than having to cover it — put the pile back if you cannot get there'],
    ['Going down', S.minMelds.join(' / ') + ' across the four rounds, totalled over every meld that turn'],
    ['Book', S.bookSize + ' cards closes a book · red ' + S.redBookBonus + ' · black ' + S.blackBookBonus +
      '. A closed book keeps taking cards, and once it is closed you may start another of the same rank'],
    ['Wilds', 'at most ' + S.maxWildsInBook + ' per book, and every meld needs ' +
      S.minNaturalsInMeld + ' naturals'],
    ['Threes', 'never meld. A black three on top freezes the pile'],
    ['Red threes', S.redThreeAutoLayOff
      ? 'lay off the moment they arrive, ' + S.redThreeValue + ' each'
      : 'dead cards you discard like any other. ' + S.redThreeValue +
        ' only if you are still holding one when the round ends'],
    ['Going out', 'in your foot, ' + S.requireRedBook + ' red book + ' + S.requireBlackBook +
      ' black book, then play every card left in your hand into melds — no discard. +' + S.goOutBonus],
  ];
  var tbl = document.createElement('table');
  var tb = document.createElement('tbody');
  rows.forEach(function (r) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(r[0]) + '</td><td style="text-align:left">' + esc(r[1]) + '</td>';
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  body.appendChild(tbl);

  var note = document.createElement('p');
  note.className = 'note';
  note.style.marginTop = '10px';
  note.textContent = 'These live in engine.js. Ask and they change — the server, the interface and the tests all follow the same numbers.';
  body.appendChild(note);
}

function renderScores() {
  var body = $('scoreBody'); body.innerHTML = '';
  var totals = view.seats.map(function (_, i) {
    return view.scores.reduce(function (s, r) { return s + (r[i] || 0); }, 0);
  });
  var best = totals.length ? Math.max.apply(null, totals) : 0;

  $('scoreTitle').textContent = view.phase === 'gameEnd' ? 'Final scores'
    : view.phase === 'roundEnd' ? 'Round ' + (view.round + 1) + ' scored' : 'Scores';

  if (view.roundDetail) {
    var h = document.createElement('h3');
    h.style.cssText = 'font-size:14px;margin-bottom:8px';
    h.textContent = 'This round';
    body.appendChild(h);
    var t1 = document.createElement('table');
    t1.innerHTML = '<thead><tr><th>Player</th><th>Black books</th><th>Red books</th>' +
      '<th>Table count</th><th>Out</th><th>Round</th></tr></thead>';
    var tb = document.createElement('tbody');
    /* The columns the table keeps by hand. A books cell carries how many as well
     * as what they were worth, because "600" on its own makes you do the division
     * yourself. Table count is melded minus what you were caught holding, so it
     * goes negative often enough to need its sign spelled out. */
    var bookCell = function (n, pts) {
      return n ? '<td>' + pts + '<span class="sub"> ×' + n + '</span></td>' : '<td>—</td>';
    };
    var signed = function (n) { return n < 0 ? '−' + Math.abs(n) : String(n); };
    view.roundDetail.forEach(function (r, i) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(view.seats[i].name) + '</td>' +
        bookCell(r.blackBooks, r.blackPts) + bookCell(r.redBooks, r.redPts) +
        '<td>' + signed(r.tableCount) + '</td>' +
        '<td>' + (r.out || '—') + '</td>' +
        '<td class="total">' + signed(r.total) + '</td>';
      tb.appendChild(tr);
    });
    t1.appendChild(tb);
    var sc = document.createElement('div'); sc.className = 'scroll'; sc.appendChild(t1);
    body.appendChild(sc);
  }

  var h2 = document.createElement('h3');
  h2.style.cssText = 'font-size:14px;margin:18px 0 8px';
  h2.textContent = 'Running total';
  body.appendChild(h2);

  var t = document.createElement('table');
  var head = '<thead><tr><th>Player</th>';
  for (var i = 0; i < view.scores.length; i++) head += '<th>R' + (i + 1) + '</th>';
  head += '<th>Total</th></tr></thead>';
  t.innerHTML = head;
  var tbody = document.createElement('tbody');
  view.seats.forEach(function (s, idx) {
    var tr = document.createElement('tr');
    if (view.scores.length && totals[idx] === best) tr.className = 'lead';
    var row = '<td>' + esc(s.name) + '</td>';
    view.scores.forEach(function (r) { row += '<td>' + (r[idx] || 0) + '</td>'; });
    row += '<td class="total">' + totals[idx] + '</td>';
    tr.innerHTML = row;
    tbody.appendChild(tr);
  });
  t.appendChild(tbody);
  var sc2 = document.createElement('div'); sc2.className = 'scroll'; sc2.appendChild(t);
  body.appendChild(sc2);

  if (!view.scores.length) {
    var p = document.createElement('p');
    p.className = 'note'; p.style.marginTop = '10px';
    p.textContent = 'No rounds scored yet.';
    body.appendChild(p);
  }
}

/* ---------------- room for the action bar ----------------
 * The bar is fixed to the bottom, so the board has to reserve exactly its
 * height or the last row of cards hides behind it. The height changes with the
 * hint text and the number of buttons, and on a phone a guessed constant is
 * either dead space or a clipped card — so measure it. */
function sizeBoard() {
  var bar = document.querySelector('.actions');
  var board = document.querySelector('.board');
  if (!bar || !board) return;
  board.style.paddingBottom = (bar.offsetHeight + 8) + 'px';
  // How far down the turn banner has to start to clear the top bar, which is a
  // different height on a phone than on a laptop.
  var top = document.querySelector('.bar');
  if (top) document.documentElement.style.setProperty('--bar-h', top.offsetHeight + 'px');
}
if (window.ResizeObserver) {
  var ro = new ResizeObserver(sizeBoard);
  ro.observe(document.querySelector('.actions'));
  ro.observe(document.querySelector('.bar'));
} else {
  window.addEventListener('resize', sizeBoard);
}

/* ---------------- the Home Screen ----------------
 * Added to the Home Screen the game runs standalone: no address bar, no
 * toolbar, roughly a hundred more pixels of table on a phone. iOS gives a page
 * no way to trigger that itself, so all we can do is say where the button is —
 * and only to the people it applies to. */

function isStandalone() {
  return (window.navigator.standalone === true) ||
    !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function isIOS() {
  var ua = navigator.userAgent || '';
  // iPadOS reports itself as a Mac, so a touch-capable "Mac" is really an iPad.
  return /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

(function installTip() {
  var tip = document.getElementById('installTip');
  var close = document.getElementById('installDismiss');
  if (!tip || !close) return;
  var dismissed = false;
  try { dismissed = localStorage.getItem('hf-install-tip') === 'off'; } catch (e) {}
  if (!dismissed && isIOS() && !isStandalone()) tip.hidden = false;
  close.addEventListener('click', function () {
    tip.hidden = true;
    try { localStorage.setItem('hf-install-tip', 'off'); } catch (e) {}
  });
})();

/* ---------------- keeping the server awake ----------------
 * Free hosting puts the server to sleep after ~15 quiet minutes. A hand can
 * easily sit still that long while someone studies their cards, so every open
 * page pokes the server every four minutes. This runs only while somebody has
 * the game open, so the server still sleeps between game nights. */
setInterval(function () {
  if (ws && ws.readyState === 1) send({ t: 'ping' });
  try { fetch('health', { cache: 'no-store' }).catch(function () {}); }
  catch (e) { /* offline; the reconnect logic handles it */ }
}, 4 * 60 * 1000);

/* ---------------- start ---------------- */

token = sessionToken();
myCode = get('hf_code');
var fromLink = (location.search.match(/[?&]table=([A-Za-z]{4})/) || [])[1];
if (fromLink) {
  myCode = null;                       // an invite link means joining, not resuming
  $('joinCode').value = fromLink.toUpperCase();
}
wire();
connect();
