/* Client. The server owns the game; this renders the view it sends and
 * forwards actions. It never holds another player's cards, because it is
 * never sent them. */

var ws = null, view = null, token = null;
var myCode = null, retry = 0, retryTimer = null, closedByUs = false;
var sel = [];          // selected card ids, in click order
var actionPending = false;
var actionSentAt = 0;
var actionUnlockTimer = null;
var meldTargetId = null;
var lastMeldTap = null;
var selectMatchingOn = false; // a session-only selection aid; never plays cards
var pileSel = [];      // chosen draw piles, in click order
var sortMode = 'rank';
var handLayout = 'spread';   // 'spread' = side by side, 'layered' = overlapped rows
var opponentMeldStyle = 'cards'; // shared personal display for every player's public melds
var finishedBookStyle = 'stacked';
var meldExpanded = Object.create(null), meldDisplayContext = null;
var PER_ROW = 6;             // cards per row when layered
var notice = '', noticeBad = false;
var lastTurn = null;
var nudgeOn = true;      // announce the turn coming round to you
var handSignature = null, handStructureSignature = null, mineSignature = null, expandedSeat = null;
var connectionLastSeen = 0;
var chatMessages = [], chatUnread = 0, chatRoom = null, chatPending = null;
var rulesMode = 'rules', rulesReturnFocus = null;
var rulesConfigRequest = null, rulesConfigTimer = null;
var rulesConfigFeedback = '', rulesConfigFeedbackBad = false, rulesConfigFeedbackCode = null;
var rulesFeedbackQueue = null, rulesDraft = null, rulesEditorBase = null, rulesEditorCode = null, rulesEditorPresetBase = null;
var scoreAutoShownKey = null;
var sortPopoverContext = null, sortDismissPointers = {};
var autoDrawMode = 'off', autoDrawPiles = [0, 1];
var autoDrawDraftMode = 'off', autoDrawDraftPiles = [0, 1];
var autoDrawTimer = null, autoDrawStateFresh = false, autoDrawStatus = '';
var autoDrawObservedBase = null, autoDrawObservedDiscard = null, autoDrawTurnSerial = 0;
var autoDrawTurnContext = null, autoDrawAttemptedContext = null;
var autoDrawPopoverContext = null, autoDismissPointers = {};

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
/* Swatches show the page, panel and felt colors used by each finish. */
var THEMES = [
  {
    "id": "room",
    "name": "Card room",
    "hi": "#1a352a",
    "mid": "#284d3c",
    "lo": "#10251e"
  },
  {
    "id": "midnight",
    "name": "Midnight",
    "hi": "#1e3045",
    "mid": "#2a415b",
    "lo": "#121e2c"
  },
  {
    "id": "claret",
    "name": "Claret",
    "hi": "#3c2935",
    "mid": "#503442",
    "lo": "#291d25"
  },
  {
    "id": "graphite",
    "name": "Graphite",
    "hi": "#303539",
    "mid": "#3c454b",
    "lo": "#232629"
  },
  {
    "id": "mahogany",
    "name": "Mahogany",
    "hi": "#3e3127",
    "mid": "#52402e",
    "lo": "#2a231d"
  },
  {
    "id": "ivory",
    "name": "Ivory",
    "hi": "#fffdf7",
    "mid": "#dde6d8",
    "lo": "#f3f1e9"
  }
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
  theme = t && has(THEMES, t) ? t : 'room';
  opponentMeldStyle = (get('hf_meld_style') || get('hf_opponent_melds')) === 'tiles' ? 'tiles' : 'cards';
  finishedBookStyle = get('hf_finished_books') === 'spread' ? 'spread' : 'stacked';
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
  resetCardMotion();
  autoDrawStateFresh = false;
  cancelAutoDraw();
  var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  try { ws = new WebSocket(proto + location.host); }
  catch (e) { return scheduleRetry(); }

  ws.onopen = function () {
    retry = 0; connectionLastSeen = Date.now();
    $('connBar').hidden = true;
    if (myCode) send({ t: 'resume', code: myCode });
  };

  ws.onmessage = function (ev) {
    connectionLastSeen = Date.now();
    var msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }

    if (msg.t === 'left') {
      if (view) $('leaveBtn').onclick();
      return;
    }
    if (msg.t === 'state') {
      var first = !view;
      var motion = prepareCardMotion(msg.view);
      view = msg.view;
      acknowledgeRulesConfig();
      autoDrawStateFresh = true;
      acknowledgeAction();
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
      playCardMotion(motion);
      return;
    }
    if (msg.t === 'chatHistory') {
      chatMessages = (msg.messages || []).slice(-100); chatUnread = 0;
      renderChat(true); return;
    }
    if (msg.t === 'chat' && msg.message) {
      if (chatPending !== null && msg.message.seat === meSeat() && msg.message.text === chatPending) {
        if ($('chatInput') && $('chatInput').value.trim() === chatPending) $('chatInput').value = '';
        chatPending = null;
        if ($('chatSend')) $('chatSend').disabled = false;
        if ($('chatStatus')) $('chatStatus').textContent = '';
      }
      if (!chatMessages.some(function (m) { return m.id === msg.message.id; })) {
        chatMessages.push(msg.message);
        if (chatMessages.length > 100) chatMessages.shift();
        if ($('chatSheet') && $('chatSheet').hidden) chatUnread++;
      }
      renderChat(false); return;
    }
    if (msg.t === 'joined') {
      if (chatRoom !== msg.code) {
        chatRoom = msg.code; chatMessages = []; chatUnread = 0; chatPending = null;
        if ($('chatInput')) $('chatInput').value = '';
        if ($('chatSend')) $('chatSend').disabled = false;
        if ($('chatStatus')) $('chatStatus').textContent = '';
        renderChat(true);
      }
      myCode = msg.code;
      set('hf_code', myCode);
      $('lobbyErr').hidden = true;
      return;
    }
    if (msg.t === 'error') {
      if (msg.context === 'chat') {
        chatPending = null;
        if ($('chatSend')) $('chatSend').disabled = false;
        if ($('chatStatus')) $('chatStatus').textContent = msg.message;
        return;
      }
      if (rulesConfigRequest) finishRulesConfig(false, msg.message);
      stopAutoDrawForTurn();
      acknowledgeAction();
      if (view) say(msg.message, true);
      else lobbyError(msg.message);
      return;
    }
  };

  ws.onclose = function () {
    resetCardMotion();
    if (closedByUs) return;
    autoDrawStateFresh = false; cancelAutoDraw();
    if (rulesConfigRequest) finishRulesConfig(false, 'Connection lost. Your edits are still here; reconnect before saving.');
    clearTimeout(actionUnlockTimer); actionPending = false;
    $('connBar').hidden = false;
    $('connBar').textContent = 'Reconnecting…';
    if (chatPending !== null) {
      chatPending = null;
      if ($('chatSend')) $('chatSend').disabled = false;
      if ($('chatStatus')) $('chatStatus').textContent = 'Connection lost. Your draft is still here.';
    }
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

function syncActionPending() {
  if (!actionPending) return;
  ['actionBar', 'myMelds', 'peekBody'].forEach(function (id) {
    var area = $(id);
    if (area) area.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
  });
}

function acknowledgeAction() {
  if (!actionPending) return;
  clearTimeout(actionUnlockTimer);
  // A fast local response must not let a second tap hit the next action.
  var remaining = Math.max(0, 350 - (Date.now() - actionSentAt));
  actionUnlockTimer = setTimeout(function () {
    actionPending = false; actionUnlockTimer = null;
    if (view) {
      renderCenter(); renderMine(); renderActions();
      if (!$('peekSheet').hidden) showPeek();
      scheduleBoardSize();
      maybeAutoDraw();
    }
  }, remaining);
}

function act(action, extra) {
  if (actionPending) return false;
  lastMeldTap = null;
  var msg = { t: 'action', action: action, turnId: view && view.turnId };
  if (extra) for (var k in extra) msg[k] = extra[k];
  actionPending = true; actionSentAt = Date.now();
  if (!send(msg)) { actionPending = false; return false; }
  notice = ''; noticeBad = false;
  syncActionPending();
  return true;
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
  $('scoresBtn').onclick = function () { closeSortPopover(false); closeAutoDrawPopover(false, false); $('scoreSheet').hidden = false; renderScores(); };
  $('closeScores').onclick = dismissScores;
  $('rulesBtn').onclick = function () { openRules('settings'); };
  $('closeRules').onclick = function () {
    $('rulesSheet').hidden = true;
    if (rulesReturnFocus && rulesReturnFocus.isConnected) rulesReturnFocus.focus({ preventScroll: true });
  };
  $('closePeek').onclick = function () { $('peekSheet').hidden = true; };
  $('leaveBtn').onclick = function () {
    resetCardMotion();
    // WebSocket ordering delivers departure before its close frame.
    if (view) send({ t: 'leave' });
    closeSortPopover(false);
    closeAutoDrawPopover(false, false); cancelAutoDraw(); autoDrawStateFresh = false;
    autoDrawObservedBase = null; autoDrawObservedDiscard = null;
    autoDrawTurnContext = null; autoDrawAttemptedContext = null;
    del('hf_code'); myCode = null; view = null; lastTurn = null;
    clearTimeout(rulesConfigTimer); rulesConfigTimer = null; rulesConfigRequest = null;
    sel = []; pileSel = []; notice = ''; noticeBad = false;
    clearTimeout(actionUnlockTimer); actionPending = false; meldTargetId = null; lastMeldTap = null;
    handSignature = null; handStructureSignature = null; mineSignature = null; expandedSeat = null;
    rulesDraft = null; rulesEditorBase = null; rulesEditorCode = null; rulesFeedbackQueue = null;
    chatMessages = []; chatUnread = 0; chatRoom = null; chatPending = null;
    document.querySelectorAll('.sheet').forEach(function (sheet) { sheet.hidden = true; });
    if ($('chatInput')) $('chatInput').value = '';
    if ($('chatSend')) $('chatSend').disabled = false;
    if ($('chatStatus')) $('chatStatus').textContent = '';
    closeOpponentDetail(); hideTurnBanner();
    clearTimeout(freshTimer); freshTimer = null;
    seenCards = null; freshPlays = {}; lastRound = null;
    renderChat(true);
    showLobby();
    syncTitle();
    if (window.HFMenu && window.HFMenu.showHome) window.HFMenu.showHome();
    var focus = $('lobby').querySelector('button:not([hidden]), summary');
    if (focus) focus.focus({ preventScroll: true });
    clearTimeout(retryTimer); retryTimer = null; retry = 0;
    if (ws) {
      ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.onopen = null;
      ws.close(); ws = null;
    }
    connect();
  };
  sortMode = get('hf_sort') === 'group' ? 'group' : 'rank';
  syncSortBtn();
  $('sortBtn').onclick = toggleSortPopover;
  $('closeSortPopover').onclick = function () { closeSortPopover(true); };
  $('sortRank').onclick = function () { applyHandArrangement('sort', 'rank'); };
  $('sortCount').onclick = function () { applyHandArrangement('sort', 'group'); };
  $('sortSpread').onclick = function () { applyHandArrangement('layout', 'spread'); };
  $('sortLayered').onclick = function () { applyHandArrangement('layout', 'layered'); };
  document.addEventListener('pointerdown', handleSortOutsidePointer, true);
  document.addEventListener('click', handleSortOutsideClick, true);
  document.addEventListener('pointercancel', cancelDismissPointer, true);
  document.addEventListener('keydown', handleSortPopoverKey, true);
  document.addEventListener('pointerdown', function (event) {
    if (!event.target.closest('#myMelds .meld.target')) lastMeldTap = null;
  }, true);
  handLayout = get('hf_layout') === 'layered' ? 'layered' : 'spread';
  syncLayoutBtn();
  $('layoutBtn').onclick = function () {
    handLayout = handLayout === 'spread' ? 'layered' : 'spread';
    set('hf_layout', handLayout);
    syncLayoutBtn();
    render();
  };
  syncSelectMatching();
  $('selectMatching').onclick = toggleMatchingSelection;
  $('clearSel').onclick = function () { sel = []; notice = ''; noticeBad = false; render(); };
  wireChat();
  wireAutoDraw();
  document.addEventListener('click', function (ev) {
    if (expandedSeat !== null && !ev.target.closest('#opponentDetail, .seat-expand')) {
      ev.preventDefault(); ev.stopImmediatePropagation(); closeOpponentDetail();
    }
  }, true);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && expandedSeat !== null) closeOpponentDetail(true);
  });
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

/* Chat is independent of game renders: incoming table states never replace
 * the focused composer, and a new message never moves somebody who is reading
 * older messages back to the bottom. */
function wireChat() {
  if (!$('chatBtn') || !$('chatSheet')) return;
  $('chatBtn').onclick = function () {
    closeSortPopover(false);
    closeAutoDrawPopover(false, false);
    $('chatSheet').hidden = false; chatUnread = 0; renderChat(true);
    $('chatInput').focus({ preventScroll: true });
  };
  $('closeChat').onclick = function () {
    $('chatSheet').hidden = true;
    $('chatBtn').focus({ preventScroll: true });
  };
  $('chatForm').onsubmit = function (ev) {
    ev.preventDefault();
    if (chatPending !== null) return;
    var text = $('chatInput').value.trim();
    if (!text) { $('chatStatus').textContent = 'Write a message first.'; return; }
    if (text.length > 500) { $('chatStatus').textContent = 'Keep messages to 500 characters.'; return; }
    if (send({ t: 'chat', text: text })) {
      chatPending = text;
      $('chatSend').disabled = true;
      $('chatStatus').textContent = 'Sending…';
    } else {
      $('chatStatus').textContent = 'Reconnecting. Your draft is saved here.';
    }
  };
}

function renderChat(forceBottom) {
  var list = $('chatMessages');
  if (!list) return;
  var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  var previousTop = list.scrollTop;
  var keep = Object.create(null), existing = Object.create(null);
  chatMessages.forEach(function (message) { keep[String(message.id)] = true; });
  Array.prototype.slice.call(list.children).forEach(function (row) {
    var id = row.dataset.messageId;
    if (id !== undefined && keep[id]) existing[id] = row;
    else list.removeChild(row);
  });
  if (!chatMessages.length) {
    var empty = document.createElement('p'); empty.className = 'chat-empty';
    empty.textContent = 'The table is quiet. Say hello.';
    list.appendChild(empty);
  }
  chatMessages.forEach(function (message) {
    // Keep earlier log entries mounted so assistive technology announces only
    // the new message and somebody reading the history keeps their place.
    if (existing[String(message.id)]) return;
    var row = document.createElement('div');
    row.dataset.messageId = String(message.id);
    row.className = 'chat-message' + (message.seat === meSeat() ? ' mine' : '');
    var meta = document.createElement('div'); meta.className = 'chat-meta';
    var name = document.createElement('span'); name.className = 'chat-name';
    name.textContent = message.name;
    meta.appendChild(name);
    var when = new Date(message.at);
    if (!isNaN(when.getTime())) {
      var time = document.createElement('time'); time.dateTime = when.toISOString();
      time.textContent = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      meta.appendChild(time);
    }
    var text = document.createElement('p'); text.className = 'chat-text';
    text.textContent = message.text;
    row.appendChild(meta); row.appendChild(text); list.appendChild(row);
  });
  if (forceBottom || nearBottom) list.scrollTop = list.scrollHeight;
  else list.scrollTop = previousTop;
  if ($('chatUnread')) {
    $('chatUnread').hidden = chatUnread === 0;
    $('chatUnread').textContent = chatUnread > 99 ? '99+' : String(chatUnread);
  }
  if ($('chatBtn')) $('chatBtn').setAttribute('aria-label',
    chatUnread ? 'Chat, ' + chatUnread + ' unread messages' : 'Chat');
}

/* ---------------- selection helpers ---------------- */

function syncSelectMatching() {
  var button = $('selectMatching');
  if (!button) return;
  button.setAttribute('aria-pressed', selectMatchingOn ? 'true' : 'false');
  button.setAttribute('aria-checked', selectMatchingOn ? 'true' : 'false');
  button.title = selectMatchingOn
    ? 'On: tap a card to select its rank; tap again to clear that rank. This never plays cards and works with Automatic draw off.'
    : 'Off: select cards individually. Turn on to select matching ranks together, even with Automatic draw off.';
}

function toggleMatchingSelection() {
  selectMatchingOn = !selectMatchingOn;
  syncSelectMatching();
}

function toggleHandCard(card) {
  meldTargetId = null; lastMeldTap = null;
  if (myHand().indexOf(card) === -1) return;
  var matches = selectMatchingOn
    ? myHand().filter(function (held) { return E.rankOf(held) === E.rankOf(card); })
    : [card];
  var allSelected = matches.every(function (held) { return sel.indexOf(held) !== -1; });
  if (allSelected) {
    sel = sel.filter(function (held) { return matches.indexOf(held) === -1; });
  } else {
    matches.forEach(function (held) { if (sel.indexOf(held) === -1) sel.push(held); });
  }
}

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
  syncSortPopover();
}

function syncSortBtn() {
  var b = $('sortBtn');
  if (!b) return;
  b.textContent = 'Sort';
  b.title = sortMode === 'rank'
    ? 'Arrange your hand. Currently sorted by rank: wilds first, then low to high.'
    : 'Arrange your hand. Currently sorted by count: your biggest groups first.';
  syncSortPopover();
}

function syncSortPopover() {
  [['sortRank', sortMode === 'rank'], ['sortCount', sortMode === 'group'],
    ['sortSpread', handLayout === 'spread'], ['sortLayered', handLayout === 'layered']]
    .forEach(function (entry) {
      if ($(entry[0])) $(entry[0]).setAttribute('aria-pressed', entry[1] ? 'true' : 'false');
    });
}

function currentSortContext() {
  return view ? [view.code, view.round, view.turn, view.phase].join(':') : null;
}

function syncSortContext() {
  var popup = $('sortPopover');
  if (popup && !popup.hidden && sortPopoverContext !== currentSortContext()) closeSortPopover(true);
}

// Anchor menus to their trigger while keeping long Auto options in the viewport.
function positionCardPopover(popup, trigger) {
  if (!popup || popup.hidden || !window.innerHeight || !window.innerWidth) return;
  var anchor = trigger.getBoundingClientRect();
  var margin = 12, gap = 6;
  var below = window.innerHeight - anchor.bottom - margin - gap;
  var above = anchor.top - margin - gap;
  var down = below >= 260 || below >= above;
  popup.style.maxHeight = Math.max(80, down ? below : above) + 'px';
  var bounds = popup.getBoundingClientRect();
  popup.style.left = Math.max(margin, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - margin)) + 'px';
  popup.style.right = 'auto';
  popup.style.top = down ? (anchor.bottom + gap) + 'px' : 'auto';
  popup.style.bottom = down ? 'auto' : (window.innerHeight - anchor.top + gap) + 'px';
}

