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

var $ = function (id) { return document.getElementById(id); };
var SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣', R: '★', B: '★' };

/* ---------------- storage (never load-bearing) ---------------- */

function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } }
function del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

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
      if (view.turn !== lastTurn) { sel = []; pileSel = []; lastTurn = view.turn; }
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

function meldStatsOf(m) {
  return E.meldStats(m, { bookSize: view.settings.bookSize });
}

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
  b.className = 'card' + (E.isRed(id) ? ' red' : '') + (opts.tiny ? ' tiny' : '') +
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
    pill.className = 'pill' + (mine ? ' you' : '');
  } else {
    pill.textContent = view.phase === 'gameEnd' ? 'Game over' : 'Round over';
    pill.className = 'pill';
  }

  var share = $('shareBox');
  share.hidden = !(view.phase === 'lobby' && !view.solo);
  if (!share.hidden) $('shareCode').textContent = view.code;

  renderSeats();
  renderCenter();
  renderMine();
  renderActions();
  renderLog();
  sizeBoard();
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
    meta.textContent = view.phase === 'lobby'
      ? (s.seated ? 'seated' : 'empty')
      : s.handCount + ' in hand · ' + (s.inFoot ? 'in foot' : s.footCount + ' in foot');
    top.appendChild(nm); top.appendChild(meta);
    d.appendChild(top);

    var chips = document.createElement('div'); chips.className = 'chips';
    seatChips(s, i === meSeat()).forEach(function (c) { chips.appendChild(c); });
    if (chips.children.length) d.appendChild(chips);

    if (s.melds.length) {
      var ms = document.createElement('div'); ms.className = 'melds';
      s.melds.forEach(function (m) {
        var st = meldStatsOf(m);
        var box = document.createElement('div');
        box.className = 'meld' + (st.isRedBook ? ' done-red' : st.complete ? ' done-black' : '');
        var head = document.createElement('div'); head.className = 'meld-top';
        head.textContent = E.rankName(m.rank) + 's · ' + m.cards.length;
        var mini = document.createElement('div'); mini.className = 'meld-mini';
        m.cards.forEach(function (c) {
          var sp = document.createElement('span');
          sp.className = 'mini' + wildClass(c);
          sp.title = E.label(c) + ' · ' + E.cardValue(c) + ' points';
          mini.appendChild(sp);
        });
        box.appendChild(head); box.appendChild(mini);
        ms.appendChild(box);
      });
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
  var frozen = view.discardTop && (E.isWild(view.discardTop) || E.isBlackThree(view.discardTop));
  row.appendChild(stackbox('Discard', top,
    view.discardCount + ' card' + (view.discardCount === 1 ? '' : 's') + (frozen ? ' · frozen' : '')));
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

  melds.forEach(function (m) {
    var st = meldStatsOf(m);
    var open = canTarget && !st.complete;
    var box = document.createElement(open ? 'button' : 'div');
    box.className = 'meld' + (st.isRedBook ? ' done-red' : st.complete ? ' done-black' : '') +
      (open ? ' target' : '');
    var head = document.createElement('div'); head.className = 'meld-top';
    head.textContent = E.rankName(m.rank) + 's · ' + m.cards.length + '/' + view.settings.bookSize +
      (st.isRedBook ? ' · red book' : st.complete ? ' · black book' : '');
    var cards = document.createElement('div'); cards.className = 'meld-cards';
    m.cards.forEach(function (c) { cards.appendChild(cardEl(c, { tiny: true })); });
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

  var n = myHand().length;
  $('handPill').textContent = n + ' card' + (n === 1 ? '' : 's') +
    (fresh.length ? ' · ' + fresh.length + ' new' : '') +
    (view.you && view.you.inFoot ? ' · in foot' : '');
  $('handPill').title = fresh.length
    ? 'The ' + fresh.length + ' card' + (fresh.length > 1 ? 's' : '') +
      ' you just picked up sit last, dotted in brass.'
    : '';
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

    /* Kept to a few words so the bar stays one line on a phone. The rule behind
     * each one lives on the button it belongs to, as a tooltip. */
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
    var take = btn('Take pile' + (offer ? ' · ' + offer.take + ' cards' : ''), function () {
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
      ? 'You can go out — discard your last card.'
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

  if (view.turnState && view.turnState.melded > 0 && !view.turnState.tookPile) {
    bar.appendChild(btn('Take melds back', function () { act('undo'); }, true));
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
      default: return '';
    }
  }).filter(Boolean);
  $('logBox').textContent = lines.join('  ·  ');
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
    t1.innerHTML = '<thead><tr><th>Player</th><th>Books</th><th>Melded</th><th>Red 3s</th>' +
      '<th>Out</th><th>In hand</th><th>Round</th></tr></thead>';
    var tb = document.createElement('tbody');
    view.roundDetail.forEach(function (r, i) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(view.seats[i].name) + '</td><td>' + r.books + '</td><td>' +
        r.meldPts + '</td><td>' + r.threes + '</td><td>' + r.out + '</td><td>−' + r.left +
        '</td><td class="total">' + r.total + '</td>';
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
}
if (window.ResizeObserver) {
  var ro = new ResizeObserver(sizeBoard);
  ro.observe(document.querySelector('.actions'));
} else {
  window.addEventListener('resize', sizeBoard);
}

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