function toggleSortPopover() {
  var popup = $('sortPopover');
  if (!popup || !view) return;
  if (!popup.hidden) return closeSortPopover(true);
  closeAutoDrawPopover(false, false);
  closeOpponentDetail();
  syncSortPopover();
  sortPopoverContext = currentSortContext();
  popup.hidden = false;
  $('sortBtn').setAttribute('aria-expanded', 'true');
  positionCardPopover(popup, $('sortBtn'));
  $(sortMode === 'rank' ? 'sortRank' : 'sortCount').focus({ preventScroll: true });
}

function closeSortPopover(restoreFocus) {
  var popup = $('sortPopover');
  if (!popup) return;
  var wasOpen = !popup.hidden;
  popup.hidden = true; sortPopoverContext = null;
  $('sortBtn').setAttribute('aria-expanded', 'false');
  if (wasOpen && restoreFocus) $('sortBtn').focus({ preventScroll: true });
}

function applyHandArrangement(kind, value) {
  if (kind === 'sort' && (value === 'rank' || value === 'group')) {
    sortMode = value; set('hf_sort', value); syncSortBtn();
  } else if (kind === 'layout' && (value === 'spread' || value === 'layered')) {
    handLayout = value; set('hf_layout', value); syncLayoutBtn();
  } else return;
  syncSortPopover();
  closeSortPopover(true);
  render();
}

function sortPopupContains(target) {
  return $('sortPopover').contains(target) || $('sortBtn').contains(target);
}

function consumeSortDismiss(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function dismissPointerKey(event) {
  return event.pointerId == null ? 'legacy' : String(event.pointerId);
}
function rememberDismissPointer(pointers, event) {
  pointers[dismissPointerKey(event)] = Date.now();
}
function cancelDismissPointer(event) {
  delete sortDismissPointers[dismissPointerKey(event)];
  delete autoDismissPointers[dismissPointerKey(event)];
}
function consumeDismissPointer(pointers, event) {
  var key = dismissPointerKey(event), now = Date.now();
  Object.keys(pointers).forEach(function (id) { if (now - pointers[id] > 2000) delete pointers[id]; });
  // Older Safari emits a MouseEvent click after a PointerEvent down.
  if (key === 'legacy' && pointers[key] === undefined) key = Object.keys(pointers)[0];
  if (key === undefined || pointers[key] === undefined) return false;
  delete pointers[key]; consumeSortDismiss(event); return true;
}
function handleSortOutsidePointer(event) {
  // Reusing the SAME pointer starts a new gesture; another finger cannot
  // release this finger's pending dismissal click.
  delete sortDismissPointers[dismissPointerKey(event)];
  var popup = $('sortPopover');
  if (!popup || popup.hidden || sortPopupContains(event.target)) return;
  closeSortPopover(true);
  rememberDismissPointer(sortDismissPointers, event);
  consumeSortDismiss(event);
}
function handleSortOutsideClick(event) {
  if (consumeDismissPointer(sortDismissPointers, event)) return;
  var popup = $('sortPopover');
  if (!popup || popup.hidden || sortPopupContains(event.target)) return;
  closeSortPopover(true); consumeSortDismiss(event);
}

function handleSortPopoverKey(event) {
  var popup = $('sortPopover');
  if (!popup || popup.hidden || event.key !== 'Escape') return;
  consumeSortDismiss(event);
  closeSortPopover(true);
}

/* Auto draw changes only where the two stock cards come from. It never takes
 * the discard pile or plays a card, and a potential pickup always pauses it. */
function validAutoDrawPiles(piles) {
  return Array.isArray(piles) && piles.length === 2 && piles[0] !== piles[1] &&
    piles.every(function (index) { return Number.isInteger(index) && index >= 0 && index < 4; });
}

function chooseAutoDrawPiles(stocks, mode, chosen, random) {
  if (mode === 'off') return { ok: false, piles: [], reason: 'Auto draw is off.' };
  if (['chosen', 'highest', 'lowest', 'random'].indexOf(mode) === -1) {
    return { ok: false, piles: [], reason: 'Choose an auto draw mode.' };
  }
  var live = (stocks || []).map(function (count, index) { return { index: index, count: count }; })
    .filter(function (pile) { return pile.count > 0; });
  if (!live.length) return { ok: false, piles: [], reason: 'No draw piles remain.' };
  if (live.length === 1) return { ok: true, piles: [live[0].index, live[0].index], reason: '' };
  if (mode === 'chosen') {
    if (!validAutoDrawPiles(chosen)) return { ok: false, piles: [], reason: 'Choose two different piles first.' };
    if (chosen.some(function (index) { return !stocks[index]; })) {
      return { ok: false, piles: [], reason: 'A chosen pile is empty. Choose another pair or draw manually.' };
    }
    return { ok: true, piles: chosen.slice(), reason: '' };
  }
  if (mode === 'random') {
    var rng = random || Math.random, first = Math.floor(rng() * live.length);
    var picked = live.splice(first, 1)[0];
    return { ok: true, piles: [picked.index, live[Math.floor(rng() * live.length)].index], reason: '' };
  }
  live.sort(function (a, b) {
    return (mode === 'highest' ? b.count - a.count : a.count - b.count) || a.index - b.index;
  });
  return { ok: true, piles: live.slice(0, 2).map(function (pile) { return pile.index; }), reason: '' };
}

/* Shared with the pickup confirmation. Only public melds and your own hand
 * are examined; a short pile must not strand you illegally in your foot. */
function canTakeAutomaticPile(cards, top, takeCount, state) {
  state = state || view;
  if (!state || !state.you || !top || !takeCount || E.isWild(top) || E.rankOf(top) === '3') return false;
  var S = state.settings, you = state.you, rank = E.rankOf(top);
  if (!Array.isArray(cards) || new Set(cards).size !== cards.length ||
      cards.some(function (card) { return you.hand.indexOf(card) === -1; })) return false;
  if (cards.filter(function (card) { return !E.isWild(card) && E.rankOf(card) === rank; }).length < S.pileNaturalsRequired) return false;
  var melds = state.seats[you.seat].melds;
  var target = melds.find(function (meld) { return meld.rank === rank && !E.meldStats(meld, S).complete; });
  var added = cards.concat([top]);
  var result = { rank: rank, cards: (target ? target.cards : []).concat(added) };
  if (!E.checkMeld(rank, result.cards, S).ok) return false;
  var remaining = you.hand.length - cards.length + Math.max(0, takeCount - 1);
  if (!you.inFoot && remaining > 0) return true;
  if (!you.inFoot) remaining = you.footCount || 0;
  if (S.goOutWithDiscard && you.inFoot && remaining === 0) return false;
  if (remaining >= 2) return true;
  var after = melds.filter(function (meld) { return meld !== target; }).concat([result]);
  var red = 0, black = 0;
  after.forEach(function (meld) {
    var stats = E.meldStats(meld, S);
    if (stats.isRedBook) red++;
    if (stats.isBlackBook || stats.isWildBook) black++;
  });
  if (red < S.requireRedBook || black < S.requireBlackBook) return false;
  if (remaining === 0 && !you.hasInitialMeld) {
    var laid = state.turnState ? state.turnState.melded || 0 : 0;
    if (laid + added.reduce(function (total, card) { return total + E.cardValue(card, S); }, 0) < state.minMeld) return false;
  }
  return true;
}

function loadAutoDrawPreferences() {
  autoDrawMode = 'off'; autoDrawPiles = [0, 1];
  try {
    var saved = JSON.parse(get('hf_auto_draw') || 'null');
    if (saved && ['off', 'chosen', 'highest', 'lowest', 'random'].indexOf(saved.mode) !== -1) {
      if (validAutoDrawPiles(saved.piles)) autoDrawPiles = saved.piles.slice();
      if (saved.mode !== 'chosen' || validAutoDrawPiles(saved.piles)) autoDrawMode = saved.mode;
    }
  } catch (e) { /* A damaged preference never enables automatic play. */ }
  autoDrawDraftMode = autoDrawMode; autoDrawDraftPiles = autoDrawPiles.slice();
  syncAutoDrawControls();
}

function saveAutoDrawPreference(mode, piles) {
  if (['off', 'chosen', 'highest', 'lowest', 'random'].indexOf(mode) === -1 ||
      (mode === 'chosen' && !validAutoDrawPiles(piles))) return false;
  autoDrawMode = mode;
  if (validAutoDrawPiles(piles)) autoDrawPiles = piles.slice();
  set('hf_auto_draw', JSON.stringify({ mode: autoDrawMode, piles: autoDrawPiles }));
  autoDrawStatus = '';
  if (notice.indexOf('Auto draw') === 0) { notice = ''; noticeBad = false; }
  if (mode === 'off') cancelAutoDraw();
  syncAutoDrawControls();
  return true;
}

function cancelAutoDraw() {
  clearTimeout(autoDrawTimer); autoDrawTimer = null;
}

function syncAutoDrawTurn() {
  if (!view) return;
  var base = [view.code, view.round, view.turn].join(':');
  var discardId = null;
  (view.log || []).forEach(function (entry) {
    if (entry.t === 'discard' && entry.id != null) discardId = entry.id;
  });
  if (base !== autoDrawObservedBase ||
      (discardId !== null && discardId !== autoDrawObservedDiscard)) {
    cancelAutoDraw(); autoDrawTurnSerial++;
    autoDrawTurnContext = base + ':' + autoDrawTurnSerial;
    autoDrawAttemptedContext = null; autoDrawStatus = '';
    autoDrawObservedBase = base; autoDrawObservedDiscard = discardId;
  } else if (discardId !== null) autoDrawObservedDiscard = discardId;
}

function autoDrawUiBlocked() {
  return document.hidden || !!document.querySelector('.sheet:not([hidden]), #sortPopover:not([hidden]), #autoDrawPopover:not([hidden])');
}

function autoDrawPlan() {
  if (autoDrawMode === 'off' || !view || !isMyTurn() || view.turnPhase !== 'draw') return null;
  if (!autoDrawStateFresh || !ws || ws.readyState !== 1 || actionPending || autoDrawUiBlocked()) return null;
  if (autoDrawAttemptedContext === autoDrawTurnContext) return null;
  if (pileChance()) return { ok: false, reason: 'You can take the discard pile. Choose your draw manually.' };
  return chooseAutoDrawPiles(view.stocks, autoDrawMode, autoDrawPiles);
}

function reportAutoDrawPause(reason) {
  var message = 'Auto draw paused: ' + reason;
  if (autoDrawStatus === message) return;
  autoDrawStatus = message; notice = message; noticeBad = false;
  syncAutoDrawControls(); renderActions(); syncActionPending(); scheduleBoardSize();
}

function maybeAutoDraw() {
  syncAutoDrawTurn();
  var plan = autoDrawPlan();
  if (!plan) { cancelAutoDraw(); return; }
  if (!plan.ok) { cancelAutoDraw(); reportAutoDrawPause(plan.reason); return; }
  if (autoDrawTimer !== null) return;
  autoDrawTimer = setTimeout(function () { autoDrawTimer = null; runAutoDraw(); }, 250);
}

function runAutoDraw() {
  cancelAutoDraw(); syncAutoDrawTurn();
  var plan = autoDrawPlan();
  if (!plan) return false;
  if (!plan.ok) { reportAutoDrawPause(plan.reason); return false; }
  // Record before sending: even a refused move or connection loss is one
  // attempt for this turn, not permission to retry in a state-update loop.
  autoDrawAttemptedContext = autoDrawTurnContext;
  if (!act('draw', { piles: plan.piles.slice() })) {
    reportAutoDrawPause('The draw was not sent. Draw manually when connected.');
    return false;
  }
  autoDrawStatus = view.settings.stockPiles === 1 ? 'Drew two automatically from the stock.' : 'Drew automatically from piles ' + plan.piles.map(function (index) { return index + 1; }).join(' and ') + '.';
  syncAutoDrawControls();
  return true;
}

function stopAutoDrawForTurn() {
  cancelAutoDraw(); syncAutoDrawTurn();
  if (autoDrawMode !== 'off' && isMyTurn() && view.turnPhase === 'draw') {
    autoDrawAttemptedContext = autoDrawTurnContext;
    autoDrawStatus = 'Auto draw paused after an error. Draw manually this turn.';
    syncAutoDrawControls();
  }
}

function syncAutoDrawControls() {
  var trigger = $('autoDrawBtn');
  if (!trigger) return;
  var singleStock = view && view.settings.stockPiles === 1;
  trigger.dataset.mode = autoDrawMode;
  var label = { off: 'off', chosen: 'chosen piles', highest: 'highest two', lowest: 'lowest two', random: 'random piles' }[autoDrawMode];
  if (singleStock && autoDrawMode !== 'off') label = 'on';
  trigger.title = autoDrawStatus || 'Auto draw: ' + label;
  trigger.setAttribute('aria-label', 'Auto draw, ' + label);
  [['Off', 'off'], ['Chosen', 'chosen'], ['Highest', 'highest'], ['Lowest', 'lowest'], ['Random', 'random']].forEach(function (option) {
    var optionButton = $('autoDraw' + option[0]);
    optionButton.hidden = !!singleStock && (option[0] === 'Highest' || option[0] === 'Lowest' || option[0] === 'Random');
    optionButton.setAttribute('aria-pressed', (singleStock && option[0] === 'Chosen' ? autoDrawDraftMode !== 'off' : autoDrawDraftMode === option[1]) ? 'true' : 'false');
  });
  $('autoDrawChosen').textContent = singleStock ? 'On' : 'Choose two piles';
  if ($('autoDrawHelp')) $('autoDrawHelp').textContent = singleStock
    ? 'Draw two from the stock when your turn starts; pause when you can take the discard pile.'
    : 'Draw two when your turn starts; pause when you can take the discard pile. Highest and lowest mean cards remaining, not card values.';
  $('autoDrawFixed').hidden = !!singleStock || autoDrawDraftMode !== 'chosen';
  for (var i = 0; i < 4; i++) $('autoDrawPile' + i).setAttribute('aria-pressed', autoDrawDraftPiles.indexOf(i) !== -1 ? 'true' : 'false');
  $('closeAutoDraw').disabled = autoDrawDraftMode === 'chosen' && !validAutoDrawPiles(autoDrawDraftPiles);
  $('autoDrawStatus').textContent = singleStock ? (autoDrawStatus || 'Both cards come from the one stock.') : autoDrawDraftMode === 'chosen' && !validAutoDrawPiles(autoDrawDraftPiles)
    ? 'Choose two different piles, then Done.' : autoDrawStatus || 'Highest and lowest use cards remaining. Chosen empty piles pause for a manual draw.';
}

function toggleAutoDrawPopover() {
  var popup = $('autoDrawPopover');
  if (!popup || !view) return;
  if (!popup.hidden) return closeAutoDrawPopover(true);
  closeSortPopover(false); closeOpponentDetail(); cancelAutoDraw();
  autoDrawDraftMode = autoDrawMode; autoDrawDraftPiles = autoDrawPiles.slice();
  autoDrawPopoverContext = currentSortContext();
  popup.hidden = false; $('autoDrawBtn').setAttribute('aria-expanded', 'true');
  syncAutoDrawControls();
  positionCardPopover(popup, $('autoDrawBtn'));
  $('autoDraw' + (view && view.settings.stockPiles === 1 && autoDrawDraftMode !== 'off' ? 'Chosen' : { off: 'Off', chosen: 'Chosen', highest: 'Highest', lowest: 'Lowest', random: 'Random' }[autoDrawDraftMode])).focus({ preventScroll: true });
}

function closeAutoDrawPopover(restoreFocus, resume) {
  var popup = $('autoDrawPopover');
  if (!popup) return;
  var wasOpen = !popup.hidden;
  popup.hidden = true; autoDrawPopoverContext = null;
  autoDrawDraftMode = autoDrawMode; autoDrawDraftPiles = autoDrawPiles.slice();
  $('autoDrawBtn').setAttribute('aria-expanded', 'false');
  if (wasOpen && restoreFocus) $('autoDrawBtn').focus({ preventScroll: true });
  if (wasOpen && resume !== false) maybeAutoDraw();
}

function selectAutoDrawMode(mode) {
  if (['off', 'chosen', 'highest', 'lowest', 'random'].indexOf(mode) === -1) return;
  if (view && view.settings.stockPiles === 1 && mode === 'chosen' && !validAutoDrawPiles(autoDrawDraftPiles)) autoDrawDraftPiles = [0, 1];
  autoDrawDraftMode = mode; syncAutoDrawControls();
  if (mode !== 'chosen' || (view && view.settings.stockPiles === 1)) {
    saveAutoDrawPreference(mode, autoDrawDraftPiles);
    closeAutoDrawPopover(true);
  }
}

function toggleAutoDrawPile(index) {
  if (!Number.isInteger(index) || index < 0 || index > 3) return;
  var at = autoDrawDraftPiles.indexOf(index);
  if (at !== -1) autoDrawDraftPiles.splice(at, 1);
  else if (autoDrawDraftPiles.length < 2) autoDrawDraftPiles.push(index);
  syncAutoDrawControls();
}

function commitAutoDrawChoices() {
  if (!saveAutoDrawPreference(autoDrawDraftMode, autoDrawDraftPiles)) return;
  closeAutoDrawPopover(true);
}

function autoDrawPopupContains(target) {
  return $('autoDrawPopover').contains(target) || $('autoDrawBtn').contains(target);
}

function handleAutoDrawOutsidePointer(event) {
  delete autoDismissPointers[dismissPointerKey(event)];
  var popup = $('autoDrawPopover');
  if (!popup || popup.hidden || autoDrawPopupContains(event.target)) return;
  closeAutoDrawPopover(true); rememberDismissPointer(autoDismissPointers, event); consumeSortDismiss(event);
}
function handleAutoDrawOutsideClick(event) {
  if (consumeDismissPointer(autoDismissPointers, event)) return;
  var popup = $('autoDrawPopover');
  if (!popup || popup.hidden || autoDrawPopupContains(event.target)) return;
  closeAutoDrawPopover(true); consumeSortDismiss(event);
}

function handleAutoDrawKey(event) {
  var popup = $('autoDrawPopover');
  if (!popup || popup.hidden || event.key !== 'Escape') return;
  closeAutoDrawPopover(true); consumeSortDismiss(event);
}

function wireAutoDraw() {
  loadAutoDrawPreferences();
  $('autoDrawBtn').onclick = toggleAutoDrawPopover;
  $('closeAutoDraw').onclick = commitAutoDrawChoices;
  [['Off', 'off'], ['Chosen', 'chosen'], ['Highest', 'highest'], ['Lowest', 'lowest'], ['Random', 'random']].forEach(function (option) {
    $('autoDraw' + option[0]).onclick = function () { selectAutoDrawMode(option[1]); };
  });
  for (var i = 0; i < 4; i++) (function (index) {
    $('autoDrawPile' + index).onclick = function () { toggleAutoDrawPile(index); };
  })(i);
  document.addEventListener('pointerdown', handleAutoDrawOutsidePointer, true);
  document.addEventListener('click', handleAutoDrawOutsideClick, true);
  document.addEventListener('keydown', handleAutoDrawKey, true);
  document.addEventListener('visibilitychange', maybeAutoDraw);
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(maybeAutoDraw);
    document.querySelectorAll('.sheet, #sortPopover, #autoDrawPopover').forEach(function (popup) {
      observer.observe(popup, { attributes: true, attributeFilter: ['hidden'] });
    });
  }
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
  var existing = myMelds().find(function (m) { return m.rank === r && !meldStatsOf(m).complete; });
  var combined = (existing ? existing.cards : []).concat(sel, [top]);
  if (!E.checkMeld(r, combined, view.settings).ok) return null;
  return { rank: r, take: Math.min(view.settings.pileTakeExtra + 1, view.discardCount) };
}

/* A pile pickup uses the required matching naturals automatically. Card
 * selection is for melds and discards, so it never changes this offer. */
function pileChance() {
  if (!view.discardTop || !view.discardCount) return null;
  var top = view.discardTop;
  if (E.isWild(top) || E.isBlackThree(top) || E.isRedThree(top)) return null;
  var r = E.rankOf(top);
  var need = view.settings.pileNaturalsRequired;
  var nat = myHand().filter(function (c) { return !E.isWild(c) && E.rankOf(c) === r; });
  if (nat.length < need) return null;
  var take = Math.min(view.settings.pileTakeExtra + 1, view.discardCount);
  // A larger natural set may complete the required book and legally empty a
  // foot where exactly two would strand it. Prefer the smallest legal set.
  for (var count = need; count <= nat.length; count++) {
    var cards = nat.slice(0, count);
    if (canTakeAutomaticPile(cards, top, take)) return { rank: r, need: need, take: take, cards: cards };
  }
  return null;
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

/* A book's caption starts a line, so its rank is capitalised; rankName itself
 * stays lower case because everywhere else it sits mid-sentence — "laid three
 * jacks", "select 2 aces". The captions used to be typeset in capitals, which
 * hid the difference; in sentence case it shows. */
function capRank(r) {
  var n = E.rankName(r);
  return n.charAt(0).toUpperCase() + n.slice(1);
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
      E.cardValue(b, view ? view.settings : E.DEFAULTS) - E.cardValue(a, view ? view.settings : E.DEFAULTS) ||
      (a < b ? -1 : a > b ? 1 : 0);
  });
}

/* The first card is the face of the fan. Clean melds lead with red suits;
 * once a wild is present, black suits lead. Preserve the existing order
 * within each group, including jokers before deuces at the back. This is
 * presentation only and works the same before and after a book closes. */
function orderMeldCards(meld) {
  var cards = orderCards(meld.cards);
  var wilds = cards.filter(E.isWild);
  var frontIsRed = wilds.length === 0;
  var front = [], back = [];
  cards.forEach(function (card) {
    if (!E.isWild(card)) (E.isRed(card) === frontIsRed ? front : back).push(card);
  });
  return front.concat(back, wilds);
}

/* ---------------- accepted card movement ----------------
 * A visual layer only: actions and layout never wait for a flight. The planner
 * uses public history and this seat's private hand, never guessed hidden cards. */
var cardMotionOn = get('hf_card_motion') !== 'off';
document.documentElement.setAttribute('data-card-motion', cardMotionOn ? 'on' : 'off');
var motionHasState = false, motionLogId = 0, motionGeneration = 0;
var motionFrame = null, motionFlights = [], motionLayer = null;

/* Motion planner: pure snapshot data; also exercised by motion.test.js. */
function latestMotionLogId(state) {
  return (state && state.log || []).reduce(function (id, entry) { return Math.max(id, Number(entry.id) || 0); }, 0);
}
function planCardMotion(before, after, seenId) {
  if (!before || !after || before.phase !== 'playing' || after.phase !== 'playing' ||
      before.code !== after.code || before.round !== after.round || !before.you || !after.you ||
      before.you.seat !== after.you.seat) return [];
  var events = (after.log || []).filter(function (entry) { return entry.id > seenId; });
  var actions = events.filter(function (entry) { return ['draw', 'discard', 'meld', 'pile'].indexOf(entry.t) !== -1; });
  // Resume/catch-up and undone history must not look like a new physical play.
  if (actions.length !== 1 || (seenId > 0 && events.length && events[0].id > seenId + 1)) return [];
  var event = actions[0], seat = after.you.seat;
  if (event.seat !== seat) return [];
  var oldHand = before.you.hand || [], newHand = after.you.hand || [];
  var added = newHand.filter(function (card) { return oldHand.indexOf(card) === -1; });
  var removed = oldHand.filter(function (card) { return newHand.indexOf(card) === -1; });
  var oldMelds = before.seats[seat].melds || [], newMelds = after.seats[seat].melds || [];
  var oldPublic = [];
  oldMelds.forEach(function (meld) { oldPublic = oldPublic.concat(meld.cards); });
  var destinations = Object.create(null);
  newMelds.forEach(function (meld) {
    meld.cards.forEach(function (card) { if (oldPublic.indexOf(card) === -1) destinations[card] = meld.id; });
  });
  var foot = events.some(function (entry) { return entry.t === 'foot' && entry.seat === seat; }) || before.you.inFoot !== after.you.inFoot;
  var moves = [];
  function add(card, from, to) { moves.push({ card: card, from: from, to: to }); }
  if (event.t === 'draw') {
    var arrivals = (after.you.picked || []).filter(function (card) { return added.indexOf(card) !== -1; });
    if (foot || (after.you.redThrees || []).length !== (before.you.redThrees || []).length || removed.length || arrivals.length !== event.n || arrivals.length !== added.length ||
        !Array.isArray(event.piles) || event.piles.length !== arrivals.length) return [];
    arrivals.forEach(function (card, index) {
      var pile = event.piles[index] - 1;
      if (pile >= 0 && before.stocks[pile] > 0) add(card, { zone: 'stock', pile: pile }, { zone: 'hand' });
    });
  } else if (event.t === 'discard') {
    if (removed.indexOf(event.card) !== -1 && after.discardTop === event.card) {
      add(event.card, { zone: 'hand' }, { zone: 'discard' });
    }
  } else if (event.t === 'meld' || event.t === 'pile') {
    removed.forEach(function (card) {
      if (destinations[card]) add(card, { zone: 'hand' }, { zone: 'meld', meld: destinations[card] });
    });
    if (event.t === 'pile') {
      if (before.discardTop && destinations[before.discardTop]) {
        add(before.discardTop, { zone: 'discard' }, { zone: 'meld', meld: destinations[before.discardTop] });
      }
      // With automatic red-three replacement, a hidden pickup may also contain
      // stock arrivals. Its exact sources are deliberately absent from the view.
      if (!foot && !(after.settings && after.settings.redThreeAutoLayOff)) {
        added.forEach(function (card) { add(card, { zone: 'discard' }, { zone: 'hand' }); });
      }
    }
  }
  // A large custom pickup should never cover the table with twenty clones.
  return moves.slice(0, 8);
}
/* End motion planner. */

function cancelCardMotion() {
  motionGeneration++;
  if (motionFrame !== null && window.cancelAnimationFrame) window.cancelAnimationFrame(motionFrame);
  motionFrame = null;
  motionFlights.forEach(function (animation) { animation.cancel(); });
  motionFlights = [];
  if (motionLayer && motionLayer.parentNode) motionLayer.parentNode.removeChild(motionLayer);
  motionLayer = null;
}
function resetCardMotion() { cancelCardMotion(); motionHasState = false; motionLogId = 0; }
function canAnimateCards() {
  return cardMotionOn && !document.hidden && window.requestAnimationFrame &&
    !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) &&
    typeof document.createElement('div').animate === 'function';
}
function motionCardIn(area, card) {
  return area && Array.prototype.find.call(area.querySelectorAll('[data-motion-card]'), function (node) { return node.dataset.motionCard === String(card); });
}
function motionElement(location, card) {
  if (location.zone === 'hand') return motionCardIn($('myHand'), card);
  if (location.zone === 'stock') return $('drawPile' + location.pile) && $('drawPile' + location.pile).querySelector('.card');
  if (location.zone === 'discard') return $('discardPreview') && $('discardPreview').querySelector('.card');
  if (location.zone === 'meld') {
    var box = Array.prototype.find.call($('myMelds').querySelectorAll('[data-meld-id]'), function (node) { return node.dataset.meldId === String(location.meld); });
    return motionCardIn(box, card) || (box && box.querySelector('.card')) || box;
  }
  return null;
}
function motionRect(element) {
  if (!element || !element.getBoundingClientRect) return null;
  var rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return null;
  var shelf = element.closest && element.closest('#myHand, #myMelds');
  if (shelf) {
    var clip = shelf.getBoundingClientRect();
    if (rect.bottom <= clip.top || rect.top >= clip.bottom || rect.right <= clip.left || rect.left >= clip.right) return null;
  }
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}
function prepareCardMotion(next) {
  cancelCardMotion();
  var planned = motionHasState && canAnimateCards() ? planCardMotion(view, next, motionLogId) : [];
  motionHasState = true;
  var newContext = !view || view.code !== next.code || view.round !== next.round ||
    !view.you || !next.you || view.you.seat !== next.you.seat;
  motionLogId = newContext ? latestMotionLogId(next) : Math.max(motionLogId, latestMotionLogId(next));
  return planned.map(function (move) {
    var source = motionElement(move.from, move.card), bounds = motionRect(source);
    return bounds ? { move: move, source: bounds, face: move.from.zone === 'hand' ? motionClone(source) : null } : null;
  }).filter(Boolean);
}
function motionClone(source) {
  var clone = source.cloneNode(true);
  var original = [source].concat(Array.prototype.slice.call(source.querySelectorAll('*')));
  var copied = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
  var properties = ['background', 'color', 'border', 'border-radius', 'box-shadow', 'font-family', 'font-size', 'font-weight',
    'line-height', 'letter-spacing', 'padding', 'display', 'align-items', 'justify-content', 'flex-direction'];
  original.forEach(function (node, index) {
    var computed = getComputedStyle(node), target = copied[index];
    properties.forEach(function (property) { target.style.setProperty(property, computed.getPropertyValue(property)); });
    target.removeAttribute('id'); target.removeAttribute('data-card'); target.removeAttribute('data-motion-card'); target.removeAttribute('aria-label');
    target.style.animation = 'none'; target.style.transition = 'none'; target.style.transform = 'none';
  });
  ['sel', 'fresh', 'fresh-first', 'enter', 'deal', 'just-played'].forEach(function (name) { clone.classList.remove(name); });
  clone.classList.add('card-flight'); clone.setAttribute('aria-hidden', 'true'); clone.tabIndex = -1;
  if (clone.tagName.toLowerCase() === 'button') clone.disabled = true;
  return clone;
}
function playCardMotion(prepared) {
  if (!prepared.length || !canAnimateCards()) return;
  var generation = motionGeneration;
  // render() queued sizeBoard first, so this frame sees the final hand layout.
  motionFrame = window.requestAnimationFrame(function () {
    motionFrame = null;
    if (generation !== motionGeneration || !canAnimateCards()) return;
    motionLayer = document.createElement('div'); motionLayer.className = 'card-motion-layer';
    motionLayer.setAttribute('aria-hidden', 'true'); document.body.appendChild(motionLayer);
    prepared.forEach(function (item, index) {
      var target = motionElement(item.move.to, item.move.card);
      if (!target) return;
      target.classList.remove('enter'); target.classList.remove('deal');
      if (item.move.to.zone === 'meld' && target.closest) {
        var book = target.closest('.meld'); if (book) book.classList.remove('land');
      }
      var end = motionRect(target);
      if (!end) return;
      var clone = item.face || motionClone(target), start = item.source;
      var base = item.face ? start : end;
      clone.style.position = 'fixed'; clone.style.left = end.left + 'px'; clone.style.top = end.top + 'px';
      clone.style.width = base.width + 'px'; clone.style.height = base.height + 'px';
      clone.style.margin = '0'; clone.style.transformOrigin = '0 0'; clone.style.pointerEvents = 'none';
      motionLayer.appendChild(clone);
      var transform = 'translate(' + (start.left - end.left) + 'px,' + (start.top - end.top) + 'px) scale(' +
        (start.width / base.width) + ',' + (start.height / base.height) + ')';
      var animation = clone.animate([{ transform: transform, opacity: 1 }, { transform: 'translate(0,0) scale(' + (end.width / base.width) + ',' + (end.height / base.height) + ')', opacity: 1 }], {
        duration: 330, delay: Math.min(index * 25, 100), easing: 'cubic-bezier(.2,.7,.25,1)', fill: 'both'
      });
      motionFlights.push(animation);
      animation.onfinish = function () {
        if (clone.parentNode) clone.parentNode.removeChild(clone);
        motionFlights = motionFlights.filter(function (flight) { return flight !== animation; });
        if (!motionFlights.length && motionLayer && motionLayer.parentNode) {
          motionLayer.parentNode.removeChild(motionLayer); motionLayer = null;
        }
      };
    });
    if (!motionFlights.length && motionLayer && motionLayer.parentNode) { motionLayer.parentNode.removeChild(motionLayer); motionLayer = null; }
  });
}
window.addEventListener('resize', cancelCardMotion);
document.addEventListener('visibilitychange', function () { if (document.hidden) resetCardMotion(); });

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
    freshTimer = setTimeout(expireFreshPlays, 700);
  }
}
function expireFreshPlays() {
  freshTimer = null;
  if (!view) return;
  var now = Date.now(), changed = false;
  Object.keys(freshPlays).forEach(function (card) {
    if (now - freshPlays[card] > FRESH_MS || !seenCards || !seenCards[card]) {
      delete freshPlays[card]; changed = true;
    }
  });
  // Keep the original expiry cadence without rebuilding unchanged cards.
  if (changed) render();
  else if (Object.keys(freshPlays).length) freshTimer = setTimeout(expireFreshPlays, 700);
}
function isFreshPlay(c) { return Object.prototype.hasOwnProperty.call(freshPlays, c); }

/* ---------------- rendering ---------------- */

/* A joker is worth 50 and a deuce 20, so they must never look alike on the
 * table. Each gets its own colour, here and on the little blocks that stand in
 * for an opponent's book. */
function wildClass(id) {
  if (E.isJoker(id)) return ' wild joker';
  if (E.rankOf(id) === '2') return ' wild deuce';
  // A red three carries the table's penalty and can never be melded, so it is banded in
  // rouge to stand out from every other card in the hand as something to shed.
  if (E.isRedThree(id)) return ' wild dead';
  return '';
}

function redThreePenalty() {
  var value = view && view.settings ? view.settings.redThreeValue : undefined;
  return typeof value === 'number' ? value : E.DEFAULTS.redThreeValue;
}

function laidRedThreeValue() {
  return view && view.settings.redThreeBonus ? Math.abs(redThreePenalty()) : redThreePenalty();
}

function cardEl(id, opts) {
  opts = opts || {};
  var b = document.createElement(opts.click ? 'button' : 'div');
  b.dataset.motionCard = id;
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
  if (opts.book && !E.isWild(id)) b.classList.add(opts.book);
  if (opts.click) {
    b.type = 'button'; b.onclick = opts.click; b.dataset.card = id;
    b.setAttribute('aria-pressed', opts.selected ? 'true' : 'false');
  }
  b.setAttribute('aria-label', opts.title || E.label(id));
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

/* What has already been shown arriving.
 *
 * Every one of these exists because the hand and the books are rebuilt from
 * scratch on each message from the server, and a CSS animation on a brand new
 * node plays every single time. Without a record of what has already arrived,
 * your whole hand would re-deal itself every time a bot discarded. So arrival
 * is tracked per card and per book, and the record is cleared when a round
 * ends — which is the only time everything genuinely is new again. */
var dealPending = false;   // the next hand paint is a fresh deal
var lastRound = null;      // the round the records below belong to
var minePainted = false;   // your books have been drawn at least once this round
var enteredCards = Object.create(null);
var seenMelds = Object.create(null);

function render() {
  if (!view) return;
  document.querySelector('.board').dataset.phase = view.phase;
  // The waiting room hides the hand toolbar, so keep chat in its header there.
  var chatAnchor = $(view.phase === 'lobby' ? 'rulesBtn' : 'sortBtn');
  if ($('chatBtn') && chatAnchor && chatAnchor.parentNode && $('chatBtn').nextSibling !== chatAnchor)
    chatAnchor.parentNode.insertBefore($('chatBtn'), chatAnchor);
  var displayContext = view.code + ':' + view.round;
  if (meldDisplayContext !== displayContext) {
    meldDisplayContext = displayContext; meldExpanded = Object.create(null);
  }
  syncSortContext();
  syncAutoDrawControls();
  if ($('autoDrawPopover') && !$('autoDrawPopover').hidden && autoDrawPopoverContext !== currentSortContext()) {
    closeAutoDrawPopover(false, false);
  }

  if (view.phase === 'playing') {
    if (lastRound !== view.round) {
      lastRound = view.round;
      dealPending = true;
      minePainted = false;
      enteredCards = Object.create(null);
      seenMelds = Object.create(null);
      handSignature = null; closeOpponentDetail();
    }
  } else {
    lastRound = null;
  }

  $('tableCode').textContent = view.code || '—';
  $('roundLabel').textContent = (view.round + 1) + ' of ' + view.roundsTotal;
  $('minLabel').textContent = view.minMeld;
  $('meldCell').hidden = view.phase === 'lobby';

  var pill = $('turnPill');
  if (view.phase === 'lobby') {
    pill.textContent = view.seated + ' of ' + view.seats.length + ' seated';
    pill.className = 'pill';
  } else if (view.phase === 'playing') {
    var mine = isMyTurn();
    pill.textContent = mine ? 'Your turn' : '';
    // Opponent turns use the seat outline; this label belongs only to you.
    pill.className = 'pill' + (mine ? ' you' : '');
  } else {
    pill.textContent = view.phase === 'gameEnd' ? 'Game over' : 'Round over';
    pill.className = 'pill';
  }

  pill.hidden = view.phase === 'playing' && !isMyTurn();
  syncTitle();

  var share = $('shareBox');
  share.hidden = !(view.phase === 'lobby' && !view.solo);
  if (!share.hidden) {
    $('shareCode').textContent = view.code;
    if ($('lobbyRuleSummary')) $('lobbyRuleSummary').textContent = rulesPresetName(E.rulePresetId(view.settings)) + ' · Individual scoring';
  }

  notePlays();
  renderSeats();
  renderCenter();
  renderMine();
  renderActions();
  renderLog();
  scheduleBoardSize();
  syncActionPending();
  // Sheets left open follow the table rather than freezing at the moment they
  // were opened — someone else turning the rule off should show there at once.
  if (!$('rulesSheet').hidden) renderRules();
  if (!$('peekSheet').hidden) {
    if (view.discardTop) showPeek();
    else $('peekSheet').hidden = true;
  }
  syncScoreSheet();
  maybeAutoDraw();
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
function publicMeldedPoints(seat) {
  // Only face-up meld cards count here. Book bonuses stay separately labelled,
  // and neither this player's hidden hand nor their foot is consulted.
  return (seat.melds || []).reduce(function (points, meld) {
    return points + meld.cards.reduce(function (sum, card) { return sum + E.cardValue(card, view.settings); }, 0);
  }, 0);
}

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
    out.push(chip(s.redThrees + ' red three' + (many ? 's' : '') + ' · ' + num(laidRedThreeValue()) + (many ? ' each' : ''), 'red'));
  }
  return out;
}

/* Update seats in place so their public melds and density stay stable across
 * unrelated state messages and local card selections. */
var seatNodes = [];

/* What a seat's books look like, as a string. Same string, same books, so the
 * strip is left completely alone — including the flash on a fresh play, which
 * would otherwise rebuild it again a few seconds later when it faded. */
function meldsSignature(s) {
  var parts = [opponentMeldStyle, finishedBookStyle, JSON.stringify(meldExpanded)];
  orderMelds(s.melds).forEach(function (m) {
    var st = meldStatsOf(m);
    parts.push(m.rank + ':' + st.wilds + (st.complete ? 'c' : '') + ':' +
      orderMeldCards(m).map(function (c) {
        return c + (isFreshPlay(c) ? '*' : '');
      }).join(','));
  });
  return parts.join('|');
}

function meldDisplayKey(m, seat) {
  return [view.code, view.round, seat, m.id].join(':');
}

function isMeldExpanded(m, seat) {
  var key = meldDisplayKey(m, seat);
  if (Object.prototype.hasOwnProperty.call(meldExpanded, key)) return meldExpanded[key];
  return meldStatsOf(m).complete ? finishedBookStyle === 'spread' : opponentMeldStyle === 'cards';
}

function toggleMeldDisplay(m, seat, event) {
  var key = meldDisplayKey(m, seat);
  meldExpanded[key] = !isMeldExpanded(m, seat);
  renderSeats(); renderMine(); scheduleBoardSize();
  if (event && event.detail === 0) {
    var wrap = seat === meSeat() ? $('myMelds') : seatNodes[seat].melds;
    var replacement = Array.prototype.find.call(wrap.querySelectorAll('button'), function (button) {
      return button.dataset.meldId === m.id;
    });
    if (replacement) replacement.focus({ preventScroll: true });
  }
}

function meldWildTrims(el, wilds) {
  ['wildTop', 'wildBottom', 'wildTopExtra', 'wildBottomExtra'].forEach(function (key, index) {
    if (wilds[index]) el.dataset[key] = E.isJoker(wilds[index]) ? 'joker' : 'deuce';
  });
}

/* Both shelves use the same vocabulary: rank, count, card faces. Only the
 * opponent scale differs. The display preference never reaches the server. */
function meldDisplayElement(m, seat, own) {
  var st = meldStatsOf(m), ordered = orderMeldCards(m), wilds = ordered.filter(E.isWild);
  var expanded = isMeldExpanded(m, seat);
  var presentation = expanded ? 'fan' : opponentMeldStyle === 'tiles' ? 'tile' : 'stack';
  var target = own && !actionPending && canAddSelection(m);
  var nearly = m.cards.length === view.settings.bookSize - 1;
  var box = document.createElement('button'); box.type = 'button';
  box.className = 'meld ' + (st.wilds ? 'dirty' : 'clean') +
    (st.complete ? ' done' : '') + (nearly ? ' nearly-book' : '') +
    (target ? ' target' : '') + (own && meldTargetId === m.id ? ' chosen-target' : '');
  box.dataset.meldId = m.id; box.dataset.presentation = presentation;
  box.setAttribute('aria-expanded', String(expanded));
  box.style.setProperty('--meld-count', ordered.length);
  var head = document.createElement('div'); head.className = 'meld-top';
  var rank = document.createElement('span'); rank.className = 'meld-rank';
  rank.textContent = m.rank === 'T' ? '10' : m.rank;
  rank.dataset.tileRank = rank.textContent;
  var count = document.createElement('span'); count.className = 'meld-count';
  count.textContent = String(ordered.length);
  head.appendChild(rank); head.appendChild(count);
  head.dataset.short = rank.textContent + ' · ' + count.textContent;
  head.title = capRank(m.rank) + 's · ' + ordered.length +
    (st.complete ? (st.isRedBook ? ' · red book' : ' · black book') : '/' + view.settings.bookSize);
  if (nearly) head.title += ' · one card from a book';
  if (wilds.length) {
    var jokers = wilds.filter(E.isJoker).length, deuces = wilds.length - jokers, parts = [];
    if (jokers) parts.push(jokers + ' joker' + (jokers === 1 ? '' : 's'));
    if (deuces) parts.push(deuces + ' deuce' + (deuces === 1 ? '' : 's'));
    head.title += ' · ' + parts.join(', ');
  }
  box.setAttribute('aria-label', head.title + (target
    ? '. Choose this book, then Add below, or double-tap to add selected cards.'
    : expanded ? '. Collapse cards.' : '. Expand cards.'));
  if (own && st.isRedBook && sel.some(E.isWild)) box.title = 'A wild cannot be added to a red book.';
  var cards = document.createElement('div'); cards.className = 'meld-cards';
  cards.style.setProperty('--meld-count', ordered.length);
  if (!expanded) cards.classList.add('closed-book-stack');
  (expanded ? ordered : ordered.slice(0, 1)).forEach(function (card, i) {
    var el = cardEl(card, { tiny: true, book: st.complete ? (st.isRedBook ? 'book-red' : 'book-black') : null });
    el.style.zIndex = String(ordered.length - i);
    if (isFreshPlay(card) || (!expanded && ordered.some(isFreshPlay))) el.classList.add('just-played');
    if (!expanded) {
      el.classList.add('closed-book-face'); meldWildTrims(el, wilds);
      el.setAttribute('aria-label', head.title);
    }
    cards.appendChild(el);
  });
  if (presentation === 'tile') meldWildTrims(box, wilds);
  box.appendChild(head); box.appendChild(cards);
  if (target) box.setAttribute('aria-pressed', String(meldTargetId === m.id));
  box.onclick = function (event) {
    if (own && !actionPending && canAddSelection(m)) chooseMeldTarget(m.id, event);
    else toggleMeldDisplay(m, seat, event);
  };
  return box;
}

function fillMelds(ms, s) {
  ms.innerHTML = '';
  ms.style.setProperty('--opponent-meld-count', s.melds.length);
  ms.dataset.layout = opponentMeldStyle === 'tiles' ? 'tiles' : 'strips';
  var seat = view.seats.indexOf(s), fresh = false;
  orderMelds(s.melds).forEach(function (m) {
    ms.appendChild(meldDisplayElement(m, seat, false));
    if (m.cards.some(isFreshPlay)) fresh = true;
  });
  return fresh;
}

function applyOpponentMeldStyle() {
  seatNodes.forEach(function (node) {
    if (node.melds) node.melds.dataset.layout = opponentMeldStyle === 'tiles' ? 'tiles' : 'strips';
  });
  $('myMelds').dataset.layout = opponentMeldStyle;
}

function setOpponentMeldStyle(style) {
  if (style !== 'cards' && style !== 'tiles') return false;
  opponentMeldStyle = style; meldExpanded = Object.create(null);
  set('hf_meld_style', style); set('hf_opponent_melds', style);
  if (view) render();
  renderRules(); scheduleBoardSize();
  return true;
}

function setFinishedBookStyle(style) {
  if (style !== 'stacked' && style !== 'spread') return false;
  finishedBookStyle = style; meldExpanded = Object.create(null);
  set('hf_finished_books', style);
  if (view) render();
  renderRules(); scheduleBoardSize();
  return true;
}

function renderSeats() {
  var wrap = $('seats');
  // The stylesheet uses seat count for the surrounding table layout.
  wrap.dataset.seats = view.seats.length;
  // Seats only change in number between games, so that is the one time the
  // whole thing starts over.
  if (seatNodes.length !== view.seats.length) {
    wrap.innerHTML = '';
    seatNodes = view.seats.map(function (_, i) {
      var d = document.createElement('div');
      var toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'seat-expand';
      toggle.setAttribute('aria-controls', 'opponentDetail');
      toggle.onclick = function () {
        if (i === meSeat()) return;
        expandedSeat = expandedSeat === i ? null : i;
        renderOpponentDetail();
      };
      var top = document.createElement('div'); top.className = 'seat-top';
      var identity = document.createElement('div'); identity.className = 'seat-identity';
      var nm = document.createElement('span'); nm.className = 'seat-name';
      var chips = document.createElement('div'); chips.className = 'chips';
      identity.appendChild(nm);
      var stats = document.createElement('div'); stats.className = 'seat-subtop';
      var meta = document.createElement('span'); meta.className = 'seat-meta';
      var points = document.createElement('span'); points.className = 'seat-points';
      stats.appendChild(points); identity.appendChild(meta);
      stats.hidden = true;
      top.appendChild(identity); top.appendChild(chips);
      d.appendChild(top); d.appendChild(stats); d.appendChild(toggle);
      wrap.appendChild(d);
      return { seat: d, name: nm, meta: meta, points: points, chips: chips, toggle: toggle, melds: null, sig: null };
    });
  }

  view.seats.forEach(function (s, i) {
    var n = seatNodes[i];

    n.name.textContent = s.name + (i === meSeat() && !view.solo ? ' (you)' : '');
    // Short enough that a seat's badges still fit beside it on a phone.
    n.meta.textContent = view.phase === 'lobby'
      ? (s.seated ? 'seated' : 'empty')
      : s.handCount + ' hand · ' + s.footCount + ' foot';
    n.meta.title = s.handCount + ' cards in hand, ' +
      (s.inFoot ? 'already in their foot' : s.footCount + ' waiting in their foot');
    var bonus = (s.redBooks || 0) * view.settings.redBookBonus +
      (s.blackBooks || 0) * view.settings.blackBookBonus;
    n.points.textContent = publicMeldedPoints(s) + ' melded';
    n.points.title = 'Face-up card points, excluding ' + bonus + ' points in completed-book bonuses.';
    n.points.hidden = view.phase === 'lobby';
    n.toggle.hidden = i === meSeat();
    n.toggle.setAttribute('aria-label', s.name + (view.phase === 'playing' && view.turn === i ? ', current turn' : '') + ', ' + n.meta.textContent +
      (s.inFoot ? ', in foot' : '') +
      (n.points.hidden ? '' : ', ' + n.points.textContent) + '. Show public books');

    n.chips.innerHTML = '';
    seatChips(s, false).forEach(function (c) {
      if (/(?:^|\s)(red|black|foot)(?:\s|$)/.test(c.className)) n.chips.appendChild(c);
    });
    n.chips.hidden = !n.chips.children.length;

    var fresh = false;
    if (!s.melds.length) {
      if (n.melds) { n.melds.remove(); n.melds = null; n.sig = null; }
    } else {
      var sig = meldsSignature(s);
      if (!n.melds) {
        n.melds = document.createElement('div');
        n.melds.className = 'melds';
        n.seat.appendChild(n.melds);
        n.sig = null;
      }
      // Untouched when nothing about the public books has changed.
      if (sig !== n.sig) {
        fillMelds(n.melds, s);
        n.sig = sig;
      }
      // The signature marks fresh cards, so it also answers whether this seat
      // is mid-flash — no need to read that back off the element.
      fresh = sig.indexOf('*') !== -1;
    }

    n.seat.className = 'seat' +
      (view.phase === 'playing' && view.turn === i ? ' active' : '') +
      (i === meSeat() ? ' me' : '') +
      (fresh ? ' just-played-seat' : '');
  });
  applyOpponentMeldStyle();
  renderOpponentDetail();
}

function closeOpponentDetail(restoreFocus) {
  var previous = expandedSeat;
  expandedSeat = null;
  if ($('opponentDetail')) $('opponentDetail').hidden = true;
  seatNodes.forEach(function (node) { node.toggle.setAttribute('aria-expanded', 'false'); });
  if (restoreFocus && seatNodes[previous]) seatNodes[previous].toggle.focus({ preventScroll: true });
}

function positionOpponentDetail() {
  var panel = $('opponentDetail');
  if (!panel || panel.hidden || !seatNodes[expandedSeat]) return;
  var board = document.querySelector('.board');
  var row = seatNodes[expandedSeat].seat.getBoundingClientRect();
  var bounds = board.getBoundingClientRect();
  var handTop = $('myHand').getBoundingClientRect();
  panel.style.top = Math.round(row.bottom - bounds.top + board.scrollTop + 4) + 'px';
  panel.style.maxHeight = Math.max(32, Math.floor(handTop.top - row.bottom - 10)) + 'px';
}

function renderOpponentDetail() {
  if (!view) return;
  if (expandedSeat === meSeat() || !view.seats[expandedSeat]) expandedSeat = null;
  seatNodes.forEach(function (node, i) {
    node.toggle.setAttribute('aria-expanded', i === expandedSeat ? 'true' : 'false');
  });
  if (expandedSeat === null) {
    if ($('opponentDetail')) $('opponentDetail').hidden = true;
    return;
  }
  var panel = $('opponentDetail');
  if (!panel) {
    panel = document.createElement('section'); panel.id = 'opponentDetail'; panel.className = 'opponent-detail';
    panel.setAttribute('aria-labelledby', 'opponentDetailTitle');
    var head = document.createElement('div'); head.className = 'opponent-detail-head';
    var title = document.createElement('h3'); title.id = 'opponentDetailTitle';
    var close = btn('Close', function () { closeOpponentDetail(true); }, true);
    close.id = 'closeOpponentDetail'; close.classList.add('sm');
    head.appendChild(title); head.appendChild(close); panel.appendChild(head);
    var counts = document.createElement('p'); counts.id = 'opponentCounts'; counts.className = 'note';
    var cards = document.createElement('div'); cards.id = 'opponentMelds'; cards.className = 'opponent-melds';
    panel.appendChild(counts); panel.appendChild(cards);
    document.querySelector('.board').appendChild(panel);
  }
  var seat = view.seats[expandedSeat];
  panel.hidden = false; panel.dataset.seat = String(expandedSeat);
  $('opponentDetailTitle').textContent = seat.name + '’s public books';
  // Private hand/foot contents are never used to build this panel.
  $('opponentCounts').textContent = publicMeldedPoints(seat) + ' melded · ' + seat.handCount + ' in hand · ' +
    (seat.inFoot ? 'playing their foot' : seat.footCount + ' in foot') + ' · private cards hidden';
  var wrap = $('opponentMelds');
  var signature = expandedSeat + ':' + meldsSignature(seat);
  if (wrap.dataset.signature !== signature) {
    var scroll = panel.scrollTop;
    wrap.innerHTML = ''; wrap.dataset.signature = signature;
    if (!seat.melds.length) {
      var empty = document.createElement('p'); empty.className = 'note';
      empty.textContent = 'No melds laid yet.'; wrap.appendChild(empty);
    }
    orderMelds(seat.melds).forEach(function (meld) {
      var stats = meldStatsOf(meld);
      var box = document.createElement('div');
      box.className = 'meld ' + (stats.wilds ? 'dirty' : 'clean') + (stats.complete ? ' done' : '') + (meld.cards.length === view.settings.bookSize - 1 ? ' nearly-book' : '');
      if (meld.cards.length === view.settings.bookSize - 1) box.title = 'One card from a book';
      var label = document.createElement('div'); label.className = 'meld-top';
      label.textContent = capRank(meld.rank) + 's · ' + meld.cards.length +
        (stats.complete ? (stats.isRedBook ? ' · red book' : ' · black book') : '/' + view.settings.bookSize);
      var cards = document.createElement('div'); cards.className = 'meld-cards';
      orderMeldCards(meld).forEach(function (card) {
        cards.appendChild(cardEl(card, { tiny: true,
          book: stats.complete ? (stats.isRedBook ? 'book-red' : 'book-black') : null }));
      });
      box.appendChild(label); box.appendChild(cards); wrap.appendChild(box);
    });
    panel.scrollTop = scroll;
  }
  scheduleBoardSize();
}

function stackbox(tag, cardNode, count, opts) {
  opts = opts || {};
  var box = document.createElement(opts.click ? 'button' : 'div');
  box.className = 'stackbox' + (opts.click ? ' pick' : '') + (opts.on ? ' on' : '') +
    (opts.out ? ' out' : '') + (opts.cls ? ' ' + opts.cls : '');
  var t = document.createElement('div'); t.className = 'tag'; t.textContent = tag;
  var c = document.createElement('div'); c.className = 'pilecount'; c.textContent = count;
  box.appendChild(t); box.appendChild(cardNode); box.appendChild(c);
  if (opts.title) box.title = opts.title;
  if (opts.click) {
    box.type = 'button'; box.onclick = opts.click;
    box.setAttribute('aria-label', tag + ', ' + count +
      (typeof count === 'number' ? ' card' + (count === 1 ? '' : 's') : ''));
    if (opts.selectable) box.setAttribute('aria-pressed', opts.on ? 'true' : 'false');
  }
  return box;
}

/* The discard pile, with its depth showing.
 *
 * How many cards are in there is the whole reason to want it, and it used to be
 * a number you had to read. Cards stack up behind the top one instead, so the
 * pile grows on screen the way it grows on the table. The steps are powers of
 * two because that is roughly how the difference feels: eight cards and nine
 * are the same pile, eight and sixteen are not. */
function discardPile(topNode, count) {
  var wrap = document.createElement('div');
  wrap.className = 'pile';
  var layers = count > 1 ? Math.min(4, Math.floor(Math.log(count) / Math.log(2))) : 0;
  for (var i = layers; i >= 1; i--) {
    var l = document.createElement('div');
    l.className = 'pile-layer';
    l.style.setProperty('--n', i);
    wrap.appendChild(l);
  }
  wrap.appendChild(topNode);
  return wrap;
}

function livePiles() {
  var out = [];
  (view.stocks || []).forEach(function (n, i) { if (n > 0) out.push(i); });
  return out;
}

function selectDrawPile(index) {
  if (actionPending || !isMyTurn() || view.turnPhase !== 'draw' || !view.stocks[index]) return;
  notice = ''; noticeBad = false;
  if (view.settings.stockPiles === 1) { pileSel = [index, index]; render(); return; }
  var at = pileSel.indexOf(index);
  if (at !== -1) pileSel.splice(at, 1);
  else if (pileSel.length < view.settings.drawCount) pileSel.push(index);
  else { notice = 'Two piles selected. Tap a selected pile to change it.'; }
  render();
}

function renderCenter() {
  var row = $('centerRow');
  var focusedId = document.activeElement && row.contains(document.activeElement) ? document.activeElement.id : null;
  row.innerHTML = ''; row.className = 'center pickup-zone';
  row.style.setProperty('grid-template-columns', 'repeat(' + ((view.stocks || []).length + 1) + ', minmax(0, 1fr))');
  var live = livePiles();
  var choosing = isMyTurn() && view.turnPhase === 'draw' && !actionPending;
  (view.stocks || []).forEach(function (count, index) {
    var box = document.createElement('button'); box.type = 'button';
    var selected = view.turnPhase === 'draw' && pileSel.indexOf(index) !== -1;
    box.id = 'drawPile' + index;
    box.className = 'stock-choice' + (selected ? ' selected' : '') + (!count ? ' empty-stock' : '');
    box.disabled = !choosing || !count;
    box.setAttribute('aria-pressed', selected ? 'true' : 'false');
    box.setAttribute('aria-label', 'Draw pile ' + (index + 1) + ', ' + count + ' card' + (count === 1 ? '' : 's'));
    var label = document.createElement('span'); label.className = 'pickup-label'; label.textContent = view.settings.stockPiles === 1 ? 'Stock' : 'Pile ' + (index + 1);
    var back = document.createElement('span'); back.className = count ? 'card back' : 'card empty';
    var number = document.createElement('span'); number.className = 'pile-index'; number.textContent = String(index + 1); back.appendChild(number);
    var quantity = document.createElement('span'); quantity.className = 'pickup-count'; quantity.textContent = count ? String(count) : 'Empty';
    box.appendChild(label); box.appendChild(back); box.appendChild(quantity);
    box.onclick = function () {
      if (live.length < view.settings.distinctDrawPiles) {
        notice = 'Only one pile remains. Press Draw 2 to draw from it.'; renderActions();
      } else selectDrawPile(index);
    };
    row.appendChild(box);
  });
  var top = view.discardTop;
  var frozen = top && (E.isWild(top) || E.isBlackThree(top) || E.isRedThree(top));
  var preview = view.settings.revealPileTake && view.discardPeek && view.discardPeek.length;
  var box = document.createElement(top ? 'button' : 'div');
  if (top) { box.type = 'button'; box.onclick = showPeek; }
  box.className = 'discard-choice' + (frozen ? ' frozen' : '') + (top ? ' inspectable' : '');
  box.id = 'discardPreview';
  var why = frozen ? E.label(top) + ' freezes the discard pile. It cannot be picked up until covered.'
    : 'Open the pile to inspect it and confirm a pickup. Matching cards are chosen automatically.';
  box.title = why;
  box.setAttribute('aria-label', 'Discard pile, ' + view.discardCount + ' card' + (view.discardCount === 1 ? '' : 's') + (top ? ', ' + spokenCard(top) + ' on top' : '') + (frozen ? ', frozen' : '') + (top ? '. Open pile' : ''));
  var label = document.createElement('span'); label.className = 'pickup-label'; label.textContent = frozen ? 'Frozen' : 'Discard';
  var face = top ? cardEl(top, {}) : document.createElement('div');
  if (!top) face.className = 'card empty';
  var summary = document.createElement('span'); summary.className = 'discard-summary';
  var quantity = document.createElement('span'); quantity.className = 'discard-count'; quantity.textContent = view.discardCount + ' card' + (view.discardCount === 1 ? '' : 's');
  var status = document.createElement('span'); status.className = 'discard-status';
  status.textContent = frozen ? 'Frozen' : top ? (preview ? 'View cards' : 'Open pile') : 'Empty';
  summary.appendChild(quantity); summary.appendChild(status);
  box.appendChild(label); box.appendChild(discardPile(face, view.discardCount)); box.appendChild(summary);
  row.appendChild(box);
  var replacement = focusedId && $(focusedId);
  if (replacement && !replacement.disabled && replacement.tagName.toLowerCase() === 'button') replacement.focus({ preventScroll: true });
}

function spokenCard(card) {
  if (E.isJoker(card)) return E.label(card);
  var ranks = { A: 'ace', K: 'king', Q: 'queen', J: 'jack', T: 'ten' };
  var suits = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
  return (ranks[E.rankOf(card)] || E.rankOf(card)) + ' of ' + suits[card[1]];
}

function meldTapSignature(target) {
  return JSON.stringify([view.code, view.round, view.turn, view.phase, view.turnPhase,
    view.you, view.turnState, view.settings, myMelds(), target.id, sel.slice().sort()]);
}

function quickMeldStopReason(target, rank) {
  var you = view.you, S = view.settings;
  var remaining = myHand().length - sel.length;
  if (!you.inFoot && remaining > 0) return '';
  if (!you.inFoot) remaining = you.footCount || 0;
  if (S.goOutWithDiscard && you.inFoot && remaining === 0) return 'Keep one card for your final discard.';
  if (remaining >= 2) return '';
  var red = 0, black = 0;
  var afterMelds = myMelds().map(function (meld) {
    return target && meld.id === target.id ? { rank: meld.rank, cards: meld.cards.concat(sel) } : meld;
  });
  if (!target) afterMelds.push({ rank: rank, cards: sel });
  afterMelds.forEach(function (after) {
    var stats = E.meldStats(after, S);
    if (stats.isRedBook) red++;
    if (stats.isBlackBook || stats.isWildBook) black++;
  });
  if (red < S.requireRedBook || black < S.requireBlackBook) return 'Keep two cards in your foot unless you can go out.';
  var laid = view.turnState ? view.turnState.melded || 0 : 0;
  if (!remaining && !you.hasInitialMeld &&
      laid + sel.reduce(function (total, card) { return total + E.cardValue(card, S); }, 0) < view.minMeld) {
    return 'Reach the opening minimum before going out.';
  }
  return '';
}

function chooseMeldTarget(id, event) {
  if (actionPending) { lastMeldTap = null; return; }
  var target = myMelds().find(function (meld) { return meld.id === id; });
  if (!target || !canAddSelection(target) || new Set(sel).size !== sel.length ||
      sel.some(function (card) { return myHand().indexOf(card) === -1; })) {
    lastMeldTap = null; return;
  }
  var pointerTap = event && event.detail > 0;
  var now = Date.now(), signature = meldTapSignature(target);
  var quickRepeat = pointerTap && lastMeldTap && lastMeldTap.id === id &&
    lastMeldTap.signature === signature && now >= lastMeldTap.at && now - lastMeldTap.at <= 400;
  if (quickRepeat) {
    lastMeldTap = null;
    var reason = quickMeldStopReason(target);
    if (reason) { say(reason, true); return; }
    act('meldAdd', { meldId: target.id, cards: sel.slice() });
    return;
  }
  // Keep gesture state outside the DOM: selecting the destination rebuilds its
  // button, and touch browsers need not dispatch a native dblclick afterward.
  lastMeldTap = pointerTap ? { id: id, at: now, signature: signature } : null;
  meldTargetId = id; renderMine(); renderActions(); scheduleBoardSize();
  if (event && event.detail === 0) {
    var replacement = Array.prototype.find.call($('myMelds').querySelectorAll('button'), function (button) {
      return button.dataset.meldId === id;
    });
    if (replacement) replacement.focus({ preventScroll: true });
  }
}

function canAddSelection(m) {
  if (!isMyTurn() || view.turnPhase !== 'play' || !sel.length) return false;
  var stats = meldStatsOf(m);
  if (stats.complete && view.settings.closedBooksLocked) return false;
  if (stats.isRedBook && sel.some(E.isWild)) return false;
  return E.checkMeld(m.rank, m.cards.concat(sel), view.settings).ok;
}

function renderMine() {
  var wrap = $('myMelds');
  var melds = myMelds();
  var canTarget = isMyTurn() && view.turnPhase === 'play' && sel.length > 0 && !actionPending;
  if (!melds.some(function (meld) { return meld.id === meldTargetId && canAddSelection(meld); })) meldTargetId = null;

  // Only tables using automatic layoff have a separate red-three pile.
  var threes = (view.you && view.you.redThrees) || [];
  var me = meSeat() >= 0 ? view.seats[meSeat()] : null;
  var signature = JSON.stringify([view.code, view.round, view.phase, view.turn, view.turnPhase,
    view.settings, actionPending, sel, meldTargetId, melds, threes, opponentMeldStyle, finishedBookStyle, meldExpanded,
    me && [me.redBooks, me.blackBooks, me.inFoot], Object.keys(freshPlays).filter(function (card) {
      return melds.some(function (meld) { return meld.cards.indexOf(card) !== -1; });
    })]);
  if (signature === mineSignature) {
    renderHand(); $('clearSel').hidden = sel.length === 0; return;
  }
  mineSignature = signature;
  wrap.innerHTML = '';
  if (threes.length) {
    var tb = document.createElement('div');
    tb.className = 'meld threes';
    tb.style.setProperty('--meld-count', threes.length);
    var th = document.createElement('div'); th.className = 'meld-top';
    th.textContent = 'Red threes · ' + num(laidRedThreeValue()) + ' each';
    var tc = document.createElement('div'); tc.className = 'meld-cards';
    tc.style.setProperty('--meld-count', threes.length);
    threes.forEach(function (c) {
      tc.appendChild(cardEl(c, { tiny: true, title: E.label(c) + ' · ' + num(laidRedThreeValue()) + ' points' }));
    });
    tb.appendChild(th); tb.appendChild(tc);
    wrap.appendChild(tb);
  }

  /* Empty is a state worth designing, not a sentence dropped at the top of a
     tall blank band. The class centres it and draws the outline of the books
     that will land there; the second line says what has to happen first. */
  wrap.classList.toggle('empty', !melds.length && !threes.length);
  if (!melds.length && !threes.length) {
    var empty = document.createElement('p');
    empty.className = 'note';
    var lead = document.createElement('b');
    lead.textContent = 'Nothing down yet';
    empty.appendChild(lead);
    empty.appendChild(document.createTextNode(
      view.phase === 'playing'
        ? 'Books you lay will show up here.'
        : 'Books will show up here once the round starts.'));
    wrap.appendChild(empty);
  }

  orderMelds(melds).forEach(function (m) {
    var box = meldDisplayElement(m, meSeat(), true);
    if (minePainted && !seenMelds[m.id]) box.classList.add('land');
    seenMelds[m.id] = 1;
    wrap.appendChild(box);
  });

  $('meldHint').textContent = canTarget && melds.some(canAddSelection)
    ? (meldTargetId ? 'Book selected. Add below, or double-tap the book.' : 'Choose a book, then Add below. Double-tap a book to add directly.')
    : '';

  var mc = $('myChips'); mc.innerHTML = '';
  var meSeatObj = meSeat() >= 0 ? view.seats[meSeat()] : null;
  $('myMeldedPoints').textContent = (meSeatObj ? publicMeldedPoints(meSeatObj) : 0) + ' melded';
  $('myMeldedPoints').title = 'Face-up card points, excluding book bonuses.';
  if (meSeatObj) {
    seatChips(meSeatObj, false).forEach(function (c) {
      if (/(?:^|\s)(red|black|foot)(?:\s|$)/.test(c.className)) mc.appendChild(c);
    });
  }

  renderHand();
  $('clearSel').hidden = sel.length === 0;
  minePainted = true;
}

/* CSS packs each book by its actual fan width. Only measure overflow here:
 * selecting cards or opening several books must never resize any card faces. */
function fitMine() {
  var wrap = $('myMelds');
  if (!wrap || wrap.clientWidth < 1 || wrap.clientHeight < 8) return;
  wrap.dataset.bookSize = 'regular';
  wrap.dataset.compact = 'false';
  wrap.dataset.bookLayout = 'flow';
  wrap.dataset.bookOverflow = wrap.scrollHeight > wrap.clientHeight + 1 ? 'true' : 'false';
}

/* The hand, in whichever arrangement this player prefers.
 *
 * Cards picked up this turn are held back and shown last — their own row when
 * layered, set apart by a gap when spread — so you can always tell at a glance
 * what just arrived, whatever the sort is doing to everything else. */
function renderHand() {
  var wrap = $('myHand');
  wrap.dataset.count = String(myHand().length);
  var fresh = justPicked();
  var structure = [view.code, view.round, meSeat(), myHand().join(','), fresh.join(','),
    sortMode, handLayout, view.you && view.you.inFoot, view.you && view.you.footCount, redThreePenalty()].join('|');
  var signature = structure + '|' + sel.join(',');
  if (signature === handSignature && !dealPending) return;
  if (structure === handStructureSignature && !dealPending && wrap.querySelectorAll('[data-card]').length === myHand().length) {
    wrap.querySelectorAll('[data-card]').forEach(function (card) {
      var selected = sel.indexOf(card.dataset.card) !== -1;
      card.classList.toggle('sel', selected);
      card.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    handSignature = signature;
    return;
  }
  handStructureSignature = structure;
  var oldScroll = wrap.scrollTop;
  var active = document.activeElement;
  var focusedCard = active && wrap.contains(active) ? active.dataset.card : null;
  var priorIds = Array.prototype.map.call(wrap.querySelectorAll('[data-card]'), function (el) { return el.dataset.card; });
  var arriving = myHand().some(function (c) { return priorIds.indexOf(c) === -1; });
  handSignature = signature;
  wrap.innerHTML = '';
  wrap.className = 'hand' + (handLayout === 'layered' ? ' layered' : '');

  var settled = myHand().filter(function (c) { return fresh.indexOf(c) === -1; });

  var dealing = dealPending;
  var dealt = 0;

  var make = function (c, isFresh, firstFresh) {
    var el = cardEl(c, {
      click: function () {
        notice = ''; noticeBad = false;
        toggleHandCard(c);
        render();
      },
      selected: sel.indexOf(c) !== -1,
      title: E.label(c) + ' · ' +
        (E.isRedThree(c) ? num(redThreePenalty()) + ' if you are still holding it — discard it' : E.cardValue(c, view ? view.settings : E.DEFAULTS) + ' points') +
        (isFresh ? ' · just picked up' : ''),
    });
    if (isFresh) el.classList.add('fresh');
    if (firstFresh) el.classList.add('fresh-first');
    /* Dealt: the whole hand arrives, staggered in the order it is laid out.
       Otherwise only a card you have not been shown before slides in, which is
       what makes the two you just drew move while the rest sit still. */
    if (dealing) {
      el.classList.add('deal');
      el.style.setProperty('--d', (dealt++ * 32) + 'ms');
    } else if (!enteredCards[c]) {
      el.classList.add('enter');
    }
    enteredCards[c] = 1;
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
      var freshRow;
      fresh.forEach(function (c, index) {
        if (index % PER_ROW === 0) {
          freshRow = document.createElement('div');
          freshRow.className = 'hand-row' + (index === 0 ? ' fresh-row' : '');
          wrap.appendChild(freshRow);
        }
        freshRow.appendChild(make(c, true, false));
      });
    }
  } else {
    sortHand(settled).forEach(function (c) { wrap.appendChild(make(c, false, false)); });
    fresh.forEach(function (c, i) { wrap.appendChild(make(c, true, i === 0)); });
  }

  // A deal is spent once it has been drawn; the next paint is an ordinary one.
  dealPending = false;

  /* The hand builds upwards from the bottom edge, so when it is deep enough to
   * scroll the rows worth seeing are the last ones — the cards nearest your
   * thumb, including whatever you just picked up. */
  wrap.scrollTop = arriving ? wrap.scrollHeight : oldScroll;
  if (focusedCard) {
    var replacement = Array.prototype.find.call(wrap.querySelectorAll('[data-card]'), function (el) {
      return el.dataset.card === focusedCard;
    });
    if (replacement) replacement.focus({ preventScroll: true });
  }

  var n = myHand().length;
  $('myBookCounts').textContent = n + ' hand · ' + (view.you ? view.you.footCount : 0) + ' foot';
  $('handPill').textContent = 'Your hand';
  $('handPill').setAttribute('aria-label', n + ' cards in hand, ' + (view.you ? view.you.footCount : 0) +
    ' cards in foot' + (fresh.length ? ', ' + fresh.length + ' newly drawn' : ''));
  $('handPill').title = fresh.length
    ? 'The ' + fresh.length + ' card' + (fresh.length > 1 ? 's' : '') +
      ' you just picked up sit last, outlined in mint. Selected cards have a gold outline.'
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
  b.type = 'button';
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
  var bar = $('actionBar');
  var persistent = $('actionHint');
  if (!persistent || !bar.contains(persistent)) {
    persistent = document.createElement('div'); persistent.id = 'actionHint';
    persistent.setAttribute('aria-live', 'polite'); bar.appendChild(persistent);
  }
  Array.prototype.slice.call(bar.children).forEach(function (child) { if (child !== persistent) bar.removeChild(child); });
  bar.dataset.ownTurn = view.phase === 'playing' && isMyTurn() ? 'true' : 'false';
  var hint = document.createElement('div');
  hint.className = 'hint' + (noticeBad ? ' warn' : '');
  // This draft is never mounted; only changed final content reaches the live region.
  try {
  if (isMyTurn()) hint.dataset.phase = view.turnPhase === 'draw' ? 'Draw' : 'Select cards';

  if (view.phase === 'lobby') {
    hint._format = 'textContent'; hint.textContent = view.seated < 2
      ? 'Waiting for players — ' + view.seated + ' of ' + view.seats.length + ' seated.'
      : view.seated + ' of ' + view.seats.length + ' seated. Deal when everyone is in.';

    var deal = btn('Deal the first round', function () { act('start'); });
    deal.disabled = view.seated < 2;
    bar.appendChild(deal);
    return;
  }

  if (view.phase === 'roundEnd') {
    hint._format = 'textContent'; hint.textContent = view.outSeat != null
      ? view.seats[view.outSeat].name + ' went out.'
      : 'The cards ran out — the round ends there.';

    bar.appendChild(btn('Next round', function () {
      $('scoreSheet').hidden = true; act('nextRound');
    }));
    return;
  }

  if (view.phase === 'gameEnd') {
    hint._format = 'textContent'; hint.textContent = 'Four rounds played.';

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
    hint._format = 'textContent'; hint.textContent = notice || (turnSeat.bot
      ? turnSeat.name + ' is thinking\u2026'
      : 'Waiting on ' + turnSeat.name + '.');

    return;
  }

  var S = view.settings;

  if (view.turnPhase === 'draw') {
    var live = livePiles();
    var singleStock = S.stockPiles === 1;
    var spread = !singleStock && live.length >= S.distinctDrawPiles;
    var left = S.drawCount - pileSel.length;

    /* Kept short so the bar stays one line on a phone, with the rest of each
     * rule on the button it belongs to as a tooltip — except the pile, which is
     * a play you can miss entirely, so it is spelled out below. */
    var chance = pileChance();
    if (notice) { hint._format = 'innerHTML'; hint.innerHTML = esc(notice); }
    else if (!live.length) {
      hint._format = 'textContent'; hint.textContent = 'No stock cards left.';
    } else if (singleStock) {
      hint._format = 'textContent'; hint.textContent = 'Draw two from the stock.';
    } else if (!spread) {
      hint._format = 'innerHTML'; hint.innerHTML = 'Only pile <b>' + (live[0] + 1) + '</b> left — both cards come from it.';
    } else if (left > 0) {
      hint._format = 'innerHTML'; hint.innerHTML = pileSel.length
        ? 'Pick <b>1 more pile</b>.'
        : 'Pick <b>2 different piles</b>.';
    } else {
      hint._format = 'innerHTML'; hint.innerHTML = 'Drawing from piles <b>' +
        pileSel.map(function (i) { return i + 1; }).join('</b> and <b>') + '</b>.';
    }

    /* You are holding what the pile costs. Say so, and say what to tap — a
     * tooltip cannot reach anyone on a phone. */
    if (!notice && chance) {
      var cards = chance.take + ' card' + (chance.take === 1 ? '' : 's');
      hint._format = 'innerHTML';
      hint.innerHTML += ' Or open <b>Take pile</b> for ' + cards + '.';
    }


    var validDraw = live.length && (!spread || (left === 0 &&
      new Set(pileSel).size >= Math.min(S.distinctDrawPiles, S.drawCount) &&
      pileSel.every(function (index) { return live.indexOf(index) !== -1; })));
    if (validDraw) {
      var d = btn('Draw ' + S.drawCount, function () {
        act('draw', { piles: singleStock ? [live[0], live[0]] : spread ? pileSel.slice() : [] });
      });
      d.id = 'drawAction'; d.classList.add('action-primary'); d.disabled = actionPending;
      d.title = singleStock ? 'Draw both cards from the stock.' : spread
        ? 'Your two cards must come from two different draw piles.'
        : 'One pile left, so the two-different-piles rule relaxes.';
      bar.appendChild(d);
    }
    if (chance) {
      var take = btn('Take pile · ' + chance.take + ' card' + (chance.take === 1 ? '' : 's'), showPeek, true);
      take.id = 'takePileAction'; take.classList.add('action-secondary'); take.disabled = actionPending;
      take.title = 'Open the pile, then confirm. The matching natural cards are chosen automatically.';
      bar.appendChild(take);
    }
    return;
  }

  // play phase
  var msgs = sel.length ? [] : ['Select cards to play.'];
  if (sel.length) {
    if (sel.some(function (c) { return E.rankOf(c) === '3'; })) {
      msgs.push('Threes cannot meld. Select one to discard.');
    } else {
      msgs.push(sel.length + ' selected · ' + sel.reduce(function (n, c) { return n + E.cardValue(c, view ? view.settings : E.DEFAULTS); }, 0) + ' points.');
      var selectionRank = selRank();
      if (sel.length > 1 && !myMelds().some(canAddSelection)) {
        var selectionCheck = selectionRank ? E.checkMeld(selectionRank, sel, S) : null;
        if (!selectionCheck) msgs.push('Match one rank; twos and jokers are wild.');
        else if (!selectionCheck.ok) msgs.push(selectionCheck.reason);
      }
    }
  }
  if (view.you && !view.you.hasInitialMeld) {
    // The running total against the round's minimum, and nothing else — the
    // header already carries the number, and the rule is in the lobby notes.
    msgs.push('Down needs ' + view.minMeld + ' · laid ' +
      (view.turnState ? view.turnState.melded : 0) + '.');
  }
  if (view.you && view.you.inFoot) {
    if (view.you.canGoOut.ok) {
      msgs.push(S.goOutWithDiscard ? 'Books complete. Keep one card for your final discard.' : 'Books complete. Go out by melding every remaining card.');
    } else {
      msgs.push('To go out: ' + String(view.you.canGoOut.reason || '').toLowerCase());
      /* The keep-two rule only ever bites at the bottom of a hand, so it is
       * only worth a line when you are nearly there. */
      if (view.you.hand.length <= 3) {
        msgs.push(view.you.hand.length <= 2
          ? 'Down to your last two — discard one and hold the other.'
          : 'Keep two back: you cannot empty your hand without going out.');
      }
    }
  }
  hint._format = 'innerHTML'; hint.innerHTML = notice ? esc(notice) : esc(msgs.join(' '));


  var r = selRank();
  var have = myMelds().some(function (m) { return m.rank === r && !meldStatsOf(m).complete; });
  var ownedSelection = sel.length > 0 && new Set(sel).size === sel.length &&
    sel.every(function (card) { return myHand().indexOf(card) !== -1; });
  var eligible = ownedSelection ? myMelds().filter(function (meld) {
    return canAddSelection(meld) && !quickMeldStopReason(meld);
  }) : [];
  var target = eligible.find(function (meld) { return meld.id === meldTargetId; });
  var chk = r && sel.length >= 3 && !have && ownedSelection ? E.checkMeld(r, sel, S) : null;
  var newMeldStop = chk && chk.ok ? quickMeldStopReason(null, r) : '';
  if (chk && chk.ok && !newMeldStop && !target) {
    var mb = btn('Meld ' + sel.length + ' ' + E.rankName(r) + 's', function () {
      act('meldNew', { rank: r, cards: sel.slice() });
    });
    mb.id = 'meldAction'; mb.classList.add('action-primary');
    mb.disabled = actionPending;
    bar.appendChild(mb);
    hint.dataset.phase = 'Meld';
  }

  if (target) {
    var add = btn('Add ' + sel.length + ' to ' + E.rankName(target.rank) + 's', function () {
      act('meldAdd', { meldId: target.id, cards: sel.slice() });
    });
    add.id = 'addToBookAction'; add.classList.add('action-primary'); add.disabled = actionPending;
    bar.appendChild(add);
    hint.dataset.phase = 'Meld';
  } else if (eligible.length && !notice) {
    hint.innerHTML += ' Choose a book to add the selected cards.';
  } else if (newMeldStop && !notice) {
    hint._format = 'textContent'; hint.textContent = newMeldStop;
  }

  if (sel.length === 1 && ownedSelection) {
    var shortOpening = view.you && !view.you.hasInitialMeld && view.turnState &&
      view.turnState.melded > 0 && view.turnState.melded < view.minMeld;
    var lastFootCard = view.you && view.you.inFoot && myHand().length === 1;
    var finalDiscardAllowed = lastFootCard && S.goOutWithDiscard && view.you.canGoOut.ok;
    if (shortOpening || (lastFootCard && !finalDiscardAllowed)) {
      var why = shortOpening ? 'Reach ' + view.minMeld + ' or take melds back before discarding.'
        : S.goOutWithDiscard ? 'Complete your required books before your final discard.' : 'Your last foot card must be melded, never discarded.';
      hint._format = 'textContent'; hint.textContent = why;
    } else if (view.turnState && view.turnState.drew && !(S.redThreeAutoLayOff && E.isRedThree(sel[0]))) {
      var discard = btn('Discard ' + E.label(sel[0]), function () {
        act('discard', { card: sel[0] });
      });
      discard.id = 'discardAction'; discard.classList.add('action-discard'); discard.disabled = actionPending;
      bar.appendChild(discard);
      if (!target) hint.dataset.phase = 'Discard';
    }
  }

  /* Undoing a pile take hands the whole pile back and returns you to the draw,
   * which is the only way out of taking it and then falling short of the
   * minimum. Say which one the button is about to do. */
  if (view.turnState && view.turnState.melded > 0) {
    var undo = btn(view.turnState.tookPile ? 'Undo pickup' : 'Undo melds',
      function () { act('undo'); }, true);
    undo.id = 'undoAction'; undo.classList.add('action-undo'); undo.disabled = actionPending;
    bar.appendChild(undo);
  }
  } finally {
    persistent.className = hint.className;
    if (hint.dataset.phase) persistent.dataset.phase = hint.dataset.phase;
    else delete persistent.dataset.phase;
    var format = hint._format || 'textContent';
    if (persistent.dataset.format !== format || persistent[format] !== hint[format]) persistent[format] = hint[format];
    persistent.dataset.format = format;
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

/* Inspect the discard and confirm a pickup. A closed-pile table reveals only
 * its public top card and the number of hidden cards, never their identities. */
function showPeek() {
  var sheet = $('peekSheet');
  if (!view || !view.discardTop) { sheet.hidden = true; delete sheet.dataset.takePending; return; }
  // An accepted pickup moves out of draw. A refused pickup stays open so its
  // reason and the current legal options remain visible.
  if (sheet.dataset.takePending === 'true' && (!isMyTurn() || view.turnPhase !== 'draw')) {
    sheet.hidden = true; delete sheet.dataset.takePending; return;
  }
  if (!actionPending) delete sheet.dataset.takePending;
  closeSortPopover(false);
  closeAutoDrawPopover(false, false);
  var body = $('peekBody');
  var active = document.activeElement;
  var restoreConfirm = active && body.contains(active) && active.id === 'confirmPileTake';
  body.innerHTML = '';
  var top = view.discardTop;
  var takeCount = Math.min(view.settings.pileTakeExtra + 1, view.discardCount);
  var revealed = !!(view.settings.revealPileTake && view.discardPeek && view.discardPeek.length);
  var cards = revealed ? view.discardPeek.slice().reverse() : [top];
  var frozen = E.isWild(top) || E.isBlackThree(top) || E.isRedThree(top);
  var chance = pileChance();
  var myDraw = isMyTurn() && view.turnPhase === 'draw';
  var context = [view.code, view.round, view.turn, top].join(':');
  $('peekTitle').textContent = 'Discard pile · ' + takeCount + ' card' + (takeCount === 1 ? '' : 's');

  var lead = document.createElement('p');
  lead.className = 'note peek-explanation';
  lead.style.margin = '0 0 12px';
  lead.textContent = frozen
    ? 'The pile is frozen — ' + E.label(top) + ' on top means nobody can take it until it is covered.'
    : revealed ? 'These are the cards a pickup brings. The top card goes straight into your meld.'
      : takeCount > 1 ? 'Only the top card is visible. ' + (takeCount - 1) + ' more card' +
        (takeCount === 2 ? ' is' : 's are') + ' hidden by the table rule.'
        : 'This is the only card in the discard pile.';
  if (frozen && !revealed && takeCount > 1) lead.textContent += ' The next ' + (takeCount - 1) +
    ' card' + (takeCount === 2 ? ' is' : 's are') + ' hidden by the table rule.';
  body.appendChild(lead);

  var row = document.createElement('div'); row.className = 'peek-cards';
  cards.forEach(function (c, i) {
    var wrap = document.createElement('div'); wrap.className = 'peek-card';
    wrap.appendChild(cardEl(c, { title: E.label(c) + ' · ' + num(E.isRedThree(c) ? redThreePenalty() : E.cardValue(c, view ? view.settings : E.DEFAULTS)) + ' points' }));
    var cap = document.createElement('div'); cap.className = 'tag';
    cap.textContent = i === 0 ? 'top' : String(i);
    wrap.appendChild(cap); row.appendChild(wrap);
  });
  body.appendChild(row);

  var explanation = document.createElement('p');
  explanation.className = 'note peek-explanation'; explanation.id = 'pileTakeExplanation';
  if (noticeBad && notice) explanation.textContent = notice;
  else if (!isMyTurn()) explanation.textContent = 'You can inspect the pile now. Pickups are available on your turn before drawing.';
  else if (view.turnPhase !== 'draw') explanation.textContent = 'You already drew this turn. You can take the pile on a later turn.';
  else if (frozen) explanation.textContent = 'Draw from the stock piles instead.';
  else if (chance) {
    explanation.textContent = 'Uses ' + chance.cards.map(E.label).join(' and ') + ' from your hand automatically.';
    if (view.you && !view.you.hasInitialMeld) explanation.textContent += ' The meld counts toward your ' +
      view.minMeld + '-point opening; reach the minimum before discarding.';
  } else {
    var matching = myHand().filter(function (c) { return !E.isWild(c) && E.rankOf(c) === E.rankOf(top); }).length;
    explanation.textContent = matching < view.settings.pileNaturalsRequired
      ? 'You need ' + view.settings.pileNaturalsRequired + ' natural ' + E.rankName(E.rankOf(top)) + 's in your hand to take this pile.'
      : 'This pickup would leave too few cards to finish your turn legally. Draw from the stock piles instead.';
  }
  body.appendChild(explanation);

  var actions = document.createElement('div'); actions.className = 'peek-actions';
  var confirm = btn(actionPending && sheet.dataset.takePending === 'true' ? 'Taking…' : 'Take pile', function () {
    // A modal can outlive the turn or pile it opened on. Recheck the live view,
    // never the earlier hand selection or a stale offer captured by this button.
    if (!view) { sheet.hidden = true; return; }
    var fresh = pileChance();
    var current = [view.code, view.round, view.turn, view.discardTop].join(':');
    if (actionPending || !isMyTurn() || view.turnPhase !== 'draw' || !fresh || current !== context) {
      showPeek(); return;
    }
    confirm.disabled = true;
    if (act('pile', { cards: fresh.cards.slice() })) {
      sheet.dataset.takePending = 'true'; confirm.textContent = 'Taking…';
    } else showPeek();
  });
  confirm.id = 'confirmPileTake';
  confirm.disabled = actionPending || !myDraw || !chance;
  confirm.setAttribute('aria-describedby', 'pileTakeExplanation');
  actions.appendChild(confirm); body.appendChild(actions);
  sheet.hidden = false;
  if (restoreConfirm && !confirm.disabled) confirm.focus({ preventScroll: true });
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
    btn.id = 'preference-' + label.toLowerCase().replace(/\s+/g, '-') + '-' + o.id;
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
  s.style.background = 'linear-gradient(90deg, ' + t.lo + ' 0 33%, ' + t.hi + ' 33% 66%, ' + t.mid + ' 66% 100%)';
  return s;
}

function renderLook(body) {
  var h = document.createElement('h3');
  h.className = 'rule-head';
  h.textContent = 'Appearance';
  body.appendChild(h);

  var intro = document.createElement('div');
  intro.className = 'note';
  intro.style.marginBottom = '12px';
  intro.textContent = 'Your preferences are saved on this device.';
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
    if (nudgeOn && isMyTurn()) announceTurn();
  };
  var nlab = document.createElement('label');
  nlab.setAttribute('for', 'ruleNudge');
  var nt = document.createElement('div');
  nt.className = 'rule-title';
  nt.textContent = 'Show a notice when it is my turn';
  var nd = document.createElement('div');
  nd.className = 'note';
  nd.textContent = 'A brief reminder when your turn starts. Vibration on supported devices.';
  nlab.appendChild(nt); nlab.appendChild(nd);
  nbox.appendChild(nin); nbox.appendChild(nlab);
  body.appendChild(nbox);
}

function openRules(mode) {
  closeSortPopover(false);
  closeAutoDrawPopover(false, false);
  if ($('rulesSheet').hidden) rulesReturnFocus = document.activeElement;
  rulesMode = mode === 'settings' ? 'settings' : 'rules';
  $('rulesSheet').hidden = false;
  renderRules();
}

/* One schema serves setup and the host's queued rule editor. Presets also
 * carry fixed protocol values such as drawCount so switching is complete. */
var RULE_CONFIG_FIELDS = [
  { key: 'deckCount', id: 'ruleDeckCount', label: 'Decks', group: 'Deal', min: 0, max: 12, deck: true },
  { key: 'stockPiles', id: 'ruleStockPiles', label: 'Draw stocks', options: [1, 4] },
  { key: 'handSize', id: 'ruleHandSize', label: 'Cards in each hand', min: 5, max: 20 },
  { key: 'footSize', id: 'ruleFootSize', label: 'Cards in each foot', min: 5, max: 20 },
  { key: 'requireRedBook', id: 'ruleRequireRedBook', label: 'Red books required to go out', group: 'Books and pickup', min: 0, max: 5 },
  { key: 'requireBlackBook', id: 'ruleRequireBlackBook', label: 'Black books required to go out', min: 0, max: 5 },
  { key: 'pileTakeExtra', id: 'rulePickupTotal', label: 'Total cards taken from discard', min: 1, max: 20, total: true },
  { key: 'bookSize', id: 'ruleBookSize', label: 'Cards needed to complete a book', min: 3, max: 10 },
  { key: 'maxWildsInBook', id: 'ruleMaxWilds', label: 'Maximum wilds per book', min: 0, max: 4 },
  { key: 'minNaturalsInMeld', id: 'ruleMinNaturals', label: 'Minimum naturals in a meld', min: 2, max: 3 },
  { key: 'minNaturalsWithWild', id: 'ruleMinNaturalsWild', label: 'Minimum naturals when using wilds', min: 2, max: 4 },
  { key: 'closedBooksLocked', id: 'ruleClosedBooksLocked', label: 'Close completed books to more cards', boolean: true, help: 'On: stop at the book size. In either mode, complete a book before starting another of that rank.' },
  { key: 'redBookBonus', id: 'ruleRedBookBonus', label: 'Red book bonus', group: 'Points', min: 0, max: 2000 },
  { key: 'blackBookBonus', id: 'ruleBlackBookBonus', label: 'Black book bonus', min: 0, max: 2000 },
  { key: 'goOutBonus', id: 'ruleGoOutBonus', label: 'Going-out bonus', min: 0, max: 2000 },
  { key: 'redThreeValue', id: 'ruleRedThreeValue', label: 'Red-three points (zero or negative)', min: -2000, max: 0 },
  { key: 'highEightNine', id: 'ruleHighEightNine', label: 'Eights and nines score 10 points', boolean: true, help: 'Off: eights and nines score 5 points.' },
  { key: 'redThreeBonus', id: 'ruleRedThreeBonus', label: 'Laid-off red threes earn a bonus', boolean: true, help: 'Laid-off red threes earn the positive value of the red-three points. Held red threes remain a penalty.' },
  { key: 'goOutWithDiscard', id: 'ruleGoOutWithDiscard', label: 'Require a final discard to go out', boolean: true, help: 'On: complete the required books and discard your last foot card. Off: meld the final card.' },
  { key: 'redThreeAutoLayOff', id: 'ruleRedThreeAutoLayOff', label: 'Automatically lay off red threes', group: 'Round options', boolean: true,
    help: 'On: red threes leave the hand immediately and are replaced. Off: hold or discard them under the original rule.' },
  { key: 'revealPileTake', id: 'ruleReveal', label: 'Show the discard pickup cards', boolean: true,
    help: 'On: everyone can inspect the pickup packet. Off: only the top card and hidden-card count are shown.' },
  { key: 'reshuffleOnce', id: 'ruleReshuffleOnce', label: 'Recycle the stocks once per round', boolean: true,
    help: 'After a draw empties a stock pile, recycle the remaining stocks and discard cards, keeping the top discard. A second exhaustion ends the round.' },
];

function rulesPresetName(id) {
  return id === 'real' ? 'Real Rules' : id === 'christine' ? 'House Rules' : 'Customized rules';
}

function rulePresetControl(id, selected) {
  var label = document.createElement('label'); label.className = 'field'; label.setAttribute('for', id);
  var caption = document.createElement('span'); caption.textContent = 'Rule set'; label.appendChild(caption);
  var control = document.createElement('select'); control.id = id;
  ['christine', 'real', 'custom'].forEach(function (preset) {
    var option = document.createElement('option'); option.value = preset; option.textContent = rulesPresetName(preset);
    option.disabled = preset === 'custom'; control.appendChild(option);
  });
  control.value = selected; label.appendChild(control); return label;
}

function rulesConfigBase() {
  return Object.assign({}, E.DEFAULTS, view ? (view.pendingSettings || view.settings) : {});
}

function ruleFieldValue(field, settings) {
  if (field.boolean) return settings[field.key] ? 'On' : 'Off';
  if (field.deck && !settings[field.key]) return 'Automatic (players + 2)';
  if (field.key === 'stockPiles') return settings.stockPiles === 1 ? 'One stock' : 'Four piles';
  return String(Number(settings[field.key]) + (field.total ? 1 : 0));
}

function setRulesConfigStatus(message, bad) {
  rulesConfigFeedback = message; rulesConfigFeedbackBad = !!bad;
  rulesConfigFeedbackCode = view && view.code;
  var status = $('rulesConfigStatus');
  if (status) { status.textContent = message; status.className = 'note' + (bad ? ' warn' : ''); }
}

function lockRulesEditor(locked) {
  var form = $('rulesEditor');
  if (!form) return;
  ['input', 'select', 'button'].forEach(function (tag) {
    form.querySelectorAll(tag).forEach(function (field) { field.disabled = locked; });
  });
  form.setAttribute('aria-busy', locked ? 'true' : 'false');
}

function finishRulesConfig(ok, message) {
  clearTimeout(rulesConfigTimer); rulesConfigTimer = null; rulesConfigRequest = null;
  lockRulesEditor(false); setRulesConfigStatus(message, !ok);
}

function acknowledgeRulesConfig() {
  var request = rulesConfigRequest;
  if (rulesFeedbackQueue && view && rulesFeedbackQueue.code === view.code && !view.pendingSettings) {
    if (Object.keys(rulesFeedbackQueue.rules).every(function (key) { return JSON.stringify(view.settings[key]) === JSON.stringify(rulesFeedbackQueue.rules[key]); }))
      setRulesConfigStatus('Saved rules are now in effect.', false);
    else setRulesConfigStatus('', false);
    rulesFeedbackQueue = null;
  }
  if (!request || !view || view.code !== request.code) return;
  var applied = view.pendingSettings || view.settings;
  if (!Object.keys(request.rules).every(function (key) {
    return JSON.stringify(applied[key]) === JSON.stringify(request.rules[key]);
  })) return;
  rulesDraft = null; rulesEditorBase = null;
  rulesFeedbackQueue = view.pendingSettings ? { code: view.code, rules: request.rules } : null;
  finishRulesConfig(true, view.phase === 'lobby' ? 'Rules saved for the first deal.' :
    view.pendingSettings ? 'Saved for the next round. The current round is unchanged.' :
    'Queued changes cleared. The current rules will continue next round.');
}

function readRulesEditor() {
  var candidate = Object.assign({}, rulesEditorPresetBase || rulesConfigBase());
  RULE_CONFIG_FIELDS.forEach(function (field) {
    var control = $(field.id);
    if (field.boolean) candidate[field.key] = !!control.checked;
    else {
      var raw = String(control.value).trim();
      candidate[field.key] = raw === '' ? NaN : Number(raw) - (field.total ? 1 : 0);
    }
  });
  candidate.distinctDrawPiles = candidate.stockPiles === 1 ? 1 : 2;
  candidate.minMelds = [0, 1, 2, 3].map(function (index) {
    var raw = String($('ruleOpening' + index).value).trim();
    return raw === '' ? NaN : Number(raw);
  });
  return candidate;
}

function submitRulesConfig(event) {
  if (event) event.preventDefault();
  if (!view || !view.canConfigureRules || rulesConfigRequest || actionPending) return false;
  var base = rulesConfigBase();
  var checked = E.validateSettings(readRulesEditor(), view.seats.length, base);
  if (!checked.ok) { setRulesConfigStatus(checked.reason, true); return false; }
  var changed = {};
  Object.keys(E.DEFAULTS).forEach(function (key) {
    if (JSON.stringify(base[key]) !== JSON.stringify(checked.settings[key])) changed[key] = checked.settings[key];
  });
  if (!Object.keys(changed).length) { setRulesConfigStatus('No rule changes to save.', false); return false; }
  var request = { code: view.code, rules: changed };
  rulesConfigRequest = request;
  if (!act('configureRules', { rules: changed })) {
    finishRulesConfig(false, 'Rules were not sent. Reconnect and try again.'); return false;
  }
  lockRulesEditor(true); setRulesConfigStatus('Saving rules…', false);
  rulesConfigTimer = setTimeout(function () {
    if (rulesConfigRequest !== request) return;
    finishRulesConfig(false, 'No confirmation received. Check the current and queued rules before trying again.');
    actionPending = false;
    if (view) { renderActions(); scheduleBoardSize(); }
  }, 10000);
  return true;
}

function captureRulesDraft() {
  var form = $('rulesEditor');
  if (!form || !$('rulesBody').contains(form) || !rulesEditorBase || !view || rulesEditorCode !== view.code) return;
  var values = {};
  RULE_CONFIG_FIELDS.forEach(function (field) {
    var control = $(field.id);
    if (!control) return;
    var value = field.boolean ? !!control.checked : String(control.value);
    var base = field.boolean ? !!rulesEditorBase[field.key] : String(Number(rulesEditorBase[field.key]) + (field.total ? 1 : 0));
    if (value !== base) values[field.id] = value;
  });
  [0, 1, 2, 3].forEach(function (index) {
    var control = $('ruleOpening' + index);
    if (control && String(control.value) !== String(rulesEditorBase.minMelds[index])) values[control.id] = String(control.value);
  });
  rulesDraft = { code: view.code, values: values, presetBase: rulesEditorPresetBase };
}

function renderRulesEditor(body) {
  if (!view) return;
  var current = Object.assign({}, E.DEFAULTS, view.settings);
  if (view.pendingSettings) {
    var pending = document.createElement('div'); pending.className = 'look-row'; pending.id = 'rulesPendingSummary';
    var title = document.createElement('div'); title.className = 'rule-title'; title.textContent = 'Queued for the next round';
    pending.appendChild(title);
    RULE_CONFIG_FIELDS.forEach(function (field) {
      if (JSON.stringify(current[field.key]) === JSON.stringify(view.pendingSettings[field.key])) return;
      var line = document.createElement('p'); line.className = 'note';
      line.textContent = field.label + ': ' + ruleFieldValue(field, current) + ' → ' + ruleFieldValue(field, view.pendingSettings);
      pending.appendChild(line);
    });
    if (JSON.stringify(current.minMelds) !== JSON.stringify(view.pendingSettings.minMelds)) {
      var opening = document.createElement('p'); opening.className = 'note';
      opening.textContent = 'Opening minimums: ' + current.minMelds.join(' / ') + ' → ' + view.pendingSettings.minMelds.join(' / ');
      pending.appendChild(opening);
    }
    body.appendChild(pending);
  }
  if (!view.canConfigureRules) {
    var owner = document.createElement('p'); owner.className = 'note'; owner.id = 'rulesOwnerNote';
    var host = view.seats[view.hostSeat == null ? 0 : view.hostSeat];
    owner.textContent = 'Only ' + (host ? host.name : 'the table host') + ' can change these rules. Any queued changes start next round.';
    body.appendChild(owner); return;
  }
  var form = document.createElement('form'); form.id = 'rulesEditor'; form.className = 'menu-form';
  form.onsubmit = submitRulesConfig;
  var title = document.createElement('h3'); title.className = 'rule-head'; title.textContent = 'Change table rules'; form.appendChild(title);
  var intro = document.createElement('p'); intro.className = 'note';
  intro.textContent = view.phase === 'lobby' ? 'Choose the rules for the first deal. Everyone at this table uses them.' :
    'Changes apply next round (or the next game), never to the current hand. The editor shows queued values when present.';
  form.appendChild(intro);
  var base = rulesConfigBase(), group;
  rulesEditorPresetBase = rulesDraft && rulesDraft.code === view.code && rulesDraft.presetBase || base;
  form.appendChild(rulePresetControl('rulesPreset', E.rulePresetId(rulesEditorPresetBase)));
  var presetNote = document.createElement('p'); presetNote.className = 'note';
  presetNote.textContent = 'House Rules is the default. Real Rules uses Bicycle’s rules with individual scoring. Choosing a set replaces every rule in this editor.'; form.appendChild(presetNote);
  rulesEditorBase = JSON.parse(JSON.stringify(base)); rulesEditorCode = view.code;
  function groupHeading(title) {
    group = document.createElement('div'); group.className = 'look-row rules-fields';
    var heading = document.createElement('h3'); heading.className = 'rule-head'; heading.textContent = title;
    group.appendChild(heading); form.appendChild(group);
  }
  RULE_CONFIG_FIELDS.forEach(function (field) {
    if (field.group) groupHeading(field.group);
    if (field.boolean) {
      var toggle = document.createElement('div'); toggle.className = 'rule-toggle';
      var checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = field.id;
      checkbox.checked = !!base[field.key];
      var label = document.createElement('label'); label.setAttribute('for', field.id);
      var title = document.createElement('div'); title.className = 'rule-title'; title.textContent = field.label;
      var help = document.createElement('div'); help.className = 'note'; help.textContent = field.help;
      label.appendChild(title); label.appendChild(help); toggle.appendChild(checkbox); toggle.appendChild(label); group.appendChild(toggle);
    } else {
      var label = document.createElement('label'); label.className = 'field'; label.setAttribute('for', field.id);
      var caption = document.createElement('span'); caption.textContent = field.label; label.appendChild(caption);
      var control = document.createElement(field.deck || field.options ? 'select' : 'input'); control.id = field.id;
      if (field.options) {
        field.options.forEach(function (value) { var option = document.createElement('option'); option.value = String(value); option.textContent = value === 1 ? 'One stock' : 'Four piles'; control.appendChild(option); });
      } else if (field.deck) {
        for (var n = 0; n <= 12; n++) {
          var option = document.createElement('option'); option.value = String(n);
          option.textContent = n ? n + (n === 1 ? ' deck' : ' decks') : 'Automatic (players + 2)'; control.appendChild(option);
        }
      } else {
        control.type = 'number'; control.min = String(field.min); control.max = String(field.max); control.step = '1'; control.required = true;
      }
      control.value = String(Number(base[field.key]) + (field.total ? 1 : 0));
      label.appendChild(control); group.appendChild(label);
    }
  });
  groupHeading('Opening minimums');
  [0, 1, 2, 3].forEach(function (index) {
    var label = document.createElement('label'); label.className = 'field'; label.setAttribute('for', 'ruleOpening' + index);
    var text = document.createElement('span'); text.textContent = 'Round ' + (index + 1); label.appendChild(text);
    var input = document.createElement('input'); input.type = 'number'; input.id = 'ruleOpening' + index;
    input.min = '0'; input.max = '500'; input.step = '1'; input.required = true; input.value = String(base.minMelds[index]);
    label.appendChild(input); group.appendChild(label);
  });
  var status = document.createElement('p'); status.id = 'rulesConfigStatus'; status.className = 'note'; status.setAttribute('role', 'status');
  if (rulesConfigFeedbackCode === view.code) {
    status.textContent = rulesConfigFeedback; if (rulesConfigFeedbackBad) status.classList.add('warn');
  }
  form.appendChild(status);
  var save = btn(view.phase === 'lobby' ? 'Save rules for first deal' : 'Save for next round', function () {});
  save.type = 'submit'; save.id = 'saveRulesConfig'; form.appendChild(save);
  body.appendChild(form);
  if (rulesDraft && rulesDraft.code === view.code) Object.keys(rulesDraft.values).forEach(function (id) {
    var field = $(id);
    if (field) { if (field.type === 'checkbox') field.checked = rulesDraft.values[id]; else field.value = rulesDraft.values[id]; }
  });
  function syncPreset() { $('rulesPreset').value = E.rulePresetId(readRulesEditor()); }
  $('rulesPreset').onchange = function () {
    var chosen = E.rulesForPreset(this.value); if (!chosen) return;
    rulesEditorPresetBase = chosen;
    RULE_CONFIG_FIELDS.forEach(function (field) { var control = $(field.id); if (field.boolean) control.checked = !!chosen[field.key]; else control.value = String(Number(chosen[field.key]) + (field.total ? 1 : 0)); });
    chosen.minMelds.forEach(function (minimum, index) { $('ruleOpening' + index).value = String(minimum); });
    setRulesConfigStatus('Preset selected. ' + (view.phase === 'lobby' ? 'Save for the first deal.' : 'Save to apply next round.'), false);
    syncPreset();
  };
  form.oninput = form.onchange = function (event) {
    if (event && event.target === $('rulesPreset')) return;
    syncPreset();
  };
  syncPreset();
  lockRulesEditor(!!rulesConfigRequest);
}

var rulesSignature = null;
function renderRules() {
  var signature = JSON.stringify([rulesMode, !!view, view ? view.settings : E.DEFAULTS,
    view && view.code, view && view.phase, view && view.pendingSettings, view && view.canConfigureRules,
    view && view.reshufflesRemaining, cardStyle, theme, nudgeOn, handLayout, sortMode, opponentMeldStyle, finishedBookStyle, cardMotionOn]);
  if (signature === rulesSignature) return;
  var body = $('rulesBody');
  var active = document.activeElement;
  var focusId = active && body.contains(active) ? active.id : null;
  captureRulesDraft();
  buildRules();
  rulesSignature = signature;
  // A preference or incoming rule change must not drop keyboard focus to the
  // page. Unrelated state messages leave the settings DOM untouched entirely.
  if (focusId && $(focusId)) $(focusId).focus({ preventScroll: true });
}

function buildRules() {
  var body = $('rulesBody'); body.innerHTML = '';
  var S = Object.assign({}, E.DEFAULTS, view ? view.settings : {});
  if ($('rulesTitle')) $('rulesTitle').textContent = rulesMode === 'settings' ? 'Settings' : 'Rules';
  if ($('leaveBtn')) $('leaveBtn').hidden = !view;
  var tabs = document.createElement('div'); tabs.className = 'rules-tabs';
  ['rules', 'settings'].forEach(function (mode) {
    var tab = btn(mode === 'rules' ? 'Rules' : 'Settings', function () { openRules(mode); }, mode !== rulesMode);
    tab.id = 'rules-tab-' + mode;
    tab.classList.add('sm'); tab.setAttribute('aria-pressed', mode === rulesMode ? 'true' : 'false');
    tabs.appendChild(tab);
  });
  body.appendChild(tabs);

  if (rulesMode === 'settings') {
    body.appendChild(lookPicker('Card movement', 'Cards travel between piles, your hand and melds. Your device’s Reduce Motion setting is always respected.',
      [{ id: 'on', name: 'On' }, { id: 'off', name: 'Off' }], cardMotionOn ? 'on' : 'off',
      function (id) { cardMotionOn = id !== 'off'; set('hf_card_motion', cardMotionOn ? 'on' : 'off'); document.documentElement.setAttribute('data-card-motion', cardMotionOn ? 'on' : 'off'); cancelCardMotion(); renderRules(); }));
    body.appendChild(lookPicker('Meld display', 'Cards shows each card in unfinished melds; Tiles uses one rank and count. Applies to you and opponents.',
      [{ id: 'cards', name: 'Cards' }, { id: 'tiles', name: 'Tiles' }], opponentMeldStyle,
      setOpponentMeldStyle));
    var finishedPicker = lookPicker('Finished books', 'Stacked keeps completed books compact. Spread shows every card, in either meld view. Tap any book to open or close it.',
      [{ id: 'stacked', name: 'Stacked' }, { id: 'spread', name: 'Spread' }], finishedBookStyle, setFinishedBookStyle);
    body.appendChild(finishedPicker);
    renderLook(body);
    body.appendChild(lookPicker('Hand layout', null,
      [{ id: 'spread', name: 'Spread' }, { id: 'layered', name: 'Layered' }], handLayout,
      function (id) { handLayout = id; set('hf_layout', id); syncLayoutBtn(); renderRules(); render(); }));
    body.appendChild(lookPicker('Sort cards', null,
      [{ id: 'rank', name: 'By rank' }, { id: 'group', name: 'By count' }], sortMode,
      function (id) { sortMode = id; set('hf_sort', id); syncSortBtn(); renderRules(); render(); }));
  }

  if (rulesMode === 'settings') return;

  var h = document.createElement('h3');
  h.className = 'rule-head';
  h.textContent = rulesPresetName(E.rulePresetId(S)) + (view ? ' · ' + (view.phase === 'lobby' ? 'first deal' : 'current round') : ' · default');
  body.appendChild(h);
  var reference = document.createElement('p'); reference.className = 'note';
  reference.textContent = 'Individual scoring in both rule sets. Hand & Foot has several variants; Real Rules follows Bicycle’s published rules, adapted to individual play. ';
  var source = document.createElement('a'); source.href = 'https://bicyclecards.com/how-to-play/hand-and-foot'; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Bicycle rules'; reference.appendChild(source); body.appendChild(reference);

  var rows = [
    ['Decks', S.deckCount ? String(S.deckCount) : 'automatic: players + 2' + (view ? ' (' + (view.seats.length + 2) + ')' : '')],
    ['Deal', S.handSize + ' to the hand, ' + S.footSize + ' to the foot'],
    ['Draw piles', S.stockPiles === 1 ? 'One stock; draw two cards from it.' : S.stockPiles + ' stocks; draw one card from each of two different piles.'],
    ['Taking the pile', S.pileNaturalsRequired + ' naturals matching the top card; you get it plus the ' +
      S.pileTakeExtra + ' behind it. Before you are down it counts towards the minimum ' +
      'rather than having to cover it — put the pile back if you cannot get there'],
    ['Discard preview', S.revealPileTake ? 'Show the pickup packet to everyone' : 'Show only the public top card and hidden-card count'],
    ['Going down', S.minMelds.join(' / ') + ' across the four rounds, totalled over every meld that turn'],
    ['Book', S.bookSize + ' cards closes a book · red ' + S.redBookBonus + ' · black ' + S.blackBookBonus +
      (S.closedBooksLocked ? '. A completed book takes no more cards.' : '. A completed book may keep taking cards.') + ' Complete a book before starting another of that rank; red and black books of the same rank are allowed.'],
    ['Wilds', 'at most ' + S.maxWildsInBook + ' per book, and every meld needs ' +
      S.minNaturalsInMeld + ' naturals; melds using wilds need ' + S.minNaturalsWithWild + ' naturals. Eights and nines score ' + (S.highEightNine ? 10 : 5) + ' points'],
    ['Threes', 'never meld. Any three on top freezes the pile'],
    ['Red threes', S.redThreeAutoLayOff
      ? 'lay off and replace the moment they arrive; ' + (S.redThreeBonus ? '+' + Math.abs(S.redThreeValue) : S.redThreeValue) + ' each. Held red threes: ' + S.redThreeValue
      : 'dead cards you discard like any other. ' + S.redThreeValue +
        ' only if you are still holding one when the round ends'],
    ['Going out', 'in your foot, ' + S.requireRedBook + ' red book + ' + S.requireBlackBook +
      ' black book, then ' + (S.goOutWithDiscard ? 'discard your last foot card.' : 'meld every remaining card, with no final discard.') + ' +' + S.goOutBonus],
    ['In your foot', S.goOutWithDiscard ? 'Keep one card for the final discard once your required books are complete. Until then, keep enough cards to continue playing.' : 'Keep two cards back — one to discard and one to hold — unless you are going out by melding.'],
    ['Stock recycling', S.reshuffleOnce
      ? 'Once per round: after a stock empties, recycle remaining stocks and discard cards, preserving the top discard.' +
        (view && typeof view.reshufflesRemaining === 'number' ? ' Recycles remaining: ' + view.reshufflesRemaining + '.' : '')
      : 'Off; exhausting the available stock ends the round under the original draw rule'],
  ];
  var overview = document.createElement('div'); overview.className = 'rules-overview';
  [
    ['Decks', String(S.deckCount || (view ? view.seats.length + 2 : 'Auto'))],
    ['Book goal', S.requireRedBook + ' red · ' + S.requireBlackBook + ' black'],
    ['Pile pickup', (S.pileTakeExtra + 1) + ' cards'],
    ['Opening', (view ? view.minMeld : S.minMelds[0]) + ' points'],
  ].forEach(function (item) {
    var cell = document.createElement('div'), label = document.createElement('span'), value = document.createElement('b');
    label.textContent = item[0]; value.textContent = item[1];
    cell.appendChild(label); cell.appendChild(value); overview.appendChild(cell);
  });
  body.appendChild(overview);
  [
    ['Dealing and taking cards', [0, 1, 2, 3, 4, 12]],
    ['Melds, books and going out', [5, 6, 7, 10, 11]],
    ['Threes', [8, 9]],
  ].forEach(function (section) {
    var details = document.createElement('details'); details.className = 'rules-detail';
    var summary = document.createElement('summary'); summary.textContent = section[0]; details.appendChild(summary);
    var tbl = document.createElement('table'), tb = document.createElement('tbody');
    section[1].forEach(function (index) {
      var r = rows[index], tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(r[0]) + '</td><td style="text-align:left">' + esc(r[1]) + '</td>';
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); details.appendChild(tbl); body.appendChild(details);
  });

  var differences = document.createElement('details'); differences.className = 'rules-detail';
  var diffTitle = document.createElement('summary'); diffTitle.textContent = 'Different from House Rules'; differences.appendChild(diffTitle);
  var baseline = E.rulesForPreset('christine'), changedCount = 0;
  RULE_CONFIG_FIELDS.forEach(function (field) {
    if (JSON.stringify(S[field.key]) === JSON.stringify(baseline[field.key])) return;
    var difference = document.createElement('p'); difference.className = 'note';
    difference.textContent = field.label + ': ' + ruleFieldValue(field, S) + (field.help ? ' — ' + field.help : '');
    differences.appendChild(difference); changedCount++;
  });
  if (JSON.stringify(S.minMelds) !== JSON.stringify(baseline.minMelds)) {
    var openingDifference = document.createElement('p'); openingDifference.className = 'note';
    openingDifference.textContent = 'Opening minimums: ' + S.minMelds.join(' / '); differences.appendChild(openingDifference); changedCount++;
  }
  if (changedCount) body.appendChild(differences);
  renderRulesEditor(body);
}

/* ---------------- the scorepad ----------------
 *
 * Scores run into the thousands and get read across a table, so they are
 * grouped. The minus is the real one rather than a hyphen, to match the rest of
 * the interface, and every figure sits in tabular numerals so a column of them
 * lines up on the decimal the way a written pad does. */
function num(n) {
  var s = String(Math.abs(n)), out = '', c = 0;
  for (var i = s.length - 1; i >= 0; i--) {
    out = s.charAt(i) + out;
    if (++c % 3 === 0 && i > 0) out = ',' + out;
  }
  return (n < 0 ? '−' : '') + out;
}
/* For the terms of a round rather than a total: a contribution of +265 and one
 * of 265 are different claims, and the sign is the whole point of the column. */
function plus(n) { return (n > 0 ? '+' : '') + num(n); }

function padHead(text) {
  var h = document.createElement('h3');
  h.className = 'pad-h';
  h.textContent = text;
  return h;
}

function padChip(kind, label, value, tone, title) {
  var s = document.createElement('span');
  s.className = 'chip' + (kind ? ' ' + kind : '');
  var l = document.createElement('span');
  l.className = 'lbl'; l.textContent = label;
  s.appendChild(l);
  var b = document.createElement('b');
  if (tone) b.className = tone;
  b.textContent = value;
  s.appendChild(b);
  if (title) s.title = title;
  return s;
}

/* Where everyone stands. Sorted, ranked, and drawn against the leader, because
 * the question at a card table is never "what is my score" on its own — it is
 * how far back you are and whether that is catchable in one round. */
function standings(totals, best, ended) {
  var wrap = document.createElement('div');
  wrap.className = 'stand';
  var order = view.seats.map(function (_, i) { return i; });
  order.sort(function (a, b) { return totals[b] - totals[a]; });
  var tied = totals.filter(function (t) { return t === best; }).length > 1;
  /* Bars are drawn against the leader's total. A table where nobody is yet
   * above zero has no scale to draw against, so they all stay empty. */
  var span = best > 0 ? best : 0;

  order.forEach(function (idx, pos) {
    var t = totals[idx];
    var lead = t === best;
    var row = document.createElement('div');
    row.className = 'stand-row' + (lead ? ' lead' : '') + (lead && ended && !tied ? ' champ' : '');

    var rank = document.createElement('div');
    rank.className = 'rank'; rank.textContent = String(pos + 1);
    var who = document.createElement('div');
    who.className = 'who'; who.textContent = view.seats[idx].name;
    var amt = document.createElement('div');
    amt.className = 'amt'; amt.textContent = num(t);

    var gap = document.createElement('div');
    gap.className = 'gap';
    gap.textContent = lead
      ? (tied ? 'Tied for the lead' : ended ? 'Winner' : 'Leading')
      : num(best - t) + ' behind';

    var bar = document.createElement('div'); bar.className = 'sbar';
    var fill = document.createElement('i');
    fill.style.width = (span > 0 ? Math.max(0, Math.min(100, (t / span) * 100)) : 0) + '%';
    bar.appendChild(fill);

    row.appendChild(rank); row.appendChild(who); row.appendChild(amt);
    row.appendChild(gap); row.appendChild(bar);
    wrap.appendChild(row);
  });
  return wrap;
}

/* What the round was made of. A round total is exactly red books + black books
 * + table count + going out, so the pad lays out those four terms rather than
 * printing the sum and leaving you to reconstruct it from six grey columns. */
function roundCards() {
  var wrap = document.createElement('div');
  wrap.className = 'rd';
  view.roundDetail.forEach(function (r, i) {
    if (!view.seats[i]) return;
    var row = document.createElement('div'); row.className = 'rd-row';

    var top = document.createElement('div'); top.className = 'rd-top';
    var who = document.createElement('div');
    who.className = 'who'; who.textContent = view.seats[i].name;
    var amt = document.createElement('div');
    amt.className = 'amt' + (r.total < 0 ? ' neg' : '');
    amt.textContent = num(r.total);
    top.appendChild(who); top.appendChild(amt);

    var chips = document.createElement('div'); chips.className = 'chips';
    if (r.redBooks) chips.appendChild(padChip('red', r.redBooks + ' red', num(r.redPts)));
    if (r.blackBooks) chips.appendChild(padChip('black', r.blackBooks + ' black', num(r.blackPts)));
    chips.appendChild(padChip('', 'count', plus(r.tableCount),
      r.tableCount < 0 ? 'down' : 'up',
      'Melded ' + num(r.meldPts) + (r.redThreePts ? ', red threes ' + plus(r.redThreePts) : '') + ', caught holding ' + num(r.handCount) + '.'));
    if (r.out) chips.appendChild(padChip('out', 'went out', plus(r.out)));

    row.appendChild(top); row.appendChild(chips);
    wrap.appendChild(row);
  });
  return wrap;
}

/* The receipt. No total column — the standings above already answer that, and
 * repeating it here only invited the eye to check the same figure twice.
 * Not named "history": a top-level function by that name shadows window.history
 * for the whole script, which is a trap to leave lying around. */
function roundGrid() {
  var t = document.createElement('table');
  t.className = 'hist';
  var head = '<thead><tr><th>Player</th>';
  for (var i = 0; i < view.scores.length; i++) head += '<th>R' + (i + 1) + '</th>';
  head += '</tr></thead>';
  t.innerHTML = head;
  var bestOf = view.scores.map(function (r) {
    return view.seats.reduce(function (m, _, i) { return Math.max(m, r[i] || 0); }, -Infinity);
  });
  var tb = document.createElement('tbody');
  view.seats.forEach(function (s, idx) {
    var tr = document.createElement('tr');
    var row = '<td>' + esc(s.name) + '</td>';
    view.scores.forEach(function (r, ri) {
      var v = r[idx] || 0;
      row += '<td' + (v === bestOf[ri] ? ' class="best"' : '') + '>' + num(v) + '</td>';
    });
    tr.innerHTML = row;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  var sc = document.createElement('div'); sc.className = 'scroll'; sc.appendChild(t);
  return sc;
}

/* A completed round gets one automatic presentation, regardless of later
 * connection/status updates. Phase is deliberately absent from the key:
 * advancing the final round from roundEnd to gameEnd is the same result. */
function scoreRoundKey(state) {
  if (!state || (state.phase !== 'roundEnd' && state.phase !== 'gameEnd')) return null;
  return JSON.stringify([state.code || '', state.round, state.scores || []]);
}

function dismissScores() {
  scoreAutoShownKey = scoreRoundKey(view) || scoreAutoShownKey;
  $('scoreSheet').hidden = true;
  maybeAutoDraw();
}

function syncScoreSheet() {
  var sheet = $('scoreSheet');
  if (!sheet || !view) return;
  var completed = scoreRoundKey(view);
  if (completed === null) {
    // Starting another round or a rematch rearms even an identical score.
    scoreAutoShownKey = null;
  } else if (completed !== scoreAutoShownKey) {
    scoreAutoShownKey = completed;
    sheet.hidden = false;
  }
  if (!sheet.hidden) renderScores();
}

function renderScores() {
  var body = $('scoreBody'); body.innerHTML = '';
  var totals = view.seats.map(function (_, i) {
    return view.scores.reduce(function (s, r) { return s + (r[i] || 0); }, 0);
  });
  var best = totals.length ? Math.max.apply(null, totals) : 0;
  var ended = view.phase === 'gameEnd';

  $('scoreTitle').textContent = ended ? 'Final scores'
    : view.phase === 'roundEnd' ? 'Round ' + (view.round + 1) + ' scored' : 'Scores';

  if (!view.scores.length && !view.roundDetail) {
    var p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'No rounds scored yet — the pad fills in as each one is counted.';
    body.appendChild(p);
    return;
  }

  if (view.scores.length) {
    body.appendChild(padHead('Standings'));
    body.appendChild(standings(totals, best, ended));
  }
  if (view.roundDetail) {
    body.appendChild(padHead('This round'));
    body.appendChild(roundCards());
  }
  /* One round of history is the standings written out again, so it waits until
   * there is a second round to compare it with. */
  if (view.scores.length > 1) {
    body.appendChild(padHead('Round by round'));
    body.appendChild(roundGrid());
  }
}

/* ---------------- room for the action bar ----------------
 * The bar is fixed to the bottom, so the board has to reserve exactly its
 * height or the last row of cards hides behind it. The height changes with the
 * hint text and the number of buttons, and on a phone a guessed constant is
 * either dead space or a clipped card — so measure it. */
var boardFrame = null, boardOverflowContext = null;
function scheduleBoardSize() {
  if (!window.requestAnimationFrame) { sizeBoard(); return; }
  if (boardFrame !== null) return;
  boardFrame = window.requestAnimationFrame(function () { boardFrame = null; sizeBoard(); });
}
function styleValue(element, key, value) {
  if (element.style.getPropertyValue ? element.style.getPropertyValue(key) === String(value) : element.style[key] === String(value)) return;
  element.style.setProperty(key, String(value));
}
function sizeBoard() {
  var bar = document.querySelector('.actions'), board = document.querySelector('.board');
  if (!bar || !board) return;
  var hand = $('myHand'), top = document.querySelector('.bar');
  var fixed = getComputedStyle(bar).position === 'fixed';
  var barHeight = bar.offsetHeight, topHeight = top && top.offsetHeight;
  var width = hand && hand.clientWidth;
  var shortPhone = window.matchMedia && window.matchMedia('(max-width: 600px) and (max-height: 700px)').matches;
  var mobile = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
  var padding = fixed ? (barHeight + 8) + 'px' : '';
  if (board.style.paddingBottom !== padding) board.style.paddingBottom = padding;
  styleValue(board, '--scroll-clearance', fixed ? (barHeight + 32) + 'px' : '0px');
  if (width) {
    var dense = handLayout === 'spread' && (shortPhone || (mobile && myHand().length > 21));
    if (hand.dataset.dense !== String(!!dense)) hand.dataset.dense = dense ? 'true' : 'false';
    var columns = dense ? 10
      : mobile && width >= 340 && myHand().length > 12 && myHand().length <= 16 ? 8
      : Math.max(1, Math.min(10, Math.floor((width + 4) / 48)));
    styleValue(hand, '--hand-cols', columns);
    var rows = handLayout === 'layered' ? hand.querySelectorAll('.hand-row').length : Math.ceil(myHand().length / columns);
    styleValue(hand, '--hand-rows', Math.max(1, rows));
  }
  if (top) styleValue(document.documentElement, '--bar-h', topHeight + 'px');
  board.dataset.largeHand = myHand().length > 20 ? 'true' : 'false';
  // On crowded screens constrain extra opponent detail before the player's
  // cards can slip behind the actions. Selection never toggles this mode.
  var context = view && JSON.stringify([window.innerWidth, window.innerHeight, handLayout, opponentMeldStyle, finishedBookStyle, meldExpanded,
    view.code, view.round, view.phase, myHand().length,
    view.seats.map(function (seat) { return seat.melds.map(function (meld) { return meld.cards.length; }); })]);
  if (context !== boardOverflowContext) {
    boardOverflowContext = context;
    delete board.dataset.overflow;
    fitMine();
    if (window.innerHeight && hand && fixed && hand.getBoundingClientRect().bottom > bar.getBoundingClientRect().top + 1) {
      board.dataset.overflow = 'true';
    }
  }
  // This final dependent measurement retains the existing stable book fit.
  fitMine();
  positionOpponentDetail();
  positionCardPopover($('sortPopover'), $('sortBtn'));
  positionCardPopover($('autoDrawPopover'), $('autoDrawBtn'));
}

if (window.ResizeObserver) {
  var ro = new ResizeObserver(scheduleBoardSize);
  ro.observe(document.querySelector('.actions'));
  ro.observe(document.querySelector('.bar'));
}
// A height-only change can switch compact card rows without resizing the
// header or footer, so this is needed even when ResizeObserver is available.
window.addEventListener('resize', scheduleBoardSize);

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

/* A half-open transport must not leave an action waiting forever. No pending
 * game action is replayed; a resumed state always precedes automatic draws. */
function checkConnection() {
  if (!ws || ws.readyState !== 1) return;
  if (connectionLastSeen && Date.now() - connectionLastSeen > 45000) {
    autoDrawStateFresh = false; cancelAutoDraw();
    ws.close(); return;
  }
  send({ t: 'ping' });
}
setInterval(checkConnection, 15000);

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
