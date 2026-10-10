'use strict';

/* Client behavior tests. A small DOM double exercises the real rendering and
 * action decisions without a browser; responsive geometry is checked in UI QA. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('./engine');
const G = require('./game');
const html = fs.readFileSync(require.resolve('./index.html'), 'utf8');
function menuOptions(id) {
  const select = html.match(new RegExp('<select[^>]+id="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
  assert(select, id + ' setup selector exists');
  return [...select[1].matchAll(/<option value="(\d+)"([^>]*)>/g)]
    .map(match => ({ value: Number(match[1]), selected: /\bselected\b/.test(match[2]) }));
}
assert.deepEqual(menuOptions('seatCount'), [
  { value: 2, selected: false }, { value: 3, selected: true }, { value: 4, selected: false },
], 'friend games offer two to four total players, defaulting to three');
assert.deepEqual(menuOptions('botCount'), [
  { value: 1, selected: false }, { value: 2, selected: true }, { value: 3, selected: false },
], 'computer games offer one to three opponents, defaulting to two');
const ids = new Map();
const storedPreferences = new Map();
const documentListeners = new Map();
let document;

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.className = ''; this.dataset = {};
    this.textContent = ''; this.hidden = false; this.scrollTop = 0; this.scrollHeight = 400;
    this.clientHeight = 180; this.clientWidth = 370; this.isConnected = true;
    this.style = {
      setProperty(key, value) { this[key] = String(value); },
      getPropertyValue(key) { return this[key] || ''; },
    };
    this.classList = {
      add: (...values) => { values.forEach(v => { if (!this.className.split(' ').includes(v)) this.className += ' ' + v; }); },
      remove: value => { this.className = this.className.split(' ').filter(v => v !== value).join(' '); },
      toggle: (value, on) => { if (on) this.classList.add(value); else this.classList.remove(value); },
    };
  }
  set id(value) { this._id = value; ids.set(value, this); }
  get id() { return this._id; }
  set innerHTML(value) { this.children = []; this._html = value; }
  get innerHTML() { return this._html || ''; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; return child; }
  setAttribute(key, value) { this[key] = value; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  focus(options) { this.lastFocusOptions = options; document.activeElement = this; }
  getBoundingClientRect() { return { top: this.top || 0, bottom: (this.top || 0) + 40, left: 0, width: this.clientWidth }; }
  querySelectorAll(selector) {
    const found = [];
    const match = node => selector === '[data-card]' ? node.dataset.card !== undefined
      : selector.startsWith('.') ? selector.slice(1).split('.').every(c => node.className.split(' ').includes(c))
      : node.tagName === selector;
    const walk = node => node.children.forEach(child => { if (match(child)) found.push(child); walk(child); });
    walk(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const board = new Element('div');
const handHead = new Element('div'); handHead.top = 350;
document = {
  documentElement: new Element('html'), body: new Element('body'), activeElement: null,
  createElement: tag => new Element(tag),
  createTextNode: text => { const node = new Element('#text'); node.textContent = text; return node; },
  getElementById: id => ids.get(id) || null,
  querySelector: selector => selector === '.board' ? board : selector === '.hand-head' ? handHead : null,
  addEventListener(type, callback) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(callback);
  },
};
const context = {
  E, document, window: { addEventListener() {}, navigator: {} }, navigator: {},
  localStorage: {
    getItem(key) { return storedPreferences.has(key) ? storedPreferences.get(key) : null; },
    setItem(key, value) { storedPreferences.set(key, String(value)); },
    removeItem(key) { storedPreferences.delete(key); },
  },
  setInterval() {}, setTimeout() {}, clearTimeout() {},
  getComputedStyle() { return { getPropertyValue() { return ''; } }; }, console,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('./app.js'), 'utf8').split('/* ---------------- start ---------------- */')[0], context);

assert.deepEqual(Array.from(context.THEMES, theme => theme.id), ['room', 'midnight', 'claret', 'graphite', 'mahogany', 'ivory'], 'the five dark themes and the light Ivory theme remain available');
assert.equal(context.theme, 'room', 'a fresh browser defaults to the original Card room theme');
for (const savedTheme of ['room', 'midnight', 'claret', 'graphite', 'mahogany', 'emerald', 'invalid']) {
  storedPreferences.set('hf_theme', savedTheme);
  context.loadLook();
  const expectedTheme = ['emerald', 'invalid'].includes(savedTheme) ? 'room' : savedTheme;
  assert.equal(context.theme, expectedTheme);
  assert.equal(storedPreferences.get('hf_theme'), savedTheme, 'loading the table never overwrites a saved theme preference');
  const bootRoot = { setAttribute(key, value) { this[key] = value; } };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { documentElement: bootRoot },
    localStorage: { getItem(key) { return key === 'hf_theme' ? savedTheme : null; } },
  });
  assert.equal(bootRoot['data-theme'], expectedTheme, 'early paint and loaded preferences agree');
}
storedPreferences.delete('hf_theme'); context.loadLook();
assert.equal(context.theme, 'room');
assert(html.includes('<html lang="en" data-theme="room">'), 'storage-blocked first paint retains the original theme');
assert.equal(context.interactionMode, 'buttons', 'fresh preferences default to Buttons');
// The following direct-table gesture cases intentionally exercise Tap mode.
// The separate interaction-mode cases below cover Buttons and persistence.
storedPreferences.set('hf_interactions', 'tap'); context.loadLook();

function element(id, tag = 'div') { const el = new Element(tag); el.id = id; return el; }
const bar = element('actionBar');
element('playButtons').hidden = true;
element('myHand'); element('handPill'); element('myMelds'); element('centerRow'); element('tableUndo', 'button');
const ownBookStats = element('myBookStats');
ownBookStats.appendChild(element('myMeldedPoints')); ownBookStats.appendChild(element('myBookCounts'));
element('rulesBody'); element('rulesTitle'); element('leaveBtn'); element('rulesSheet').hidden = true;
element('rulesSaveBar').hidden = true;
element('chatMessages'); element('chatUnread'); element('chatBtn', 'button');
element('peekBody'); element('peekTitle'); element('peekSheet').hidden = true;

const closed = { id: 'closed', rank: '4', cards: ['4S1', '4H1', '4D1', '4C1', '4S2', '4H2', '4D2'] };
function setup(melds = []) {
  context.view = {
    phase: 'playing', turn: 0, turnPhase: 'play', minMeld: 50, settings: E.DEFAULTS,
    turnState: { melded: 0, drew: true }, seats: [{ name: 'You', melds }],
    you: { seat: 0, hand: ['4S0', '4H0', '2S0'], footCount: 11, inFoot: false, hasInitialMeld: false, canGoOut: { ok: false } },
  };
  context.sel = context.view.you.hand.slice(); context.notice = ''; context.noticeBad = false;
}
function footerAction(id) { return bar.children.find(child => child.id === id); }
function newMeldAction() { const slot = ids.get('newMeldSlot'); return slot && slot.children.find(child => child.id === 'newMeldTarget'); }
function discardAction() { context.renderCenter(); const target = ids.get('discardPreview'); return target && target.className.split(' ').includes('discard-ready') ? target : undefined; }

const cleanDisplayBook = Object.freeze({ rank: '5', cards: Object.freeze(['5S2', '5H1', '5C1', '5D1', '5S1', '5H2', '5D2']) });
const dirtyDisplayBook = Object.freeze({ rank: 'K', cards: Object.freeze(['KS1', 'KH1', '2H0', 'KC1', 'XR0', 'KD1', 'KS0']) });
const cleanDisplayOrder = ['5D1', '5D2', '5H1', '5H2', '5C1', '5S1', '5S2'];
const dirtyDisplayOrder = ['KC1', 'KS0', 'KS1', 'KD1', 'KH1', 'XR0', '2H0'];
assert.deepEqual([...context.orderMeldCards(cleanDisplayBook)], cleanDisplayOrder, 'red books put red-suit naturals at the front of the fan');
assert.deepEqual([...context.orderMeldCards(dirtyDisplayBook)], dirtyDisplayOrder, 'black books put black-suit naturals first, then red suits, then wilds');
assert.deepEqual(cleanDisplayBook.cards, ['5S2', '5H1', '5C1', '5D1', '5S1', '5H2', '5D2'], 'ordering never mutates the original game cards');
assert.deepEqual(dirtyDisplayBook.cards, ['KS1', 'KH1', '2H0', 'KC1', 'XR0', 'KD1', 'KS0']);
assert.notEqual(context.orderMeldCards(cleanDisplayBook), cleanDisplayBook.cards, 'display order is an independent array');
assert.deepEqual([...context.orderMeldCards({ rank: '5', cards: ['5S0', '5H0', '5C0'] })], ['5H0', '5C0', '5S0'], 'an incomplete clean meld also leads with red suits');
assert.deepEqual([...context.orderMeldCards({ rank: '5', cards: ['5H0', 'XR0', '5S0'] })], ['5S0', '5H0', 'XR0'], 'an incomplete meld switches to black-suit-first as soon as it contains a wild');
assert.deepEqual([...context.orderMeldCards({ rank: 'W', cards: ['2S1', 'XR0', '2D0', 'XB1'] })], ['XB1', 'XR0', '2D0', '2S1'], 'all-wild books preserve the existing joker/deuce ordering');

setup([closed]); context.renderActions();
assert(newMeldAction(), 'closed books must allow a second book of the rank on the table');
setup([{ id: 'open', rank: '4', cards: ['4S1', '4H1', '4D1'] }]); context.renderActions();
assert(!newMeldAction(), 'an open same-rank meld must be extended');

setup([closed]);
for (const card of ['3D0', '2C0', 'QS0']) {
  context.sel = [card]; assert.equal(context.canAddSelection(closed), false, card + ' must not be offered as a red-book addition');
}
context.sel = ['4C0']; assert.equal(context.canAddSelection(closed), true);
context.view.discardTop = '4D0'; context.view.discardCount = 7;
context.sel = ['4S0', '4H0']; assert(context.pileOffer(), 'a matching natural pair can take the pile');
context.sel.push('QS0'); assert.equal(context.pileOffer(), null, 'a mismatched extra selection cannot be offered as a pile take');
context.view.seats[0].melds = [{ id: 'wilds', rank: '4', cards: ['4S1', '4H1', '2S1', 'XR1'] }];
context.sel = ['4S0', '4H0', '2S0'];
assert.equal(context.pileOffer(), null, 'pile taking must respect the existing book wild limit');
context.view.seats[0].melds = [closed];
context.view.you.hand.push('3D0'); context.sel = ['3D0']; context.renderActions();
assert(ids.get('actionHint').innerHTML.includes('Threes cannot meld'), 'three selection needs explicit legal guidance');
context.view.turnState.melded = 30; context.renderActions();
assert(!discardAction(), 'partial opening does not offer an illegal discard');
context.view.turnState.melded = 0; context.view.you.inFoot = true; context.view.you.hand = ['3D0']; context.renderActions();
assert(!discardAction(), 'the last foot card has no discard action');

setup(); context.sel = []; context.renderActions();
const persistentActionHint = ids.get('actionHint');
assert.equal(persistentActionHint['aria-live'], 'polite', 'action guidance is announced politely');
assert.equal(bar.querySelectorAll('button').length, 0, 'empty selection has no placeholder Meld or Discard buttons');
assert(ids.get('actionHint').innerHTML.includes('Select cards to play'));
context.view.you.hand = ['QS0', '4S0', '5S0']; context.sel = ['QS0']; context.renderActions();
assert.equal(bar.querySelectorAll('button').length, 0, 'playing has no footer actions');
assert(discardAction(), 'an unmeldable single card activates the discard pile');
assert.equal(ids.get('actionHint').dataset.phase, 'Discard');
context.sel = context.view.you.hand.slice(); context.renderActions();
assert.equal(bar.querySelectorAll('button').length, 0, 'mixed ranks do not offer a disabled or invalid Meld');
assert.equal(ids.get('actionHint'), persistentActionHint, 'changed selection and guidance retain the same live-region node');
assert.equal(bar.children.filter(child => child.id === 'actionHint').length, 1, 'only one live action hint remains mounted');
setup(); context.renderActions();
assert(newMeldAction() && !newMeldAction().disabled, 'a legal new meld is offered even when opening can continue in a later action');
assert(!discardAction(), 'multi-card selection does not offer Discard');
context.view.you.inFoot = true; context.view.you.hand.push('8S0'); context.renderActions();
assert(!newMeldAction(), 'melding to one foot card without required books is not offered');
context.view.you.hand = context.sel.slice(); context.renderActions();
assert(!newMeldAction(), 'emptying the foot without required books is not offered');
context.view.settings = Object.assign({}, E.DEFAULTS, { requireRedBook: 0, requireBlackBook: 0 });
context.renderActions();
assert(!newMeldAction(), 'going out below the opening minimum is not offered');
context.view.turnState.melded = 20; context.renderActions();
assert(newMeldAction(), 'a legal final meld reaching the opening minimum is offered');
setup([closed]); context.view.you.inFoot = true; context.view.you.hasInitialMeld = true;
context.view.you.hand = ['4S0', 'QS0']; context.sel = ['4S0']; context.renderActions();
assert(!footerAction('addToBookAction'), 'adding to a book cannot offer an illegal one-card foot');
assert(discardAction(), 'the same selected card can still be legally discarded from a two-card foot');
context.view.settings = Object.assign({}, E.DEFAULTS, { requireBlackBook: 0 });
context.view.you.hand = ['4S0']; context.renderActions();
assert(!footerAction('addToBookAction') && !discardAction(), 'the final foot card is played by tapping its book, with no competing footer button');
assert(context.canAddSelection(closed) && !context.quickMeldStopReason(closed), 'the final foot card remains a legal book-tap add');

{
  const beforeView = context.view, beforeSelection = context.sel;
  const kings = { id: 'three-kings', rank: 'K', cards: ['KS0', 'KH0', 'KD0'] };
  const black = { id: 'black-queens', rank: 'Q', cards: ['QS0', 'QH0', 'QD0', 'QC0', 'QS1', 'QH1', '2S0'] };
  setup([kings, black]); context.view.turnPhase = 'draw';
  context.view.you.hand = ['KC0', 'KS1', 'KH1'];
  context.view.you.inFoot = true; context.view.you.hasInitialMeld = true;
  context.view.you.canGoOut = { ok: false };
  context.view.discardTop = 'KD1'; context.view.discardCount = 1;
  const offer = context.pileChance();
  assert(offer, 'the only winning pickup remains available when a pair would strand the foot');
  assert.deepEqual([...offer.cards], ['KC0', 'KS1', 'KH1'], 'automatic pickup uses all three naturals needed to finish the red book');
  const game = G.createGame(['You', 'Opponent']);
  assert(G.startRound(game, () => 0.5).ok);
  Object.assign(game.players[0], { hand: context.view.you.hand.slice(), foot: [], inFoot: true,
    hasInitialMeld: true, melds: JSON.parse(JSON.stringify([kings, black])) });
  game.turn = 0; game.discard = ['KD1'];
  const result = G.takePile(game, 0, [...offer.cards]);
  assert(result.ok && result.roundEnded && game.players[0].wentOut, 'the displayed larger pickup actually wins under the authoritative rules');
  context.view = beforeView; context.sel = beforeSelection;
}

setup(); context.sel = []; context.renderHand();
const hand = ids.get('myHand'); const first = hand.querySelector('[data-card]');
first.focus(); hand.scrollTop = 37; context.sel = [first.dataset.card]; context.renderHand();
assert.equal(hand.scrollTop, 37, 'selection preserves a scrolled hand');
assert.equal(hand.querySelector('[data-card]'), first, 'selection updates the existing card node in place');
assert.equal(document.activeElement, first, 'selection keeps focus on the exact same card button');
assert.equal(first['aria-pressed'], 'true', 'the retained card exposes its new selected state');
assert(first.className.split(' ').includes('sel'), 'the retained card visibly reflects selection');
assert.equal(document.activeElement.dataset.card, first.dataset.card, 'selection preserves keyboard focus');
const stable = hand.children[0]; context.renderHand();
assert.equal(hand.children[0], stable, 'unrelated messages do not rebuild the hand');
assert.equal(ids.get('handPill').textContent, 'Your hand', 'the hand header does not duplicate the book-area counts');
assert.equal(ids.get('myBookCounts').textContent, '3 hand · 11 foot', 'own hand and foot counts appear together in the book statistics row');
context.view.you.footCount = 0; context.renderHand();
assert.equal(ids.get('myBookCounts').textContent, '3 hand · 0 foot', 'a foot-count-only update refreshes the book statistics row');
assert(ids.get('handPill')['aria-label'].includes('3 cards in hand, 0 cards in foot'), 'hand counts remain accessible at the hand heading');
context.view.you.footCount = 11;
const deck = E.buildDeck(1);
for (let count = 1; count <= 30; count++) {
  context.view.you.hand = deck.slice(0, count); context.sel = []; context.renderHand();
  assert.equal(hand.querySelectorAll('[data-card]').length, count, 'all hand cards remain rendered: ' + count);
  assert.equal(hand.dataset.count, String(count));
}

setup(); context.view.you.hand = ['4S0', '4H0', '4D1', '5S0', 'XR0', 'XB1', '2S0'];
context.view.you.picked = ['4D1']; context.sel = ['4S0', '5S0'];
const matchingButton = element('selectMatching', 'button');
assert.equal(context.selectMatchingOn, false, 'matching selection starts off');
context.toggleMatchingSelection();
assert.equal(matchingButton['aria-pressed'], 'true');
assert.deepEqual([...context.sel], ['4S0', '5S0'], 'changing selection mode leaves the current selection intact');
const realRender = context.render;
context.render = () => {}; // Card taps are tested without mounting the whole table.
context.renderHand();
const tap = card => hand.querySelectorAll('[data-card]').find(el => el.dataset.card === card).onclick();
tap('4H0');
assert.deepEqual([...context.sel], ['4S0', '5S0', '4H0', '4D1'], 'a partial rank selection expands to include every matching card, including fresh cards');
assert.equal(context.autoDrawMode, 'off', 'matching-rank selection works independently of automatic drawing');
tap('4D1');
assert.deepEqual([...context.sel], ['5S0'], 'tapping a fully selected rank clears only that rank');
tap('XR0');
assert.deepEqual([...context.sel], ['5S0', 'XR0', 'XB1'], 'both joker colors share rank X; deuces stay separate');
context.toggleMatchingSelection();
assert.equal(matchingButton['aria-pressed'], 'false');
assert.deepEqual([...context.sel], ['5S0', 'XR0', 'XB1'], 'turning matching off preserves the selection');
tap('4S0');
assert.deepEqual([...context.sel], ['5S0', 'XR0', 'XB1', '4S0'], 'individual mode selects only the tapped card');
tap('XR0');
assert.deepEqual([...context.sel], ['5S0', 'XB1', '4S0'], 'individual mode can deselect one joker independently');
context.render = realRender;

const sortTrigger = element('sortBtn', 'button');
element('layoutBtn', 'button');
const sortPopup = element('sortPopover'); sortPopup.hidden = true;
for (const id of ['sortRank', 'sortCount', 'sortSpread', 'sortLayered']) sortPopup.appendChild(element(id, 'button'));
context.sortMode = 'rank'; context.handLayout = 'spread'; context.render = () => {};
const arrangedSelection = [...context.sel];
context.toggleSortPopover();
assert.equal(sortPopup.hidden, false);
assert.equal(sortTrigger['aria-expanded'], 'true');
assert.equal(document.activeElement, ids.get('sortRank'), 'opening sort focuses the current order choice');
context.applyHandArrangement('sort', 'group');
assert.equal(context.sortMode, 'group');
assert.deepEqual([...context.sel], arrangedSelection, 'sorting preserves the exact selected cards');
assert.equal(sortPopup.hidden, true, 'choosing a sort order closes the popup');
assert.equal(document.activeElement, sortTrigger);
context.toggleSortPopover(); context.applyHandArrangement('layout', 'layered');
assert.equal(context.handLayout, 'layered');
assert.deepEqual([...context.sel], arrangedSelection, 'changing layout also preserves the selection');
assert.equal(sortPopup.hidden, true);
const dismissalEvent = target => ({ target, prevented: false, stopped: false,
  preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } });
context.toggleSortPopover();
const pointerDismiss = dismissalEvent(hand.children[0]);
context.handleSortOutsidePointer(pointerDismiss);
assert(pointerDismiss.prevented && pointerDismiss.stopped, 'outside pointer dismissal cannot reach a game control');
assert.equal(sortPopup.hidden, true);
const trailingClick = dismissalEvent(hand.children[0]); context.handleSortOutsideClick(trailingClick);
assert(trailingClick.prevented && trailingClick.stopped, 'the click following dismissal is consumed too');
assert.deepEqual([...context.sel], arrangedSelection, 'outside dismissal leaves the selection intact');
context.toggleSortPopover();
const escape = dismissalEvent(sortPopup); escape.key = 'Escape';
context.handleSortPopoverKey(escape);
assert(escape.prevented && escape.stopped);
assert.equal(sortPopup.hidden, true); assert.equal(sortTrigger['aria-expanded'], 'false');
assert.equal(document.activeElement, sortTrigger, 'Escape restores focus to Sort');
context.toggleSortPopover(); context.view.turn = 1; context.syncSortContext();
assert.equal(sortPopup.hidden, true, 'a turn change closes the stale popup');
context.view.turn = 0; context.handLayout = 'spread'; context.render = realRender;

const opponent = { name: 'Opponent', melds: [closed], handCount: 11, footCount: 11, inFoot: false };
Object.defineProperty(opponent, 'hand', { get() { throw new Error('Opponent private hand was accessed'); } });
Object.defineProperty(opponent, 'foot', { get() { throw new Error('Opponent private foot was accessed'); } });
context.view.seats.push(opponent);
context.finishedBookStyle = 'spread';
context.seatNodes = [0, 1].map(() => ({ toggle: new Element('button'), seat: new Element('div') }));
context.expandedSeat = 1; context.renderOpponentDetail();
assert.equal(ids.get('opponentMelds').querySelectorAll('.card.book-red').length, 7);
assert.deepEqual(ids.get('opponentMelds').querySelectorAll('.card').map(card => card['aria-label']),
  ['4D1', '4D2', '4H1', '4H2', '4C1', '4S1', '4S2'].map(E.label), 'expanded opponent books use red-suit-first display order');
assert(ids.get('opponentCounts').textContent.includes('11 in hand'));
assert.equal(ids.get('opponentMelds').querySelectorAll('[data-card]').length, 0, 'public detail has no selectable hand cards');
assert.equal(context.cardEl('2S0', { book: 'book-black' }).className.includes('book-black'), false, 'deuce retains its wild treatment');
assert.equal(context.cardEl('XR0', { book: 'book-black' }).className.includes('book-black'), false, 'joker retains its wild treatment');
opponent.redBooks = 1;
assert.equal(context.publicMeldedPoints(opponent), 35, 'melded points include only public card values, excluding the red book bonus and private hands');
opponent.melds.push({ id: 'black', rank: 'K', cards: ['KS0', 'KH0', 'KC0', 'KD0', 'KS1', '2H0', 'XR0'] });
opponent.blackBooks = 1;
opponent.inFoot = true; opponent.footCount = 0;
assert.equal(context.publicMeldedPoints(opponent), 155, 'public meld values include natural cards, deuces, and jokers');
element('seats'); context.seatNodes = []; context.expandedSeat = null; context.renderSeats();
assert.equal(context.seatNodes[1].points.textContent, '155 melded', 'opponent points show the public melded value without repeating book badges');
assert.equal(context.seatNodes[1].chips.parentNode.className, 'seat-top', 'opponent book pills share the first row with the player name');
assert.equal(context.seatNodes[1].toggle.parentNode, context.seatNodes[1].chips.parentNode,
  'the dropdown hit area follows the visible name row inside a vertically centered opponent panel');
assert.equal(context.seatNodes[1].points.parentNode.className, 'seat-subtop');
assert.equal(context.seatNodes[1].points.parentNode.hidden, true, 'the redundant opponent statistics row stays hidden');
assert.equal(context.seatNodes[1].meta.parentNode.className, 'seat-identity');
assert.equal(context.seatNodes[1].meta.parentNode, context.seatNodes[1].name.parentNode,
  'opponent card counts remain beside the player identity');
assert.equal(context.seatNodes[1].meta.textContent, '11 hand · 0 foot');
assert.deepEqual(context.seatNodes[1].chips.children.map(chip => [chip.className, chip.textContent]),
  [['chip red', '1 red book'], ['chip black', '1 black book'], ['chip foot', 'In foot']], 'opponent badges include only shared book and in-foot components');
context.seatNodes[1].toggle.focus(); context.seatNodes[1].toggle.onclick();
assert.equal(document.activeElement, ids.get('closeOpponentDetail'), 'opening the opponent dropdown makes Close immediately keyboard-accessible');
assert.equal(context.seatNodes[1].toggle['aria-expanded'], 'true');
const retainedDetailFocus = new Element('button'); retainedDetailFocus.focus();
context.renderOpponentDetail();
assert.equal(document.activeElement, retainedDetailFocus, 'live opponent updates never move keyboard focus');
ids.get('closeOpponentDetail').onclick();
assert.equal(document.activeElement, context.seatNodes[1].toggle, 'Close returns focus to the opponent name');
assert.equal(context.seatNodes[1].toggle['aria-expanded'], 'false');

{
  const panel = ids.get('opponentDetail'), originalMelds = opponent.melds;
  context.view.seats.push({ name: 'Maya', melds: originalMelds, handCount: 8, footCount: 11 });
  try {
    context.renderSeats(); context.seatNodes[1].toggle.onclick(); panel.scrollTop = 180;
    context.renderOpponentDetail();
    assert.equal(panel.scrollTop, 180, 'an unchanged opponent update retains the current scroll position');
    opponent.melds = originalMelds.concat({ id: 'scroll-update', rank: '9', cards: ['9S0', '9H0', '9D0'] });
    context.renderOpponentDetail();
    assert.equal(panel.scrollTop, 180, 'new public cards for the same opponent retain the current scroll position');
    ids.get('closeOpponentDetail').onclick(); context.seatNodes[2].toggle.onclick();
    assert.equal(panel.scrollTop, 0, 'closing one opponent and opening another starts at the new opponent’s first book');
    panel.scrollTop = 90; context.seatNodes[1].toggle.onclick();
    assert.equal(panel.scrollTop, 0, 'switching opponents while the dropdown is open also starts at the top');
  } finally {
    opponent.melds = originalMelds; context.view.seats.pop();
    context.closeOpponentDetail(); context.renderSeats();
  }
}

// The dropdown keeps its ordinary anchor, but cannot collapse to a strip when
// the lowest opponent is close to the hand on a crowded or scrolled board.
{
  const panel = ids.get('opponentDetail'), seat = context.seatNodes[1].seat;
  const before = { boardRect: board.getBoundingClientRect, seatRect: seat.getBoundingClientRect,
    handRect: hand.getBoundingClientRect, height: context.window.innerHeight,
    scroll: board.scrollTop, panelScrollHeight: panel.scrollHeight };
  try {
    context.expandedSeat = 1; panel.hidden = false; panel.scrollHeight = 400;
    context.window.innerHeight = 844; board.scrollTop = 0;
    board.getBoundingClientRect = () => ({ top: 60, bottom: 838 });
    seat.getBoundingClientRect = () => ({ top: 100, bottom: 200 });
    hand.getBoundingClientRect = () => ({ top: 600, bottom: 790 });
    context.positionOpponentDetail();
    assert.equal(panel.style.top, '144px', 'roomy placement stays four pixels below the opponent');
    assert.equal(panel.style.maxHeight, '390px', 'roomy placement retains the existing hand clearance');

    seat.getBoundingClientRect = () => ({ top: 430, bottom: 510 });
    hand.getBoundingClientRect = () => ({ top: 540, bottom: 790 });
    board.scrollTop = 35; context.positionOpponentDetail();
    assert.equal(panel.style.top, '35px', 'a crowded dropdown moves above its opponent using the board scroll offset');
    assert.equal(panel.style.maxHeight, '366px', 'above placement preserves a usable scrollable body');

    context.window.innerHeight = 240; board.scrollTop = 0;
    board.getBoundingClientRect = () => ({ top: -80, bottom: 420 });
    seat.getBoundingClientRect = () => ({ top: 50, bottom: 150 });
    hand.getBoundingClientRect = () => ({ top: 170, bottom: 230 });
    context.positionOpponentDetail();
    assert.equal(panel.style.top, '88px', 'when neither side fits, the dropdown starts within the visible viewport');
    assert.equal(panel.style.maxHeight, '224px', 'viewport fallback replaces the unusable 32-pixel dropdown');
  } finally {
    board.getBoundingClientRect = before.boardRect; seat.getBoundingClientRect = before.seatRect;
    hand.getBoundingClientRect = before.handRect; context.window.innerHeight = before.height;
    board.scrollTop = before.scroll; panel.scrollHeight = before.panelScrollHeight;
    context.closeOpponentDetail();
  }
}
context.expandedSeat = 1; context.renderOpponentDetail();
assert(ids.get('opponentCounts').textContent.includes('155 melded'), 'expanded opponent details retain the public melded-point total');
assert(ids.get('opponentCounts').textContent.includes('11 in hand'), 'expanded details still include opponent card counts');
context.expandedSeat = null; context.renderOpponentDetail();
assert.deepEqual(context.seatNodes[1].melds.children[1].querySelectorAll('.card').map(card => card['aria-label'].split(' · ')[0]),
  ['KC0', 'KS0', 'KS1', 'KD0', 'KH0', 'XR0', '2H0'].map(E.label), 'opponent card fans use the same black-suit-first order');
assert(context.meldsSignature(opponent).includes('KC0,KS0,KS1,KD0,KH0,XR0,2H0'), 'opponent render signatures follow the displayed order');
context.finishedBookStyle = 'stacked';
context.view.seats[0].melds = [closed];
Object.assign(context.view.seats[0], { redBooks: 1, inFoot: true, redThrees: 2 });
element('myChips'); element('meldHint'); element('clearSel', 'button');
context.renderMine();
const retainedOwnBook = ids.get('myMelds').children[0];
const retainedOwnCard = retainedOwnBook.querySelector('.card');
context.renderMine();
assert.equal(ids.get('myMelds').children[0], retainedOwnBook, 'an unchanged table snapshot preserves the own-book node');
assert.equal(ids.get('myMelds').querySelector('.card'), retainedOwnCard, 'unchanged own books preserve their card nodes and animations');
assert.equal(ids.get('myMelds').querySelectorAll('.card').length, 1, 'a completed own book displays one stack face');
assert(retainedOwnCard.className.split(' ').includes('book-red'), 'the clean completed stack keeps its red-book color');
assert.equal(retainedOwnCard.querySelector('.r').textContent, '4', 'the stack face identifies its rank');
assert.equal(retainedOwnBook.querySelector('.meld-count').textContent, '7', 'the completed book retains its plain card count');
assert.equal(retainedOwnCard['aria-label'], '4s · 7 · red book', 'the stack face retains its complete accessible description');
assert.equal(retainedOwnCard.querySelector('.s').textContent, '♦', 'the displayed stack face retains the first card in the established red-suit-first order');
assert.deepEqual(closed.cards, ['4S1', '4H1', '4D1', '4C1', '4S2', '4H2', '4D2'], 'collapsing the visible stack does not remove or reorder model cards');
assert.equal(ids.get('myMeldedPoints').textContent, '35 melded', 'own book area reports the same public card-value total');
assert.equal(ids.get('myMeldedPoints').parentNode, ownBookStats, 'own melded points remain in the second-row statistics container');
assert.deepEqual(ids.get('myChips').children.map(chip => [chip.className, chip.textContent]),
  [['chip red', '1 red book'], ['chip foot', 'In foot']], 'own first-row pills follow the same book and in-foot rules as opponents');
{
  const before = { view: context.view, sel: context.sel, pending: context.actionPending };
  const cases = [
    { name: 'black book', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'XR0', '2H0'],
      markers: ['joker', 'deuce', undefined, undefined], complete: true, color: 'book-black' },
    { name: 'four-wild black book', cards: ['KS0', 'KH0', 'KD0', '2S0', 'XR0', '2H0', 'XB0'],
      markers: ['joker', 'joker', 'deuce', 'deuce'], complete: true, color: 'book-black' },
    { name: 'unfinished clean meld', cards: ['KS0', 'KH0', 'KD0', 'KC0', 'KS1', 'KH1'], complete: false },
    { name: 'unfinished dirty meld', cards: ['KS0', 'KH0', 'KD0', 'XR0'], complete: false },
  ];
  try {
    for (const fixture of cases) {
      const model = Object.freeze({ id: fixture.name, rank: 'K', cards: Object.freeze(fixture.cards.slice()) });
      const original = JSON.stringify(model);
      setup([model]); context.sel = []; context.actionPending = false;
      context.view.settings = Object.assign({}, E.DEFAULTS, { maxWildsInBook: 4 });
      assert(E.checkMeld(model.rank, model.cards, context.view.settings).ok);
      context.renderMine();
      const book = ids.get('myMelds').children[0], caption = book.querySelector('.meld-top');
      const faces = book.querySelectorAll('.card');
      assert.equal(faces.length, fixture.complete ? 1 : model.cards.length,
        fixture.name + ': only completed books collapse to one face');
      assert.equal(faces[0].querySelector('.r').textContent, 'K', fixture.name + ': the card face identifies the rank');
      assert.equal(caption.querySelector('.meld-count').textContent, String(model.cards.length),
        fixture.name + ': the plain count remains available without redundant book-color text');
      if (fixture.complete) {
        assert(faces[0].className.split(' ').includes(fixture.color), fixture.name + ': the face carries the correct book color');
        assert.equal(book.querySelectorAll('.closed-book-stack').length, 1);
        assert.deepEqual(['wildTop', 'wildBottom', 'wildTopExtra', 'wildBottomExtra'].map(key => faces[0].dataset[key]),
          fixture.markers, fixture.name + ': both trim edges retain every joker/deuce segment');
        assert(caption.title.includes('black book') && book['aria-label'].includes('black book'));
        for (const type of ['joker', 'deuce']) {
          const count = model.cards.filter(card => type === 'joker' ? E.isJoker(card) : E.isWild(card) && !E.isJoker(card)).length;
          const description = new RegExp('\\b' + count + ' ' + type + (count === 1 ? '\\b' : 's\\b'));
          assert.match(caption.title, description, fixture.name + ': the tooltip describes the exact ' + type + ' count');
          assert.match(faces[0]['aria-label'], description,
            fixture.name + ': the stack face exposes the exact ' + type + ' count to assistive technology');
        }
      } else {
        assert.equal(book.querySelectorAll('.closed-book-stack').length, 0, 'unfinished melds retain the full fan');
        assert.deepEqual(faces.map(card => card['aria-label']), [...context.orderMeldCards(model)].map(E.label),
          fixture.name + ': every actual card remains individually visible and described');
      }
      assert.equal(JSON.stringify(model), original, fixture.name + ': display changes never alter the full card model');
    }
  } finally {
    context.view = before.view; context.sel = before.sel; context.actionPending = before.pending;
    context.renderMine();
  }
}
{
  const before = { view: context.view, render: context.render, setTimeout: context.setTimeout,
    Date: vm.runInContext('Date', context), seen: context.seenCards, fresh: context.freshPlays, timer: context.freshTimer };
  let elapsed = 0, paints = 0, nextId = 0;
  const expiryTimers = new Map(), strip = new Element('div');
  try {
    context.Date = { now: () => elapsed };
    context.setTimeout = (callback, delay) => { expiryTimers.set(++nextId, { callback, delay }); return nextId; };
    context.seenCards = null; context.freshPlays = {}; context.freshTimer = null;
    context.view = { seats: [{ melds: [{ rank: '4', cards: ['4S0', '4H0', '4D0'] }] }], settings: E.DEFAULTS };
    context.render = () => { paints++; context.notePlays(); context.fillMelds(strip, context.view.seats[0]); };
    context.notePlays();
    context.view.seats[0].melds[0].cards.push('4C0'); context.notePlays();
    context.fillMelds(strip, context.view.seats[0]);
    assert.equal(strip.querySelectorAll('.just-played').length, 1, 'a newly played card is visibly highlighted');
    const originalMini = strip.querySelector('.just-played');
    for (let tick = 1; tick <= 6; tick++) {
      const [id, timer] = expiryTimers.entries().next().value;
      expiryTimers.delete(id); assert.equal(timer.delay, 700);
      elapsed = tick * 700; timer.callback();
      if (tick < 6) {
        assert.equal(paints, 0, 'a freshness tick does not render before the glow expires');
        assert.equal(strip.querySelector('.just-played'), originalMini, 'unexpired highlights keep their DOM and animation');
      }
    }
    assert.equal(paints, 1, 'expiry triggers exactly one repaint');
    assert.equal(strip.querySelectorAll('.just-played').length, 0, 'the expired highlight disappears');
    assert.equal(expiryTimers.size, 0, 'no timer remains after the last highlight expires');
  } finally {
    context.view = before.view; context.render = before.render; context.setTimeout = before.setTimeout;
    context.Date = before.Date; context.seenCards = before.seen; context.freshPlays = before.fresh; context.freshTimer = before.timer;
  }
}
assert(html.indexOf('id="automaticDrawLabel"') > html.indexOf('id="autoDrawPopover"') &&
  html.indexOf('id="autoDrawStatus"') < html.indexOf('id="cardSelectionLabel"') &&
  html.indexOf('id="cardSelectionLabel"') < html.indexOf('id="selectMatching"'), 'Auto separates automatic draw status from the following card-selection section');
assert(/id="selectMatching"[^>]*aria-label="Select matching ranks"[^>]*aria-describedby="matchingRanksHelp"/.test(html), 'matching-rank selection has an explicit accessible name and explanation');

// Penalty labels follow active rules, including zero, and do not borrow the
// queued next-round value or retain a cached tooltip from the previous rule.
{
  const before = { view: context.view, sel: context.sel, peekHidden: ids.get('peekSheet').hidden };
  try {
    setup(); context.sel = []; context.view.you.hand = ['3H0', 'QS0'];
    context.view.settings = Object.assign({}, E.DEFAULTS, { redThreeValue: -250 });
    context.view.pendingSettings = Object.assign({}, context.view.settings, { redThreeValue: -500 });
    context.renderHand();
    const redHandCard = () => ids.get('myHand').querySelectorAll('[data-card]').find(card => card.dataset.card === '3H0');
    assert(redHandCard().title.includes('−250 if you are still holding it'), 'held red threes show the active custom penalty');
    assert(!redHandCard().title.includes('500'), 'pending rules do not alter current card labels');
    context.view.settings.redThreeValue = 0; context.renderHand();
    assert(redHandCard().title.includes('0 if you are still holding it'), 'zero is a real penalty value and updates the cached hand label');
    delete context.view.settings.redThreeValue; context.renderHand();
    assert(redHandCard().title.includes('−100 if you are still holding it'), 'legacy missing values use the default penalty');

    context.view.settings.redThreeValue = -250;
    context.view.settings.redThreeAutoLayOff = true;
    context.view.you.hand = ['QS0']; context.view.you.redThrees = ['3D0'];
    context.renderMine();
    const laidThrees = ids.get('myMelds').querySelector('.threes');
    assert.equal(laidThrees.querySelector('.meld-top').textContent, 'Red threes · −250 each');
    assert.equal(laidThrees.querySelector('.card').title, E.label('3D0') + ' · −250 points', 'laid-off red three descriptions use the same active value');
    assert(context.seatChips({ redThrees: 2 }, true).some(chip => chip.textContent === '2 red threes · −250 each'), 'the own public red-three badge uses the configured penalty');
    context.view.discardTop = '3H1'; context.view.discardCount = 1;
    context.view.settings.revealPileTake = false; context.showPeek();
    assert.equal(ids.get('peekBody').querySelector('.card').title, E.label('3H1') + ' · −250 points', 'public discard inspection does not display the fixed engine card value for a red three');
  } finally {
    context.view = before.view; context.sel = before.sel; context.handSignature = null;
    ids.get('peekSheet').hidden = before.peekHidden; context.renderMine();
  }
}

const almostBook = { id: 'near-four', rank: '4', cards: closed.cards.slice(0, 6) };
const progressStrip = new Element('div');
context.finishedBookStyle = 'spread';
context.fillMelds(progressStrip, { melds: [almostBook] });
assert.equal(progressStrip.querySelector('.meld-rank').textContent, '4', 'opponent captions retain the compact rank');
assert.equal(progressStrip.querySelector('.meld-count').textContent, '6', 'opponent near-books keep their normal visible card count');
assert(progressStrip.children[0]['aria-label'].startsWith('4s · 6/7 · one card from a book'), 'near-book progress is available in the accessible description');
assert.equal(progressStrip.querySelector('.meld-top').title, '4s · 6/7 · one card from a book');
context.opponentMeldStyle = 'tiles';
context.fillMelds(progressStrip, { melds: [almostBook] });
assert.equal(progressStrip.children[0].dataset.presentation, 'stack', 'near-book Tiles shares the compact stack geometry');
assert(progressStrip.children[0].className.split(' ').includes('nearly-book'), 'condensed near-books keep the sideways-card cue');
assert.equal(progressStrip.querySelectorAll('.closed-book-face').length, 1);
assert.equal(progressStrip.querySelector('.meld-count').textContent, '6', 'condensing preserves the visible near-book count');
context.opponentMeldStyle = 'cards';
for (const [rank, label] of [['T', '10s'], ['J', 'Jacks'], ['Q', 'Queens'], ['K', 'Kings'], ['A', 'Aces']]) {
  context.fillMelds(progressStrip, { melds: [{ id: 'caption-' + rank, rank, cards: [rank + 'S0', rank + 'H0', rank + 'D0'] }] });
  assert.equal(progressStrip.querySelector('.meld-rank').textContent, rank === 'T' ? '10' : rank, 'opponent captions keep the familiar card rank');
  assert(progressStrip.children[0]['aria-label'].includes(label), 'opponent accessible descriptions retain the full readable rank name');
  assert.equal(progressStrip.querySelector('.meld-count').textContent, '3', 'the separate count stays available for the near-book cue');
}
for (const [wilds, top, bottom] of [
  [[], undefined, undefined], [['2H0'], 'deuce', undefined], [['XR0'], 'joker', undefined],
  [['2H0', '2S0'], 'deuce', 'deuce'], [['XR0', 'XB0'], 'joker', 'joker'], [['2H0', 'XR0'], 'joker', 'deuce'],
]) {
  context.opponentMeldStyle = 'tiles';
  context.fillMelds(progressStrip, { melds: [{ id: 'wild-trim', rank: '4', cards: ['4S1', '4H1', '4D1'].concat(wilds) }] });
  const compactFace = progressStrip.querySelector('.closed-book-face');
  assert.equal(progressStrip.children[0].dataset.presentation, 'stack', 'opponent Tiles uses the existing condensed stack');
  assert.equal(progressStrip.querySelectorAll('.card').length, 1, 'the condensed stack shows one real card face');
  assert.equal(compactFace.dataset.wildTop, top, 'first-wild metadata is preserved on the stack face');
  assert.equal(compactFace.dataset.wildBottom, bottom, 'second-wild metadata is preserved on the stack face');
  assert.equal(compactFace.dataset.wildTopExtra, undefined, 'zero to two wilds have no third-wild metadata');
  assert.equal(compactFace.dataset.wildBottomExtra, undefined);
  context.opponentMeldStyle = 'cards';
  context.fillMelds(progressStrip, { melds: [{ id: 'wild-trim', rank: '4', cards: ['4S1', '4H1', '4D1'].concat(wilds) }] });
  assert.equal(progressStrip.querySelectorAll('.card').length, 3 + wilds.length, 'the expanded public fan shows every actual card');
  assert.equal(progressStrip.querySelectorAll('.card.joker').length, wilds.filter(E.isJoker).length, 'joker cards reflect the exact joker count');
  assert.equal(progressStrip.querySelectorAll('.card.deuce').length, wilds.filter(c => !E.isJoker(c)).length, 'deuce cards reflect the exact deuce count');
  if (wilds.length) assert(/\d (joker|deuce)/.test(progressStrip.children[0]['aria-label']), 'wild counts are readable without relying on edge colors');
}
for (const [wilds, markers, countText] of [
  [['2S0', 'XB0', 'XR0'], ['joker', 'joker', 'deuce', undefined], '2 jokers, 1 deuce'],
  [['2S0', 'XR0', '2H0'], ['joker', 'deuce', 'deuce', undefined], '1 joker, 2 deuces'],
  [['2S0', 'XR0', '2H0', 'XB0'], ['joker', 'joker', 'deuce', 'deuce'], '2 jokers, 2 deuces'],
  [['2S0', '2H0', '2D0', '2C0'], ['deuce', 'deuce', 'deuce', 'deuce'], '4 deuces'],
  [['XR0', 'XB0', 'XR1', 'XB1'], ['joker', 'joker', 'joker', 'joker'], '4 jokers'],
]) {
  const book = { id: 'custom-wild-trim', rank: '4', cards: ['4S1', '4H1', '4D1'].concat(wilds) };
  assert(E.checkMeld(book.rank, book.cards, Object.assign({}, E.DEFAULTS, { maxWildsInBook: 4 })).ok);
  context.opponentMeldStyle = 'tiles'; context.finishedBookStyle = 'stacked';
  context.fillMelds(progressStrip, { melds: [book] });
  let tile = progressStrip.children[0];
  const compactFace = tile.querySelector('.closed-book-face');
  assert.deepEqual(['wildTop', 'wildBottom', 'wildTopExtra', 'wildBottomExtra'].map(key => compactFace.dataset[key]), markers,
    'custom wilds are distributed first/third on top and second/fourth below in display order');
  const ownStack = context.meldDisplayElement(book, 0, true);
  assert.equal(ownStack.dataset.presentation, 'stack', 'own Tiles uses the same condensed stack display');
  assert.deepEqual(['wildTop', 'wildBottom', 'wildTopExtra', 'wildBottomExtra'].map(key => ownStack.querySelector('.closed-book-face').dataset[key]), markers,
    'own condensed stacks retain all wildcard edge markers');
  context.opponentMeldStyle = 'cards'; context.finishedBookStyle = 'spread';
  context.fillMelds(progressStrip, { melds: [book] });
  tile = progressStrip.children[0];
  assert.equal(tile.querySelectorAll('.card.joker').length, wilds.filter(E.isJoker).length, 'custom rules retain one visible card for every joker');
  assert.equal(tile.querySelectorAll('.card.deuce').length, wilds.filter(c => !E.isJoker(c)).length, 'custom rules retain one visible card for every deuce');
  assert(tile['aria-label'].includes(countText), 'full wildcard counts remain available alongside the individual cards');
}
for (const count of [3, 7, 8]) {
  const cards = closed.cards.concat('4C2').slice(0, count);
  context.fillMelds(progressStrip, { melds: [{ id: 'ordinary', rank: '4', cards }] });
  assert.equal(progressStrip.querySelector('.meld-count').textContent, String(count), 'ordinary and completed melds keep their normal counts');
}
context.finishedBookStyle = 'stacked';
const priorOwnMelds = context.view.seats[0].melds;
context.view.seats[0].melds = [almostBook]; context.renderMine();
assert.equal(ids.get('myMelds').querySelector('.meld-count').textContent, '6', 'own near-books retain the same plain count as opponents');
assert.equal(ids.get('myMelds').querySelectorAll('.nearly-book').length, 1, 'own and opponent books share the one-card-short indication');
assert(ids.get('myMelds').querySelector('.nearly-book')['aria-label'].startsWith('4s · 6/7 · one card from a book'),
  'the own near-book cue has the same accessible explanation as an opponent book');
context.view.seats[0].melds = priorOwnMelds; context.renderMine();
assert.equal(ids.get('myMelds').querySelectorAll('.nearly-book').length, 0, 'completed own books do not retain the near-book indication');
const priorOpponentMelds = opponent.melds;
opponent.melds = [almostBook]; context.expandedSeat = 1; context.renderOpponentDetail();
assert.equal(ids.get('opponentMelds').querySelector('.meld-top').textContent, '4s · 6/7', 'expanded opponent captions keep their existing count without a progress badge');
opponent.melds = priorOpponentMelds; context.expandedSeat = null; context.renderOpponentDetail();

// One local display preference governs the same public books at every seat.
{
  const keys = ['hf_meld_style', 'hf_opponent_melds', 'hf_finished_books'];
  const before = { send: context.send, render: context.render, view: context.view, sel: context.sel,
    style: context.opponentMeldStyle, finished: context.finishedBookStyle, overrides: context.meldExpanded,
    storage: context.localStorage, rulesMode: context.rulesMode,
    saved: keys.map(key => storedPreferences.get(key)) };
  const ownOpen = { id: 'own-open-kings', rank: 'K', cards: ['KS0', 'KH0', 'KD0'] };
  const otherOpen = { id: 'other-open-kings', rank: 'K', cards: ['KS2', 'KH2', 'KD2'] };
  const paint = () => { context.renderSeats(); context.renderMine(); };
  const ownBooks = () => ids.get('myMelds').querySelectorAll('.meld');
  const otherBooks = () => context.seatNodes[1].melds.querySelectorAll('.meld');
  const allBooks = () => ownBooks().concat(otherBooks());
  try {
    keys.forEach(key => storedPreferences.delete(key)); context.loadLook();
    assert.equal(context.opponentMeldStyle, 'cards', 'a fresh browser uses Cards for all melds');
    assert.equal(context.finishedBookStyle, 'stacked', 'finished books initially use Stacked');
    storedPreferences.set('hf_opponent_melds', 'tiles'); context.loadLook();
    assert.equal(context.opponentMeldStyle, 'tiles', 'the old opponent-only preference migrates into the shared display');
    storedPreferences.set('hf_meld_style', 'cards'); context.loadLook();
    assert.equal(context.opponentMeldStyle, 'cards', 'an explicit shared preference takes precedence over the legacy value');
    storedPreferences.delete('hf_opponent_melds');
    for (const value of ['auto', 'strips', 'Tiles', 'unknown']) {
      storedPreferences.set('hf_meld_style', value); context.loadLook();
      assert.equal(context.opponentMeldStyle, 'cards', 'unsupported saved display choices fall back to Cards');
      assert.equal(storedPreferences.get('hf_meld_style'), value, 'reading preferences does not silently overwrite saved data');
    }
    storedPreferences.set('hf_finished_books', 'invalid'); context.loadLook();
    assert.equal(context.finishedBookStyle, 'stacked', 'invalid finished-book defaults fall back to Stacked');
    keys.forEach(key => storedPreferences.delete(key)); context.loadLook();
    setup([closed, ownOpen]); context.view.code = 'LOOK'; context.view.round = 0;
    context.view.seats.push({ name: 'Other', melds: [closed, otherOpen], handCount: 9, footCount: 11 });
    context.sel = ['4S0']; context.actionPending = false;
    const selection = [...context.sel], authoritative = context.view;
    const publicCards = JSON.stringify(context.view.seats.map(seat => seat.melds));
    context.render = paint; context.seatNodes = []; paint();
    context.send = () => { throw new Error('A display preference sent a server message'); };
    context.openRules('settings');
    const displayOptions = ids.get('preference-meld-display-cards').parentNode;
    assert.deepEqual(displayOptions.children.map(button => button.querySelector('.look-name').textContent), ['Cards', 'Tiles'],
      'Meld display offers exactly Cards and Tiles');
    const finishedOptions = ids.get('preference-finished-books-stacked').parentNode;
    assert.deepEqual(finishedOptions.children.map(button => button.querySelector('.look-name').textContent), ['Stacked', 'Spread'],
      'Finished books uses explicit Stacked and Spread labels');
    const finishedPicker = () => ids.get('preference-finished-books-stacked').parentNode.parentNode;
    assert.equal(finishedPicker().hidden, false, 'Cards exposes its finished-book default');
    const tilesButton = ids.get('preference-meld-display-tiles');
    tilesButton.focus(); tilesButton.onclick();
    assert.equal(storedPreferences.get('hf_meld_style'), 'tiles');
    assert.equal(ids.get('preference-meld-display-tiles')['aria-pressed'], 'true');
    assert.equal(document.activeElement, ids.get('preference-meld-display-tiles'), 'the shared preference preserves keyboard focus');
    assert(ownBooks().every(book => book.dataset.presentation === 'stack'), 'Tiles uses the existing own condensed stack display');
    assert(otherBooks().every(book => book.dataset.presentation === 'stack'), 'Tiles condenses opponents with the existing stack display');
    assert.equal(context.seatNodes[1].melds.dataset.layout, 'strips', 'opponents retain the same strip layout as Stacked');
    assert.equal(ids.get('myMelds').dataset.layout, 'cards', 'own Tiles retains the same shelf and new-meld slot geometry as Stacked');
    assert(allBooks().every(book => book['aria-expanded'] === 'false'));
    assert.equal(finishedPicker().hidden, false, 'Tiles keeps Finished books visible and usable');
    assert.equal(allBooks().flatMap(book => book.querySelectorAll('.mini')).length, 0, 'the old blank miniature strips are absent');
    const rebuilt = new Element('div'); context.fillMelds(rebuilt, { melds: [otherOpen] }, 1);
    assert.equal(rebuilt.children[0].dataset.presentation, 'stack', 'new opponent snapshots follow the condensed choice');
    assert.deepEqual([...context.sel], selection, 'switching display preserves selected hand cards');
    assert.equal(context.view, authoritative, 'display changes retain the authoritative view');
    assert.equal(JSON.stringify(context.view.seats.map(seat => seat.melds)), publicCards, 'display changes never mutate any public book');
    assert.equal(context.setOpponentMeldStyle('auto'), false, 'the compatibility setter refuses unsupported modes');
    assert.equal(context.setFinishedBookStyle('auto'), false, 'the default-book setter refuses unsupported modes');
    ids.get('preference-finished-books-spread').onclick();
    assert.equal(storedPreferences.get('hf_finished_books'), 'spread');
    assert.equal(ids.get('preference-finished-books-spread')['aria-pressed'], 'true');
    assert.equal(ids.get('preference-meld-display-tiles')['aria-pressed'], 'true', 'changing finished-book presentation preserves Tiles');
    assert.deepEqual(ownBooks().map(book => book.dataset.presentation), ['fan', 'stack']);
    assert.deepEqual(otherBooks().map(book => book.dataset.presentation), ['fan', 'stack'],
      'Tiles plus Spread opens completed books and keeps unfinished opponent melds condensed');
    assert.deepEqual(ownBooks().map(book => book.querySelectorAll('.card').length), [7, 1]);
    assert.deepEqual(otherBooks().map(book => book.querySelectorAll('.card').length), [7, 1]);
    ids.get('preference-finished-books-stacked').onclick();
    assert.equal(storedPreferences.get('hf_finished_books'), 'stacked');
    assert.equal(ids.get('preference-finished-books-stacked')['aria-pressed'], 'true');
    assert(ownBooks().every(book => book.dataset.presentation === 'stack'), 'Stacked closes own completed books without leaving Tiles');
    assert(otherBooks().every(book => book.dataset.presentation === 'stack'), 'Stacked closes opponent completed books into the same condensed display');
    assert(allBooks().every(book => book['aria-expanded'] === 'false'));
    ids.get('preference-finished-books-spread').onclick();
    assert.deepEqual(ownBooks().map(book => book.dataset.presentation), ['fan', 'stack']);
    assert.deepEqual(otherBooks().map(book => book.dataset.presentation), ['fan', 'stack'], 'Spread can reopen completed opponent books repeatedly in Tiles');
    assert.deepEqual([...context.sel], selection, 'both finished-book transitions preserve the selected hand cards');
    ids.get('preference-meld-display-cards').onclick();
    assert.equal(finishedPicker().hidden, false, 'Finished books remains visible when returning to Cards');
    assert(allBooks().every(book => book.dataset.presentation === 'fan'), 'Cards plus Spread expands both finished and unfinished books at every seat');
    assert.deepEqual(ownBooks().map(book => book.querySelectorAll('.card').length), [7, 3]);
    assert.deepEqual(otherBooks().map(book => book.querySelectorAll('.card').length), [7, 3]);
    ids.get('preference-finished-books-stacked').onclick();
    assert.deepEqual(ownBooks().map(book => book.dataset.presentation), ['stack', 'fan']);
    assert.deepEqual(otherBooks().map(book => book.dataset.presentation), ['stack', 'fan'], 'Stacked affects completed books without hiding unfinished fans');
    context.setOpponentMeldStyle('tiles'); context.setFinishedBookStyle('spread');
    context.opponentMeldStyle = 'cards'; context.finishedBookStyle = 'stacked'; context.loadLook();
    assert.equal(context.opponentMeldStyle, 'tiles'); assert.equal(context.finishedBookStyle, 'spread', 'both shared defaults survive reload');
    paint(); context.openRules('settings');
    assert.equal(finishedPicker().hidden, false, 'the restored Tiles preference still exposes Finished books');
    assert.equal(ids.get('preference-meld-display-tiles')['aria-pressed'], 'true');
    assert.equal(ids.get('preference-finished-books-spread')['aria-pressed'], 'true');
    assert.deepEqual(ownBooks().map(book => book.dataset.presentation), ['fan', 'stack']);
    assert.deepEqual(otherBooks().map(book => book.dataset.presentation), ['fan', 'stack'], 'reloaded settings restore expanded completed and condensed unfinished opponent books');
    assert.equal(JSON.stringify(context.view.seats.map(seat => seat.melds)), publicCards, 'presentation and reload leave every public card intact');
    context.localStorage = { getItem() { return null; } }; context.loadLook();
    assert.equal(context.opponentMeldStyle, 'cards'); assert.equal(context.finishedBookStyle, 'stacked', 'another browser has independent defaults');
    context.localStorage = before.storage; context.loadLook();
    assert.equal(context.opponentMeldStyle, 'tiles'); assert.equal(context.finishedBookStyle, 'spread');
  } finally {
    context.send = before.send; context.render = before.render; context.view = before.view; context.sel = before.sel;
    context.localStorage = before.storage; context.opponentMeldStyle = before.style;
    context.finishedBookStyle = before.finished; context.meldExpanded = before.overrides; context.rulesMode = before.rulesMode;
    keys.forEach((key, index) => {
      if (before.saved[index] === undefined) storedPreferences.delete(key); else storedPreferences.set(key, before.saved[index]);
    });
    context.seatNodes = []; context.renderSeats(); context.renderMine();
  }
}

// Disclosure is local and keyboard-accessible; a pointer double-tap only
// changes presentation, even when selected cards could be played.
{
  const before = { view: context.view, sel: context.sel, send: context.send, style: context.opponentMeldStyle,
    finished: context.finishedBookStyle, overrides: context.meldExpanded, displayContext: context.meldDisplayContext,
    pending: context.actionPending, lastTap: context.lastMeldTap,
    seen: context.seenCards, fresh: context.freshPlays, timer: context.freshTimer,
    savedStyle: storedPreferences.get('hf_meld_style'), savedLegacy: storedPreferences.get('hf_opponent_melds'),
    savedFinished: storedPreferences.get('hf_finished_books') };
  // The real render resets disclosure at table/round boundaries, so mount its
  // ordinary static controls rather than replacing that lifecycle behavior.
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    if (ids.has(match[3])) continue;
    const node = element(match[3], match[1]);
    node.className = (match[2].match(/class="([^"]*)"/) || [])[1] || '';
    node.hidden = /\bhidden\b/.test(match[2]);
  }
  const requests = [];
  const book = (seat, id) => (seat === 0 ? ids.get('myMelds') : context.seatNodes[seat].melds)
    .querySelectorAll('button').find(node => node.dataset.meldId === id);
  try {
    const openKings = { id: 'disclosure-open', rank: 'K', cards: ['KS0', 'KH0', 'KD0'] };
    setup([closed, openKings]); context.view.code = 'DSPL'; context.view.round = 0;
    context.view.roundsTotal = 4; context.view.stocks = [10, 10, 10, 10]; context.view.discardCount = 0;
    context.view.seats.push({ name: 'Other', melds: [closed], handCount: 9, footCount: 11 });
    context.sel = []; context.actionPending = false; context.lastMeldTap = null;
    context.opponentMeldStyle = 'cards'; context.finishedBookStyle = 'stacked'; context.meldExpanded = {};
    context.send = message => { requests.push(JSON.parse(JSON.stringify(message))); return true; };
    const publicBefore = JSON.stringify(context.view.seats.map(seat => seat.melds));
    context.render();
    assert.equal(ids.get('turnPill').hidden, false); assert.equal(ids.get('turnPill').textContent, 'Your turn');
    context.view.turn = 1; context.render();
    assert.equal(ids.get('turnPill').hidden, true, 'opponent turns do not show a second turn pill');
    assert(context.seatNodes[1].seat.className.split(' ').includes('active'), 'the whole opponent panel carries the active-turn state');
    assert(!context.seatNodes[0].seat.className.split(' ').includes('active'));
    context.view.turn = 0; context.render();
    assert.equal(book(0, closed.id).tagName, 'button');
    assert.equal(book(0, closed.id)['aria-expanded'], 'false');
    assert.equal(book(0, openKings.id).dataset.presentation, 'fan', 'Cards initially shows unfinished cards');
    book(0, closed.id).onclick({ detail: 1 });
    assert.equal(book(0, closed.id).dataset.presentation, 'stack', 'one pointer tap with no selection does not change the view');
    book(0, closed.id).onclick({ detail: 2 });
    assert.equal(book(0, closed.id).dataset.presentation, 'fan');
    assert.equal(book(0, closed.id)['aria-expanded'], 'true');
    assert.equal(book(0, closed.id).querySelectorAll('.card').length, 7, 'double-tapping a stack reveals every public card');
    assert.equal(book(1, closed.id).dataset.presentation, 'stack', 'matching IDs at another seat have independent disclosure');
    book(0, closed.id).onclick({ detail: 1 });
    book(0, closed.id).onclick({ detail: 2 });
    assert.equal(book(0, closed.id).dataset.presentation, 'stack', 'the next display click collapses the book');
    book(1, closed.id).focus(); book(1, closed.id).onclick({ detail: 0 });
    assert.equal(book(1, closed.id).dataset.presentation, 'fan', 'keyboard activation also expands an opponent book');
    assert.equal(document.activeElement, book(1, closed.id), 'keyboard focus follows the rebuilt disclosure control');
    const expandedOpponent = book(1, closed.id);
    context.view.log = [{ t: 'connected', seat: 1 }]; context.render();
    assert.equal(book(1, closed.id), expandedOpponent, 'unrelated snapshots retain the expanded book and its DOM');
    book(0, openKings.id).onclick({ detail: 0 });
    assert.equal(book(0, openKings.id).dataset.presentation, 'stack', 'unfinished fans can also be collapsed individually');
    context.setFinishedBookStyle('spread');
    assert.equal(book(0, openKings.id).dataset.presentation, 'fan', 'a new default resets the previous per-book override');
    assert.equal(book(0, closed.id).dataset.presentation, 'fan', 'Spread opens completed books');
    context.setOpponentMeldStyle('tiles');
    assert.equal(book(0, closed.id).dataset.presentation, 'fan', 'Tiles retains the completed-book Spread preference');
    assert.equal(book(0, openKings.id).dataset.presentation, 'stack');
    assert.equal(book(1, closed.id).dataset.presentation, 'fan');
    book(0, closed.id).onclick({ detail: 0 });
    assert.equal(book(0, closed.id).dataset.presentation, 'stack', 'a local collapse overrides Spread while using Tiles');
    assert.equal(book(1, closed.id).dataset.presentation, 'fan', 'the other seat keeps its Spread default');
    book(0, closed.id).onclick({ detail: 0 });
    assert.equal(book(0, closed.id).dataset.presentation, 'fan', 'the same compact stack can reopen without changing either preference');
    context.setFinishedBookStyle('stacked');
    assert.equal(book(0, closed.id).dataset.presentation, 'stack', 'changing the default clears temporary compact expansion');
    assert.equal(book(1, closed.id).dataset.presentation, 'stack', 'Stacked also closes the opponent completed book');
    const condensedOpponent = book(1, closed.id);
    book(1, closed.id).onclick({ detail: 1 });
    assert.equal(book(1, closed.id), condensedOpponent, 'a single opponent tap keeps the condensed view');
    book(1, closed.id).onclick({ detail: 2 });
    assert.equal(book(1, closed.id).dataset.presentation, 'fan', 'double-tapping opponent Tiles expands the real cards');
    assert.equal(book(1, closed.id).querySelectorAll('.card').length, 7);
    book(1, closed.id).onclick({ detail: 1 });
    book(1, closed.id).onclick({ detail: 2 });
    assert.equal(book(1, closed.id).dataset.presentation, 'stack', 'double-tapping again returns to the same condensed stack');
    assert.equal(book(1, closed.id).querySelectorAll('.closed-book-face').length, 1);
    book(0, closed.id).onclick({ detail: 0 });
    assert.equal(book(0, closed.id).dataset.presentation, 'fan', 'a local expansion overrides Stacked in Tiles');
    assert.equal(book(1, closed.id).dataset.presentation, 'stack', 'local expansion leaves the opponent book condensed');
    context.setOpponentMeldStyle('cards');
    context.sel = ['2S0']; context.render();
    assert(!book(0, closed.id).className.split(' ').includes('target'));
    book(0, closed.id).onclick({ detail: 1 });
    book(0, closed.id).onclick({ detail: 2 });
    assert.equal(book(0, closed.id).dataset.presentation, 'fan', 'an illegal add selection still permits safe book inspection');
    assert.deepEqual([...context.sel], ['2S0']);
    context.setOpponentMeldStyle('tiles'); context.sel = ['4S0']; context.lastMeldTap = null; context.render();
    book(0, closed.id).onclick({ detail: 1 });
    assert.equal(book(0, closed.id).dataset.presentation, 'stack', 'the first tap leaves presentation stable while waiting for a possible double-tap');
    assert(!footerAction('addToBookAction'), 'there is no separate Add button competing with Discard');
    book(0, closed.id).onclick({ detail: 2 });
    assert.equal(book(0, closed.id).dataset.presentation, 'fan', 'a selected-card double-tap expands instead of playing');
    assert.equal(requests.length, 0, 'display gestures send no game action');
    context.sel = []; context.lastMeldTap = null;
    context.setOpponentMeldStyle('cards');
    book(0, closed.id).onclick({ detail: 0 });
    assert.equal(book(0, closed.id).dataset.presentation, 'fan');
    context.view.round = 1; context.render();
    assert.equal(book(0, closed.id).dataset.presentation, 'stack', 'a new round applies the saved default');
    context.view.round = 0; context.render();
    assert.equal(book(0, closed.id).dataset.presentation, 'stack', 'returning to an earlier round cannot resurrect discarded overrides');
    book(0, closed.id).onclick({ detail: 0 });
    context.view.code = 'OTHR'; context.render();
    assert.equal(book(0, closed.id).dataset.presentation, 'stack', 'another table has independent disclosure');
    context.view.code = 'DSPL'; context.render();
    assert.equal(book(0, closed.id).dataset.presentation, 'stack', 'returning to a table starts from the configured default');
    assert.equal(JSON.stringify(context.view.seats.map(seat => seat.melds)), publicBefore, 'disclosure never mutates the full public card models');
    assert.equal(requests.length, 0);
  } finally {
    context.view = before.view; context.sel = before.sel; context.send = before.send;
    context.opponentMeldStyle = before.style; context.finishedBookStyle = before.finished;
    context.meldExpanded = before.overrides; context.meldDisplayContext = before.displayContext;
    context.cancelMeldTap(); context.actionPending = before.pending; context.lastMeldTap = before.lastTap;
    context.seenCards = before.seen; context.freshPlays = before.fresh; context.freshTimer = before.timer;
    for (const [key, value] of [['hf_meld_style', before.savedStyle], ['hf_opponent_melds', before.savedLegacy], ['hf_finished_books', before.savedFinished]]) {
      if (value === undefined) storedPreferences.delete(key); else storedPreferences.set(key, value);
    }
    context.seatNodes = []; context.renderSeats(); context.renderMine();
  }
}

context.view = null; context.openRules('settings');
assert.equal(ids.get('rulesTitle').textContent, 'Settings');
assert(ids.get('leaveBtn').hidden, 'no leave action in lobby settings');
const settingLabels = ids.get('rulesBody').querySelectorAll('.rule-title').map(node => node.textContent);
assert(settingLabels.includes('Interactions') && settingLabels.includes('Meld display') && settingLabels.includes('Finished books'));
assert(!settingLabels.includes('Cards') && !settingLabels.includes('Table'), 'Appearance owns themes and card styles');
assert(!settingLabels.includes('Hand layout') && !settingLabels.includes('Sort cards'), 'Sort popover owns layout and sorting');
assert(ids.get('rulesBody').contains(ids.get('ruleNudge')), 'turn alerts remain in Settings');
assert(ids.get('rulesBody').contains(ids.get('cardMotionToggle')), 'card movement remains a native personal toggle');
assert.equal(ids.get('rulesBody').querySelectorAll('.preference-book-sample').length, 4, 'both meld and completed-book choices have visual samples');
for (const id of ['preference-meld-display-tiles', 'preference-finished-books-stacked']) {
  const compactSample = ids.get(id).querySelector('.preference-book-sample');
  assert.equal(compactSample.dataset.presentation, 'stacked', 'Tiles and Stacked previews share the compact card treatment');
  assert.equal(compactSample.querySelectorAll('.card').length, 1);
}
for (const mode of ['tap', 'buttons']) {
  const option = ids.get('preference-interactions-' + mode);
  const preview = option.querySelector('.interaction-preview');
  assert(preview, 'each interaction mode has a visual preview');
  assert.equal(preview['aria-hidden'], 'true', 'preview art does not alter the option’s accessible name');
  assert.equal(option.querySelector('.look-name').textContent, mode === 'tap' ? 'Tap' : 'Buttons');
  assert.equal(preview.querySelectorAll('button').length, 0, 'preview art adds no nested controls');
  assert.equal(preview.querySelectorAll('.interaction-preview-card.is-selected').length, 1);
  if (mode === 'tap') {
    assert.deepEqual(preview.querySelectorAll('.interaction-preview-caption').map(caption => caption.textContent), ['Book', 'Pile'],
      'Tap illustrates both card destinations');
  } else {
    assert.deepEqual(preview.querySelectorAll('.interaction-preview-action').map(action => action.textContent), ['New meld', 'Discard'],
      'Buttons illustrates the fixed action row');
  }
}
{
  const previousMode = context.interactionMode, savedMode = storedPreferences.get('hf_interactions');
  const option = ids.get('preference-interactions-buttons'); option.focus(); option.onclick();
  assert.equal(context.interactionMode, 'buttons', 'the preview remains inside the existing selectable preference');
  assert.equal(storedPreferences.get('hf_interactions'), 'buttons');
  assert.equal(ids.get('preference-interactions-buttons')['aria-pressed'], 'true');
  assert.equal(document.activeElement, ids.get('preference-interactions-buttons'), 'selecting an illustrated option retains keyboard focus');
  context.setInteractionMode(previousMode);
  if (savedMode === undefined) storedPreferences.delete('hf_interactions'); else storedPreferences.set('hf_interactions', savedMode);
}
assert(ids.get('rulesSaveBar').hidden, 'personal preferences never expose a shared-rules save button');
assert.deepEqual(ids.get('rulesBody').querySelector('.rules-tabs').children.map(node => node.textContent), ['Rules', 'Settings', 'Appearance']);
context.openRules('appearance');
assert.equal(ids.get('rulesTitle').textContent, 'Appearance');
assert(!ids.get('rulesBody').contains(ids.get('ruleNudge')), 'Appearance excludes turn alerts');
const oldPreference = ids.get('preference-table-midnight');
oldPreference.focus();
context.renderRules();
assert.equal(ids.get('preference-table-midnight'), oldPreference, 'unrelated table messages leave settings controls mounted');
oldPreference.onclick();
assert.equal(document.activeElement, ids.get('preference-table-midnight'), 'changing a preference retains focus on the replacement control');
context.openRules('rules');
assert.equal(ids.get('rulesTitle').textContent, 'Rules');
assert(ids.get('rulesBody').querySelector('table'), 'lobby rules render without a game state');
function ruleOverview() {
  const overview = ids.get('rulesBody').querySelector('.rules-overview');
  assert(overview && overview.children.length === 4, 'the rules overview contains four readable facts');
  return Object.fromEntries(overview.children.map(cell =>
    [cell.querySelector('span').textContent, cell.querySelector('b').textContent]));
}
function assertAllRulesAccessible() {
  const sections = ids.get('rulesBody').querySelectorAll('.rules-detail');
  assert.equal(sections.length, 3, 'the complete rule reference has three disclosure sections');
  assert(sections.every(section => section.tagName === 'details' && section.children[0].tagName === 'summary'),
    'each rule group uses a native keyboard-accessible disclosure');
  assert.deepEqual(sections.map(section => section.querySelector('summary').textContent),
    ['Dealing and taking cards', 'Melds, books and going out', 'Threes']);
  const labels = sections.flatMap(section => section.querySelectorAll('tr').map(row => {
    const firstCell = row.innerHTML.match(/^<td>([^<]+)<\/td>/);
    assert(firstCell, 'each reference row retains its rule label'); return firstCell[1];
  }));
  assert.deepEqual(labels.slice().sort(), ['Decks', 'Deal', 'Draw piles', 'Taking the pile', 'Discard preview',
    'Going down', 'Book', 'Wilds', 'Threes', 'Red threes', 'Going out', 'In your foot', 'Stock recycling'].sort(),
  'all thirteen original rule topics remain accessible exactly once');
}
assertAllRulesAccessible();
assert.deepEqual(ruleOverview(), { Decks: 'Auto', 'Book goal': '1 red · 1 black', 'Pile pickup': '7 cards', Opening: '50 points' });

// The host edits a validated next-round patch, never the active hand's rules.
{
  const originalAct = context.act;
  const requests = [];
  context.act = (action, extra) => { requests.push({ action, rules: JSON.parse(JSON.stringify(extra.rules)) }); return true; };
  setup(); context.view.code = 'RULE'; context.view.round = 0;
  context.view.seats = [{ name: 'Host', melds: [] }, { name: 'Vic', melds: [] }, { name: 'Sam', melds: [] }, { name: 'Maya', melds: [] }];
  context.view.hostSeat = 0; context.view.canConfigureRules = false; context.view.pendingSettings = null;
  context.openRules('rules');
  assertAllRulesAccessible();
  assert.equal(ruleOverview().Decks, '6', 'the active overview resolves automatic decks from table size');
  assert(!ids.get('rulesBody').querySelector('form'), 'other seats see rules without editable controls');
  assert(ids.get('rulesOwnerNote').textContent.includes('Host'));
  context.openRules('edit');
  assert.equal(context.rulesEditing, false, 'non-hosts cannot enter edit mode');
  assert.equal(ids.get('rulesReference').hidden, false);
  assert.equal(ids.get('rulesSaveBar').hidden, true);
  assert.equal(context.submitRulesConfig(), false); assert.equal(requests.length, 0);
  context.view.canConfigureRules = true; context.renderRules();
  assert(ids.get('rulesBody').querySelector('form'), 'the authorized host receives the rule editor');
  assert.equal(ids.get('rulesEditor').hidden, true, 'reading rules does not show the host editor by default');
  assert.equal(ids.get('rulesReference').hidden, false);
  assert.equal(ids.get('rulesSaveBar').hidden, true);
  ids.get('editTableRules').onclick();
  assert.equal(context.rulesEditing, true);
  assert.equal(ids.get('rulesReference').hidden, true, 'editing hides the reference rather than stacking both screens');
  assert.equal(ids.get('rulesEditor').hidden, false);
  assert.equal(ids.get('rulesSaveBar').hidden, false);
  assert.equal(document.activeElement, ids.get('rulesEditorTitle'), 'explicit edit navigation focuses its heading');
  assert.equal(ids.get('saveRulesConfig').type, 'submit');
  assert.equal(ids.get('saveRulesConfig').form, 'rulesEditor', 'the external Save button retains a native form association');
  assert(ids.get('rulesSaveBar').contains(ids.get('saveRulesConfig')) && !ids.get('rulesBody').contains(ids.get('saveRulesConfig')),
    'Save is outside the scrolling body and still belongs to its real form');
  const editGroup = name => ids.get('rulesEditor').querySelectorAll('.rules-edit-group').find(section => section.querySelector('summary').textContent === name);
  assert.equal(editGroup('Deal').open, true);
  assert(!editGroup('Books and pickup').open, 'advanced editor sections start compact');
  editGroup('Books and pickup').open = true;
  ids.get('ruleMaxWilds').focus();
  context.view.reshufflesRemaining = 1; context.renderRules();
  assert.equal(editGroup('Books and pickup').open, true, 'table-state updates preserve an open group containing focus');
  assert.equal(document.activeElement, ids.get('ruleMaxWilds'), 'focus is restored to the visible rebuilt field');
  editGroup('Points').querySelector('summary').focus();
  context.view.reshufflesRemaining = 2; context.renderRules();
  assert.equal(document.activeElement, editGroup('Points').querySelector('summary'), 'a closed group summary keeps keyboard focus during updates');
  assert(!editGroup('Points').open, 'restoring summary focus does not unexpectedly open its group');
  assert.equal(ids.get('rulesEditor').querySelector('h3').textContent, 'Change table rules', 'editable settings have a distinct heading');
  assert(ids.get('rulesBody').querySelectorAll('.rules-detail').every(section => !section.contains(ids.get('rulesEditor'))),
    'the host editor remains reachable outside collapsed reference sections');
  assert.equal(ids.get('ruleDeckCount').value, '0');
  assert.equal(ids.get('rulePickupTotal').value, '7', 'pickup is displayed as a total, including the top card');
  assert.equal(ids.get('saveRulesConfig').textContent, 'Save for next round');
  const draftHand = ids.get('ruleHandSize'); draftHand.value = '12'; draftHand.focus();
  const openReference = ids.get('rulesBody').querySelector('.rules-detail'); openReference.open = true;
  context.renderRules();
  assert.equal(ids.get('rulesBody').querySelector('.rules-detail'), openReference);
  assert.equal(openReference.open, true, 'unrelated updates preserve an open reference group alongside the draft');
  assert.equal(ids.get('ruleHandSize'), draftHand, 'unrelated updates leave an in-progress rules draft mounted');
  assert.equal(document.activeElement, draftHand);
  ids.get('readTableRules').focus(); ids.get('readTableRules').onclick();
  assert.equal(ids.get('rulesReference').hidden, false);
  assert.equal(ids.get('rulesEditor').hidden, true);
  assert.equal(ids.get('rulesSaveBar').hidden, true);
  assert.equal(document.activeElement, ids.get('editTableRules'), 'Read rules moves focus out of the removed footer into visible reference content');
  context.openRules('settings');
  assert.equal(ids.get('rulesSaveBar').hidden, true);
  context.openRules('edit');
  assert.equal(ids.get('ruleHandSize').value, '12', 'reference and preferences navigation preserve unsaved rule values');
  assert.equal(editGroup('Books and pickup').open, true, 'returning to editing restores its disclosure state');
  ids.get('ruleHandSize').focus();
  ids.get('rulePickupTotal').value = '';
  ids.get('ruleOpening0').value = '2.5';
  ids.get('ruleReshuffleOnce').checked = false;
  context.view.reshufflesRemaining = 0; context.renderRules();
  assertAllRulesAccessible();
  assert.equal(ids.get('ruleHandSize').value, '12', 'a reshuffle update preserves an unsaved valid field');
  assert.equal(ids.get('rulePickupTotal').value, '', 'a reshuffle update preserves an unfinished blank numeric field');
  assert.equal(ids.get('ruleOpening0').value, '2.5', 'a reshuffle update preserves raw invalid input for correction');
  assert.equal(ids.get('ruleReshuffleOnce').checked, false, 'a reshuffle update preserves an unsaved checkbox');
  assert.equal(document.activeElement, ids.get('ruleHandSize'), 'a rebuilt rule editor restores the focused field');
  context.view.phase = 'roundEnd'; context.renderRules();
  assert.equal(ids.get('rulePickupTotal').value, '', 'a phase update also preserves the raw unsaved draft');
  assert.equal(ids.get('ruleOpening0').value, '2.5');
  context.view.phase = 'playing'; context.renderRules();
  ids.get('ruleReshuffleOnce').checked = true;
  ids.get('rulePickupTotal').value = '10'; ids.get('ruleOpening0').value = '60';
  ids.get('saveRulesConfig').focus();
  assert.equal(context.submitRulesConfig(), true);
  assert.deepEqual(requests[0], { action: 'configureRules', rules: { handSize: 12, pileTakeExtra: 9, minMelds: [60, 90, 120, 150] } }, 'only changed editable canonical fields are sent');
  assert.equal(context.view.settings.handSize, 11, 'submitting leaves active settings untouched');
  assert.equal(ids.get('saveRulesConfig').disabled, true);
  assert.equal(context.rulesConfigRequest.focusId, 'saveRulesConfig', 'the initiating control is captured before Save is disabled');
  document.activeElement = document.body; // Native browsers may blur disabled buttons.
  assert.equal(context.submitRulesConfig(), false, 'pending configuration cannot be submitted twice');
  context.acknowledgeRulesConfig();
  assert(context.rulesConfigRequest, 'an unrelated state does not falsely acknowledge a rules save');
  context.view.pendingSettings = E.validateSettings(requests[0].rules, 4, E.DEFAULTS).settings;
  context.acknowledgeRulesConfig(); context.renderRules();
  assert.equal(context.rulesConfigRequest, null);
  assert.equal(document.activeElement, ids.get('saveRulesConfig'), 'a save acknowledgment preserves focus on the rebuilt external Save button');
  assert.equal(editGroup('Books and pickup').open, true, 'saving does not collapse unrelated editor groups');
  assert(ids.get('rulesConfigStatus').textContent.includes('current round is unchanged'));
  assert(ids.get('rulesPendingSummary').children.some(line => line.textContent.includes('11 → 12')));
  assert.equal(ids.get('ruleHandSize').value, '12', 'the editor starts from the queued values');
  assert.equal(ruleOverview()['Pile pickup'], '7 cards', 'the overview reports active pickup rules while edits are queued');
  assert.equal(ruleOverview().Opening, '50 points', 'queued opening changes do not replace the current-round overview');
  ids.get('ruleFootSize').value = '13';
  assert.equal(context.submitRulesConfig(), true);
  assert.deepEqual(requests[1].rules, { footSize: 13 }, 'a later patch keeps earlier queued rules rather than resetting them');
  document.activeElement = document.documentElement;
  context.finishRulesConfig(false, 'Server refused the rule change.');
  assert.equal(ids.get('ruleFootSize').value, '13', 'a refused change retains the local draft');
  assert.equal(ids.get('saveRulesConfig').disabled, false);
  assert.equal(document.activeElement, ids.get('saveRulesConfig'), 'a refused request also restores focus lost to disabling');
  ids.get('ruleFootSize').value = '14'; ids.get('saveRulesConfig').focus();
  assert.equal(context.submitRulesConfig(), true);
  const userFocus = element('rules-review-other-focus', 'button'); userFocus.focus();
  context.finishRulesConfig(false, 'Refused after user moved focus.');
  assert.equal(document.activeElement, userFocus, 'request completion cannot steal an intentional focus change');
  ids.get('ruleFootSize').value = '13'; ids.get('ruleFootSize').focus();
  const oldRulesTimeout = context.setTimeout;
  let rulesTimeout;
  context.setTimeout = (callback, delay) => { if (delay === 10000) rulesTimeout = callback; return 87; };
  assert.equal(context.submitRulesConfig(), true);
  assert.equal(context.rulesConfigRequest.focusId, 'ruleFootSize', 'Return from an input remembers the field instead of forcing Save focus');
  document.activeElement = document.body;
  rulesTimeout(); context.setTimeout = oldRulesTimeout;
  assert.equal(context.rulesConfigRequest, null);
  assert.equal(document.activeElement, ids.get('ruleFootSize'), 'timeout recovery restores the initiating field');
  assert.match(ids.get('rulesConfigStatus').textContent, /No confirmation received/);
  ids.get('saveRulesConfig').focus(); assert.equal(context.submitRulesConfig(), true);
  context.openRules('settings'); document.activeElement = document.body;
  context.finishRulesConfig(false, 'Finished after leaving editor.');
  assert.equal(document.activeElement, document.body, 'completion cannot refocus a hidden editor after navigation');
  context.openRules('edit');
  ids.get('ruleFootSize').value = '11';
  const beforeInvalid = requests.length;
  for (const [id, value] of [['ruleDeckCount', '1'], ['ruleHandSize', ''], ['rulePickupTotal', '0'], ['ruleBookSize', '3.5'], ['ruleMaxWilds', '0']]) {
    const control = ids.get(id), prior = control.value; control.value = value;
    assert.equal(context.submitRulesConfig(), false, id + ' invalid or impossible value is refused');
    assert(ids.get('rulesConfigStatus').textContent.length > 0); control.value = prior;
  }
  assert.equal(requests.length, beforeInvalid, 'invalid edits never reach the server');
  ids.get('ruleMaxWilds').focus();
  context.view.canConfigureRules = false; context.renderRules();
  assert(!ids.get('rulesBody').querySelector('form'));
  assert.equal(context.rulesEditing, false, 'host permission loss exits edit mode');
  assert.equal(ids.get('rulesReference').hidden, false);
  assert.equal(ids.get('rulesSaveBar').hidden, true, 'host permission loss removes all external save controls');
  assert.equal(ids.get('leaveBtn').hidden, false, 'leaving remains available after edit permission is removed');
  assert.equal(document.activeElement, ids.get('rules-tab-rules'), 'permission loss restores visible focus rather than leaving it on a removed field');
  assert.equal(context.submitRulesConfig(), false);
  assert(ids.get('rulesBody').children.some(node => node.id === 'rulesPendingSummary'), 'non-hosts can still inspect queued changes');
  context.view.settings = context.view.pendingSettings;
  context.view.pendingSettings = null; context.view.round = 1;
  context.acknowledgeRulesConfig();
  context.view.canConfigureRules = true; context.renderRules();
  assert.equal(ids.get('rulesSaveBar').hidden, true, 'regaining permission does not unexpectedly reopen editing');
  context.openRules('edit');
  assert.match(ids.get('rulesConfigStatus').textContent, /now in effect/i, 'applied queued rules replace the stale next-round confirmation');
  assert(!ids.get('rulesConfigStatus').textContent.includes('current round is unchanged'));
  assert(!ids.get('rulesBody').children.some(node => node.id === 'rulesPendingSummary'), 'an applied queue is no longer shown as pending');
  context.view.canConfigureRules = true; context.view.phase = 'lobby'; context.view.pendingSettings = null; context.renderRules();
  assert.equal(ids.get('saveRulesConfig').textContent, 'Save rules for first deal');
  ids.get('ruleReshuffleOnce').checked = false; ids.get('ruleRedThreeAutoLayOff').checked = true;
  assert.equal(context.submitRulesConfig(), true);
  assert.deepEqual(requests.at(-1).rules, { redThreeAutoLayOff: true, reshuffleOnce: false });
  context.view.settings = E.validateSettings(requests.at(-1).rules, 4, E.DEFAULTS).settings;
  context.acknowledgeRulesConfig();
  assert(ids.get('rulesConfigStatus').textContent.includes('first deal'));
  context.act = originalAct; context.view = null; context.rulesConfigRequest = null;
  context.rulesConfigFeedback = ''; context.rulesConfigFeedbackCode = null;
}

context.chatMessages = [{ id: 1, seat: 1, name: '<img src=x>', text: '<script>alert(1)</script>', at: 1 }];
context.renderChat(true);
assert.equal(ids.get('chatMessages').querySelector('.chat-text').textContent, '<script>alert(1)</script>');
assert.equal(ids.get('chatMessages').querySelector('.chat-text').innerHTML, '', 'chat content uses a text sink');
const firstMessage = ids.get('chatMessages').children[0];
context.chatMessages.push({ id: 2, seat: 1, name: 'Friend', text: 'Hello', at: 2 });
context.renderChat(false);
assert.equal(ids.get('chatMessages').children[0], firstMessage, 'new messages do not replace earlier live-log entries');

setup(); context.view.you.hand = deck.slice(0, 12); context.view.you.picked = deck.slice(10, 12);
context.handLayout = 'layered'; context.renderHand();
assert(ids.get('handPill')['aria-label'].includes('2 newly drawn'), 'new-card announcements retain both pile counts');
const actions = new Element('div'); actions.offsetHeight = 70;
const defaultQuery = document.querySelector;
document.querySelector = selector => selector === '.actions' ? actions : defaultQuery(selector);
context.getComputedStyle = () => ({ position: 'relative' });
context.sizeBoard();
assert.equal(board.style.paddingBottom, '', 'static controls do not reserve a second footer-sized gap');
assert.equal(hand.style['--hand-rows'], '3', 'layered rows include the separate freshly drawn cards');
context.view.you.hand = deck.slice(0, 22); context.view.you.picked = deck.slice(3, 22);
context.renderHand();
const pickupRows = hand.querySelectorAll('.hand-row');
assert.equal(hand.querySelectorAll('.fresh').length, 19, 'all nineteen newly picked cards are shown');
assert(pickupRows.every(row => row.querySelectorAll('[data-card]').length <= 6), 'large pickups wrap so every layered row has at most six cards');
assert.equal(pickupRows.length, 5, 'three settled cards and nineteen fresh cards occupy one settled and four fresh rows');
assert.deepEqual(pickupRows.slice(0, 4).flatMap(row => row.querySelectorAll('[data-card]').map(card => card.dataset.card)),
  ['2H0', '3H0', '4H0', '5S0', '5H0', '6S0', '6H0', '7S0', '7H0', '8S0', '8H0', '9S0', '9H0', 'TS0', 'TH0', 'JS0', 'QS0', 'KS0', 'AS0'],
  'wrapping keeps every fresh card once in ascending rank order');
context.view.you.hand = deck.slice(0, 12); context.view.you.picked = deck.slice(10, 12);
context.handLayout = 'spread'; context.renderHand(); context.sizeBoard();
assert.equal(hand.style['--hand-cols'], '9', 'spread fits nine narrower cards across the available hand width');
assert.equal(hand.style['--hand-rows'], '3', 'spread counts a fresh row above the independently wrapped existing hand');
context.window.matchMedia = () => ({ matches: true });
context.view.you.hand = deck.slice(0, 30); context.renderHand(); context.sizeBoard();
assert.equal(hand.style['--hand-cols'], '10', 'short phones use ten compact card columns');
assert.equal(hand.style['--hand-rows'], '4', 'thirty cards include a separate fresh row on short phones');
assert.equal(hand.dataset.dense, 'true');
context.window.matchMedia = query => ({ matches: !query.includes('max-height') });
context.sizeBoard();
assert.equal(hand.style['--hand-cols'], '10', 'large mobile hands stay dense even on a taller phone');
context.view.you.hand = deck.slice(0, 11); context.renderHand(); context.sizeBoard();
assert.equal(hand.style['--hand-cols'], '9', 'a normal eleven-card hand uses nine regular columns on a tall phone');
assert.equal(hand.style['--hand-rows'], '3', 'one remaining fresh card still has its own row above the ten older cards');
assert.equal(hand.dataset.dense, 'false');
context.window.matchMedia = () => ({ matches: false });
context.view.you.hand = deck.slice(0, 30); context.renderHand(); context.sizeBoard();
assert.equal(hand.style['--hand-cols'], '9', 'leaving the short viewport restores regular card columns');
assert.equal(hand.style['--hand-rows'], '5', 'regular row count is recomputed after a height change');

// Both arrangements keep this turn's arrivals above, never mixed into an
// existing hand row, even while sorting, selecting and removing played cards.
{
  const before = { layout: context.handLayout, sort: context.sortMode, media: context.window.matchMedia };
  const picked = deck.slice(8, 10);
  const cardsOf = group => group ? group.querySelectorAll('[data-card]').map(card => card.dataset.card) : [];
  try {
    for (const layout of ['spread', 'layered']) {
      setup(); context.handLayout = layout; context.sortMode = 'rank'; context.sel = [];
      context.view.you.hand = deck.slice(0, 16); context.view.you.picked = picked.slice();
      context.handSignature = null; context.handStructureSignature = null;
      hand.innerHTML = ''; hand.scrollTop = 95;
      context.renderHand();
      const arrivals = hand.querySelector('.hand-arrivals'), existing = hand.querySelector('.hand-settled');
      assert.equal(hand.children[0], arrivals, layout + ': arrivals are the first hand group');
      assert.equal(hand.children[1], existing, layout + ': older cards begin in their own group below');
      assert.equal(arrivals.role, 'group'); assert.equal(arrivals['aria-label'], 'Newly picked up cards');
      assert.equal(hand.dataset.freshCount, '2');
      assert.deepEqual(cardsOf(arrivals), picked, layout + ': already ascending arrivals remain in place');
      assert.equal(hand.scrollTop, 0, layout + ': a real arrival scrolls to the new top row');
      assert.equal(cardsOf(existing).length, 14);
      assert.equal(new Set(cardsOf(hand)).size, 16, layout + ': every hand card is rendered exactly once');
      assert(cardsOf(existing).every(card => !picked.includes(card)), layout + ': old rows cannot duplicate fresh cards');
      hand.scrollTop = 30; context.sel = [picked[0]]; context.renderHand();
      assert.equal(hand.querySelector('.hand-arrivals'), arrivals, layout + ': selection preserves the fresh row nodes');
      assert.equal(hand.scrollTop, 30, layout + ': selection preserves the player’s scroll position');
      assert.equal(arrivals.querySelector('[data-card]')['aria-pressed'], 'true');
      context.sortMode = 'group'; context.renderHand();
      assert.deepEqual(cardsOf(hand.querySelector('.hand-arrivals')), picked, layout + ': sorting cannot merge or reorder fresh arrivals');
      assert.equal(hand.scrollTop, 30);
      context.view.you.hand = context.view.you.hand.filter(card => card !== picked[0]); context.renderHand();
      assert.deepEqual(cardsOf(hand.querySelector('.hand-arrivals')), [picked[1]], layout + ': playing an arrival leaves the other fresh card separate');
      context.view.you.picked = []; context.renderHand();
      assert.equal(hand.querySelector('.hand-arrivals'), null, layout + ': the marker lifecycle clears the special row');
      assert.equal(cardsOf(hand.querySelector('.hand-settled')).length, 15);
      assert.equal(hand.dataset.freshCount, '0');
    }
    const settled = ['4C0', '9S0', 'AC0', '9H0', '9D0'];
    const ascendingCases = [
      { picked: ['KS1', '4H1'], expected: ['4H1', 'KS1'] },
      { picked: ['XR1', 'AS1', 'KS1', 'QS1', 'JS1', 'TS1', '9S1', '8S1', '7S1', '6S1', '5S1', '4S1', '3S1', '2S1', '5H1', 'XB1'],
        expected: ['2S1', '3S1', '4S1', '5S1', '5H1', '6S1', '7S1', '8S1', '9S1', 'TS1', 'JS1', 'QS1', 'KS1', 'AS1', 'XR1', 'XB1'] },
    ];
    for (const layout of ['spread', 'layered']) for (const sample of ascendingCases) {
      setup(); context.handLayout = layout; context.sortMode = 'group'; context.sel = [];
      context.view.you.picked = sample.picked.slice(); context.view.you.hand = settled.concat(sample.picked);
      context.renderHand();
      assert.deepEqual(cardsOf(hand.querySelector('.hand-arrivals')), sample.expected,
        layout + ': arrivals ascend from 2 through ace then jokers, retaining equal-rank order');
      assert.deepEqual(cardsOf(hand.querySelector('.hand-settled')), ['9S0', '9H0', '9D0', '4C0', 'AC0'],
        layout + ': the existing hand retains the selected count sorting');
      assert.deepEqual([...context.view.you.picked], sample.picked, 'display sorting never changes server pickup order');
      assert.deepEqual([...context.view.you.hand], settled.concat(sample.picked), 'display sorting never mutates the authoritative hand');
      assert.equal(context.sortMode, 'group');
    }
    setup(); context.handLayout = 'spread'; context.view.you.hand = deck.slice(0, 18);
    context.view.you.picked = deck.slice(16, 18);
    context.window.matchMedia = query => ({ matches: !query.includes('max-height') });
    const previousHandWidth = hand.clientWidth; hand.clientWidth = 370;
    context.renderHand(); context.sizeBoard();
    assert.equal(hand.style['--hand-cols'], '9', 'a tall phone packs sixteen settled cards in nine columns even with two fresh cards above');
    assert.equal(hand.style['--hand-fresh-rows'], '1'); assert.equal(hand.style['--hand-settled-rows'], '2');
    assert.equal(hand.style['--hand-rows'], '3', 'the eighteen-card hand fits a fresh row and two settled rows');
    context.view.you.hand = deck.slice(0, 20); context.view.you.picked = deck.slice(18, 20);
    context.renderHand(); context.sizeBoard();
    assert.equal(hand.style['--hand-settled-rows'], '2', 'eighteen settled cards use two rows instead of three');
    assert.equal(hand.style['--hand-rows'], '3', 'twenty cards fit three rows including the separate arrivals');
    hand.clientWidth = previousHandWidth;
    setup(); context.handLayout = 'spread'; context.view.you.hand = deck.slice(0, 30);
    context.view.you.picked = deck.slice(28, 30); context.window.matchMedia = () => ({ matches: true });
    context.renderHand(); context.sizeBoard();
    assert.equal(hand.style['--hand-fresh-rows'], '1'); assert.equal(hand.style['--hand-settled-rows'], '3');
    assert.equal(hand.style['--hand-rows'], '4', 'extreme thirty-card hands budget the additional row rather than clipping it');
    const previousOverflowContext = context.boardOverflowContext;
    context.view.you.picked = []; context.renderHand(); context.sizeBoard();
    assert.equal(hand.style['--hand-rows'], '3');
    assert.notEqual(context.boardOverflowContext, previousOverflowContext, 'clearing fresh rows rechecks crowding even when card count is unchanged');
    context.view.you.hand = deck.slice(0, 2); context.view.you.picked = deck.slice(0, 2); context.renderHand(); context.sizeBoard();
    assert.equal(hand.querySelector('.hand-settled'), null, 'an all-new hand has no empty lower group');
    assert.equal(hand.style['--hand-rows'], '1');
    context.view.you.hand = []; context.renderHand(); context.sizeBoard();
    assert.equal(hand.children.length, 0); assert.equal(hand.style['--hand-rows'], '1', 'an empty hand retains the existing minimum layout budget');
  } finally {
    context.handLayout = before.layout; context.sortMode = before.sort; context.window.matchMedia = before.media;
    context.view.you.hand = deck.slice(0, 30); context.view.you.picked = deck.slice(10, 12);
    context.sel = []; context.renderHand(); context.sizeBoard();
  }
}

{
  const beforeRAF = context.window.requestAnimationFrame, beforeSize = context.sizeBoard;
  const previousWidth = hand.clientWidth;
  const frames = new Map(); let frameId = 0, measures = 0, writes = 0;
  const styles = [hand.style, ids.get('myMelds').style, document.documentElement.style];
  const setters = styles.map(style => style.setProperty);
  try {
    styles.forEach((style, index) => {
      style.setProperty = function (key, value) { writes++; return setters[index].call(this, key, value); };
    });
    context.window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
    context.sizeBoard = () => { measures++; beforeSize(); };
    const flush = () => {
      const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());
    };
    hand.clientWidth = 320;
    context.scheduleBoardSize(); context.scheduleBoardSize(); context.scheduleBoardSize();
    assert.equal(frames.size, 1, 'several layout requests share one animation frame');
    assert.equal(measures, 0, 'layout is not measured synchronously when animation frames are available');
    flush();
    assert.equal(measures, 1, 'the frame performs one layout measurement');
    assert.equal(hand.style['--hand-cols'], '8', 'the queued measurement fits eight narrower cards at the current width');
    assert(writes > 0, 'a changed width updates the affected CSS properties');
    const settledWrites = writes;
    context.scheduleBoardSize(); context.scheduleBoardSize(); flush();
    assert.equal(measures, 2, 'a later frame can measure again');
    assert.equal(writes, settledWrites, 'an unchanged layout performs no repeated CSS-property writes');
  } finally {
    context.window.requestAnimationFrame = beforeRAF; context.sizeBoard = beforeSize;
    styles.forEach((style, index) => { style.setProperty = setters[index]; });
    hand.clientWidth = previousWidth;
  }
}

// Picking cards, draw piles, or a destination never sends a game action itself.
const sentActions = [];
const savedSend = context.send, savedRender = context.render;
const savedSetTimeout = context.setTimeout, savedClearTimeout = context.clearTimeout;
const savedDate = vm.runInContext('Date', context);
const timers = new Map(); let timerId = 0, now = 1000;
context.Date = { now: () => now };
context.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
context.clearTimeout = id => timers.delete(id);
context.send = message => { sentActions.push(JSON.parse(JSON.stringify(message))); return true; };
context.render = () => {};
setup(); context.view.turnPhase = 'draw'; context.view.stocks = [10, 11, 12, 13];
context.view.turnId = 73;
context.pileSel = []; context.sel = []; context.actionPending = false;
context.renderActions(); assert(!context.drawPickerSelection(), 'Draw waits for a valid pile pair');
context.pileSel = [0, 0]; context.renderActions();
assert(!context.drawPickerSelection(), 'duplicate picks cannot offer a two-pile Draw');
context.pileSel = [0, 9]; context.renderActions();
assert(!context.drawPickerSelection(), 'an unavailable chosen pile cannot offer Draw');
context.view.stocks = [0, 0, 3, 0]; context.pileSel = []; context.renderActions();
assert(context.drawPickerSelection(), 'the final live stock permits the legal relaxed draw without a pair');
context.view.stocks = [0, 0, 0, 0]; context.renderActions();
assert(!context.drawPickerSelection(), 'empty stock does not offer Draw');
context.view.stocks = [10, 11, 12, 13]; context.pileSel = [];
context.selectDrawPile(0); context.selectDrawPile(1); context.selectDrawPile(2);
assert.deepEqual([...context.pileSel], [0, 1], 'a third draw-pile tap does not silently replace the selected pair');
assert.equal(sentActions.length, 0, 'draw-pile selection is not a draw action');
context.selectDrawPile(0);
assert.deepEqual([...context.pileSel], [1], 'tapping a chosen pile deselects it');
context.renderActions(); assert(!context.drawPickerSelection(), 'one chosen pile does not offer Draw');
context.selectDrawPile(3); context.renderActions();
context.autoDrawStateFresh = true; context.ws = { readyState: 1 }; context.expandedSeat = null;
context.wireDrawPicker(); context.openDrawPicker();
assert.equal(ids.get('drawPickerDraw').disabled, false);
ids.get('drawPickerDraw').onclick();
assert.deepEqual(sentActions[0], { t: 'action', action: 'draw', turnId: 73, piles: [1, 3] }, 'actions carry the authoritative turn token');
assert.equal(context.act('draw', { piles: [1, 3] }), false, 'a repeated tap cannot send a second pending action');
assert.equal(sentActions.length, 1);
element('centerRow'); context.renderCenter();
assert.equal(ids.get('drawPile0').disabled, true, 'pile controls are disabled during the pending action');
now = 1010; context.acknowledgeAction();
const unlock = timers.get(context.actionUnlockTimer);
assert.equal(unlock.delay, 340, 'a fast acknowledgement retains the remainder of the 350ms guard');
assert.equal(context.actionPending, true);
assert.equal(context.act('discard', { card: '4S0' }), false, 'fast acknowledgement cannot redirect the second tap to a different action');
assert.equal(sentActions.length, 1);
now = 1350; unlock.callback();
assert.equal(context.actionPending, false);
assert.equal(ids.get('drawPile0').disabled, false, 'draw piles re-enable after a draw-state acknowledgement or undo pickup');
assert.equal(ids.get('drawPile1')['aria-pressed'], 'true');
ids.get('drawPile1').focus(); context.view.stocks[1]--;
context.renderCenter();
assert.equal(document.activeElement, ids.get('drawPile1'), 'a stock-count update restores focus to the same pile control');
assert.equal(ids.get('drawPile1')['aria-pressed'], 'true', 'the focused pile keeps its selected state after the update');
context.view.turnPhase = 'play'; context.renderCenter();
assert.equal(ids.get('drawPile1')['aria-pressed'], 'false', 'chosen stock piles stop looking selected after the draw completes');
assert(!ids.get('drawPile1').className.split(' ').includes('selected'));
context.closeDrawPicker(false, true); context.autoDrawStateFresh = false;

setup([closed]); context.actionPending = false;
context.sel = ['4S0']; context.view.you.hasInitialMeld = true; context.view.turnState.melded = 50;
context.renderMine(); context.renderActions();
assert(!footerAction('addToBookAction'), 'adding to an existing book never creates a competing footer button');
assert.equal(ids.get('myMelds').querySelectorAll('.card').length, 1, 'the one-face completed stack remains a selectable Add target');
const beforeBookChoice = sentActions.length;
assert(discardAction().className.includes('discard-ready'), 'discard has a highlighted table target');
assert.equal(ids.get('tableUndo').hidden, false, 'undo lives in the hand toolbar');
assert.equal(ids.get('tableUndo')['aria-label'], 'Undo melds');
assert.equal(bar.querySelectorAll('button').length, 0, 'no competing action buttons remain below the hand');
ids.get('myMelds').querySelector('button').onclick({ detail: 0 });
assert.equal(sentActions.length, beforeBookChoice + 1, 'keyboard activation plays selected cards into the book directly');
assert.deepEqual(sentActions.at(-1), { t: 'action', action: 'meldAdd', meldId: closed.id, cards: ['4S0'] });
context.actionPending = false; context.toggleHandCard('4H0');
context.renderMine(); context.renderActions();
assert(!footerAction('addToBookAction'), 'changing selection removes the stale Add action');

// A pointer single-tap plays; its short deferral leaves double-tap disclosure safe.
function prepareMeldTaps(melds = [closed]) {
  context.cancelMeldTap(); setup(melds); context.actionPending = false; context.lastMeldTap = null;
  context.meldExpanded = {}; context.finishedBookStyle = 'stacked'; context.opponentMeldStyle = 'cards';
  context.sel = ['4S0']; context.view.you.hasInitialMeld = true;
  context.renderMine(); context.renderActions();
}
function clickMeld(id = closed.id, detail = 1) {
  ids.get('myMelds').querySelectorAll('button').find(button => button.dataset.meldId === id).onclick({ detail });
}
function fireMeldTap() {
  const entry = timers.get(context.meldTapTimer);
  assert(entry, 'one pending single tap exists');
  assert.equal(entry.delay, 320, 'touch disclosure gets a forgiving double-tap window');
  timers.delete(context.meldTapTimer); now += entry.delay; entry.callback();
}
prepareMeldTaps(); now = 2000;
const beforeQuickAdd = sentActions.length;
clickMeld();
assert.equal(sentActions.length, beforeQuickAdd, 'a single tap waits briefly so a double-tap never plays first');
fireMeldTap();
assert.equal(sentActions.length, beforeQuickAdd + 1, 'one pointer tap commits once after the disclosure window');
assert.deepEqual(sentActions.at(-1), { t: 'action', action: 'meldAdd', meldId: closed.id, cards: ['4S0'] });
clickMeld(); assert.equal(sentActions.length, beforeQuickAdd + 1, 'another tap is blocked while the add is pending');
const afterSingleAdd = sentActions.length;
for (const secondDetail of [1, 2]) {
  prepareMeldTaps(); now = 3000; clickMeld();
  const oldTimer = timers.get(context.meldTapTimer);
  now = 3290; clickMeld(closed.id, secondDetail);
  assert.equal(context.meldTapTimer, null, 'both mobile and desktop double-taps cancel the single add');
  oldTimer.callback();
  assert.equal(sentActions.length, afterSingleAdd, 'a cancelled delayed callback cannot add after disclosure');
  assert.equal(ids.get('myMelds').querySelector('button').dataset.presentation, 'fan', 'double-tap opens the selected destination');
  now = 3500; clickMeld(); now = 3650; clickMeld();
  assert.equal(ids.get('myMelds').querySelector('button').dataset.presentation, 'stack', 'the next double-tap condenses it');
}
for (const invalidate of [
  () => { context.sel = ['4H0']; },
  () => { context.view.you.hand = ['4H0', '2S0']; },
  () => { context.view.turn = 1; },
  () => { context.view.turnId = 99; },
  () => { context.view.seats[0].melds = [{ ...closed, cards: [...closed.cards, '4C5'] }]; },
  () => { context.sel = []; },
]) {
  prepareMeldTaps(); now = 5000; clickMeld(); invalidate(); fireMeldTap();
  assert.equal(sentActions.length, afterSingleAdd, 'a changed turn, target, hand, or selection invalidates the queued add');
}
prepareMeldTaps(); context.sel = []; context.renderMine(); clickMeld(); fireMeldTap();
assert.equal(ids.get('myMelds').querySelector('button').dataset.presentation, 'stack', 'no-selection single taps do not change the display');
prepareMeldTaps(); const keyboardBook = ids.get('myMelds').querySelector('button');
keyboardBook.onkeydown({ key: 'Enter', shiftKey: true, preventDefault() {} });
assert.equal(ids.get('myMelds').querySelector('button').dataset.presentation, 'fan', 'Shift+Enter changes presentation with selected cards');
assert.equal(sentActions.length, afterSingleAdd);
prepareMeldTaps(); context.view.you.inFoot = true; context.view.you.hand = ['4S0', '4H0'];
context.renderMine(); clickMeld(); fireMeldTap();
assert.equal(sentActions.length, afterSingleAdd, 'single-tap add cannot strand a one-card foot without required books');
assert(context.notice.includes('Keep two cards'));

// Discarding a card with a real legal meld requires an explicit second choice.
const beforeDiscardWarnings = sentActions.length;
prepareMeldTaps(); context.renderActions();
const discardTrigger = discardAction(); discardTrigger.focus(); discardTrigger.onclick();
assert.equal(ids.get('discardConfirmSheet').hidden, false);
assert.equal(ids.get('discardConfirmTitle').textContent, 'Discard 4? You can meld it');
assert.equal(document.activeElement, ids.get('keepDiscardCard'), 'Keep card is the safe initial focus');
assert.equal(sentActions.length, beforeDiscardWarnings, 'opening the warning never discards the card');
context.closeDiscardConfirmation(true);
assert.equal(document.activeElement, discardTrigger, 'keeping the card restores the previous control');
assert.equal(ids.get('discardConfirmSheet').hidden, true);
context.requestDiscard('4S0'); context.confirmDiscard(); context.confirmDiscard();
assert.equal(sentActions.length, beforeDiscardWarnings + 1, 'confirming twice sends exactly one discard');
assert.deepEqual(sentActions.at(-1), { t: 'action', action: 'discard', card: '4S0' });
assert.equal(ids.get('discardConfirmSheet').hidden, true);
for (const invalidate of [
  () => { context.view.turn = 1; },
  () => { context.view.turnId = 15; },
  () => { context.view.you.hand = ['4H0', '2S0']; },
  () => { context.sel = ['4H0']; },
  () => { context.view.settings = { ...E.DEFAULTS, closedBooksLocked: true }; },
]) {
  prepareMeldTaps(); context.requestDiscard('4S0'); invalidate(); context.confirmDiscard();
  assert.equal(sentActions.length, beforeDiscardWarnings + 1, 'a stale warning never sends a discard');
  assert.equal(ids.get('discardConfirmSheet').hidden, true);
}
prepareMeldTaps(); context.requestDiscard('4S0');
context.handleDiscardConfirmationKey({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(ids.get('discardConfirmSheet').hidden, true, 'Escape means keep the card');

function checkMeldWarning({ hand, melds = [], settings = E.DEFAULTS, inFoot = false, initial = true, card = hand[0], expected }) {
  setup(melds); context.actionPending = false; context.view.you.hand = hand;
  context.view.you.inFoot = inFoot; context.view.you.hasInitialMeld = initial;
  context.view.settings = settings; context.sel = [card];
  const previous = [...context.sel];
  const opportunity = context.meldOpportunityFor(card);
  assert.equal(!!opportunity, expected, 'warning follows active rules for ' + hand.join(', '));
  assert.deepEqual([...context.sel], previous, 'searching legal plays never changes selected cards');
  if (opportunity) {
    const game = G.createGame(['You', 'Other'], settings);
    assert(G.startRound(game, () => .5).ok);
    game.turn = 0; game.turnPhase = 'play'; game.turnState.drew = true;
    Object.assign(game.players[0], { hand: hand.slice(), foot: inFoot ? [] : ['5S9', '6S9', '7S9'],
      inFoot, hasInitialMeld: initial, melds: JSON.parse(JSON.stringify(melds)) });
    const outcome = opportunity.meldId
      ? G.meldAdd(game, 0, opportunity.meldId, [...opportunity.cards])
      : G.meldNew(game, 0, opportunity.rank, [...opportunity.cards]);
    assert(outcome.ok, 'every offered warning has a server-legal witness: ' + JSON.stringify(outcome));
  }
}
checkMeldWarning({ hand: ['6S0', '6H0', '6D0', 'QS0'], expected: true });
checkMeldWarning({ hand: ['6S0', '6H0', '2S0', 'QS0'], expected: true });
checkMeldWarning({ hand: ['2S0', '6S0', '6H0', 'QS0'], expected: true });
checkMeldWarning({ hand: ['6S0', '6H0', 'QS0'], expected: false });
checkMeldWarning({ hand: ['3S0', '3H0', '3D0', 'QS0'], expected: false });
checkMeldWarning({ hand: ['6S0', '6H0', '6D0', 'QS0'], inFoot: true, expected: false });
checkMeldWarning({ hand: ['6S0', '6H0', '6D0', 'QS0', 'KS0'], inFoot: true, expected: true });
checkMeldWarning({ hand: ['4S0', 'QS0'], melds: [closed], inFoot: true, expected: false });
checkMeldWarning({ hand: ['4S0', 'QS0', 'KS0'], melds: [closed], settings: E.rulesForPreset('real'), expected: false });
checkMeldWarning({ hand: ['4S0', '4H0', '4D0', 'QS0'], melds: [closed], settings: E.rulesForPreset('real'), expected: true });
checkMeldWarning({ hand: ['2S0', 'QS0', 'KS0'], melds: [closed], expected: false });
checkMeldWarning({ hand: ['2S0', '6S0', '6H0', 'QS0'], settings: E.rulesForPreset('real'), expected: false });
checkMeldWarning({ hand: ['2S0', '6S0', '6H0', '6D0', '6C0', 'QS0'], settings: E.rulesForPreset('real'), expected: true });
checkMeldWarning({ hand: ['4S0', 'QS0', 'KS0'], melds: [closed], expected: true });
setup(); context.actionPending = false; context.view.you.hand = ['QS0', '4S0', '5S0']; context.sel = ['QS0'];
context.requestDiscard('QS0');
assert.equal(sentActions.length, beforeDiscardWarnings + 2, 'an unmeldable card still discards immediately');
assert.equal(ids.get('discardConfirmSheet').hidden, true);

setup(); context.view.turnPhase = 'draw'; context.view.stocks = [10, 10, 10, 10];
context.pileSel = []; context.sel = []; context.actionPending = false;
element('peekBody'); element('peekTitle'); element('peekSheet').hidden = true;
const beforePreview = sentActions.length;
for (const [card, name] of [['QS0', /queen of spades/i], ['TH0', /(?:ten|10) of hearts/i],
  ['AD0', /ace of diamonds/i], ['4C0', /(?:four|4) of clubs/i], ['XR0', /red joker/i]]) {
  context.view.discardTop = card; context.view.discardCount = 1;
  context.renderCenter();
  assert.match(ids.get('discardPreview')['aria-label'], name, 'the discard control speaks a readable rank and suit');
  assert(!/[♠♥♦♣]/.test(ids.get('discardPreview')['aria-label']), 'discard announcements do not rely on suit glyph pronunciation');
}
for (const frozenTop of ['3D0', '3S0', '2S0', 'XR0']) {
  context.view.discardTop = frozenTop; context.view.discardCount = 7;
  context.view.discardPeek = ['4S1', frozenTop];
  context.renderCenter(); context.renderActions();
  const preview = ids.get('discardPreview');
  assert.equal(preview.querySelector('.discard-status').textContent, 'Frozen');
  assert(!footerAction('takePileAction'), 'frozen piles do not offer an invalid Take action');
  preview.onclick();
  assert.equal(ids.get('peekSheet').hidden, false, 'a permitted frozen-pile preview can still be inspected');
  assert(ids.get('peekBody').children[0].textContent.includes('frozen'));
  assert.equal(ids.get('confirmPileTake').disabled, true, 'frozen discard previews are read-only');
  ids.get('confirmPileTake').onclick();
  assert.equal(sentActions.length, beforePreview, 'opening a preview never commits a pickup');
}
context.view.discardPeek = null; context.renderCenter();
assert.equal(ids.get('discardPreview').tagName, 'button', 'a closed discard pile can be opened to inspect its public top');
assert.equal(context.actionPending, false);

setup(); context.view.turnPhase = 'draw'; context.view.stocks = [10, 10, 10, 10];
context.view.code = 'TEST'; context.view.round = 0;
context.view.you.hand = ['4S0', '4H0', '4D1', '9C0']; context.sel = ['9C0'];
context.view.discardTop = '4C1'; context.view.discardCount = 7;
context.view.discardPeek = ['5S1', '6S1', '7S1', '8S1', '9S1', 'TS1', '4C1'];
context.actionPending = false; ids.get('peekSheet').hidden = true;
context.renderCenter(); context.renderActions();
assert(ids.get('discardPreview').className.includes('takeable'), 'pickup availability comes from the hand rather than an unrelated selection');
const beforeTakeModal = sentActions.length;
ids.get('discardPreview').onclick();
assert.equal(ids.get('peekSheet').hidden, false);
assert.equal(sentActions.length, beforeTakeModal, 'the discard pile opens confirmation without committing a pickup');
assert.equal(ids.get('peekBody').querySelectorAll('.peek-card').length, 7, 'open-pile rules reveal exactly the pickup packet');
const matchingPair = [...context.pileChance().cards];
assert.equal(matchingPair.length, E.DEFAULTS.pileNaturalsRequired, 'three matching naturals still choose exactly the required pair');
assert.equal(new Set(matchingPair).size, 2);
assert(matchingPair.every(card => context.view.you.hand.includes(card) && E.rankOf(card) === '4' && !E.isWild(card)));
assert.deepEqual([...context.pileChance().cards], matchingPair, 'automatic natural selection is deterministic');
const confirmation = ids.get('confirmPileTake');
assert.equal(confirmation.disabled, false); confirmation.onclick();
assert.deepEqual(sentActions.at(-1), { t: 'action', action: 'pile', cards: matchingPair });
assert.equal(sentActions.length, beforeTakeModal + 1);
assert.deepEqual([...context.sel], ['9C0'], 'automatic pickup does not repurpose an unrelated manual selection');
assert.equal(confirmation.disabled, true);
confirmation.onclick();
assert.equal(sentActions.length, beforeTakeModal + 1, 'repeat confirmation cannot submit a second pending pickup');
context.view.turnPhase = 'play'; context.showPeek();
assert.equal(ids.get('peekSheet').hidden, true, 'accepted pickup closes the confirmation when the draw phase ends');

context.actionPending = false; context.view.turnPhase = 'draw';
context.view.settings = Object.assign({}, E.DEFAULTS, { revealPileTake: false });
// Even a stale earlier packet must not survive a rule change in the modal.
context.showPeek();
assert.equal(ids.get('peekBody').querySelectorAll('.peek-card').length, 1, 'closed-pile rules expose only the public top despite a stale packet');
assert(ids.get('peekBody').children[0].textContent.includes('6 more cards are hidden'));
const staleTopButton = ids.get('confirmPileTake');
const beforeStaleTake = sentActions.length;
context.view.discardTop = '4S1'; staleTopButton.onclick();
assert.equal(sentActions.length, beforeStaleTake, 'a changed discard top invalidates an already-open confirmation');
const stalePhaseButton = ids.get('confirmPileTake');
context.view.turnPhase = 'play'; stalePhaseButton.onclick();
assert.equal(sentActions.length, beforeStaleTake, 'a draw completed elsewhere invalidates an already-open confirmation');
assert.equal(ids.get('confirmPileTake').disabled, true);
context.view.turnPhase = 'draw'; context.view.turn = 1; context.showPeek();
assert.equal(ids.get('confirmPileTake').disabled, true, 'opponent-turn inspection cannot take cards');
ids.get('peekSheet').hidden = true;
context.send = savedSend; context.render = savedRender; context.Date = savedDate;
context.setTimeout = savedSetTimeout; context.clearTimeout = savedClearTimeout;
// The browser owns fan wrapping. These DOM tests provide measured dimensions
// explicitly and verify that height pressure never substitutes miniature cards.
// Real card sizes and responsive packing are verified in browser QA.
{
  const shelf = ids.get('myMelds');
  const before = { view: context.view, sel: context.sel, width: shelf.clientWidth,
    height: shelf.clientHeight, scrollHeight: shelf.scrollHeight, dataset: { ...shelf.dataset },
    pending: context.actionPending, finished: context.finishedBookStyle,
    presentation: context.opponentMeldStyle, overrides: context.meldExpanded };
  try {
    const books = ['4', '5', '6', '7'].map(rank => ({ id: 'stack-fit-' + rank, rank,
      cards: [rank + 'S0', rank + 'H0', rank + 'D0', rank + 'C0', rank + 'S1', rank + 'H1', rank + 'D1'] }));
    setup(books); context.sel = []; context.actionPending = false; context.meldExpanded = {};
    context.opponentMeldStyle = 'cards'; context.finishedBookStyle = 'stacked';
    shelf.clientWidth = 360; shelf.clientHeight = 60; shelf.scrollHeight = 60;
    context.renderMine(); context.fitMine();
    assert.equal(shelf.querySelectorAll('.closed-book-face').length, 4, 'all four completed books have a real visible card face');
    assert.equal(shelf.dataset.bookSize, 'regular');
    assert.equal(shelf.dataset.bookOverflow, 'false', 'a shelf whose content fits does not report overflow');
    assert.equal(shelf.dataset.bookLayout, 'flow', 'book wrapping is independent of a height-derived column count');
    for (let index = 0; index < books.length; index++) {
      shelf.querySelectorAll('button').find(button => button.dataset.meldId === books[index].id).onclick({ detail: 0 });
      // Simulate the browser reporting extra wrapped rows, not a computed grid.
      shelf.scrollHeight = index < 2 ? 60 : 110;
      context.fitMine();
      assert.equal(shelf.dataset.bookSize, 'regular', 'opening book ' + (index + 1) + ' keeps readable card faces');
      assert.equal(shelf.dataset.compact, 'false');
      assert.equal(shelf.querySelectorAll('.card').length, 4 + 6 * (index + 1),
        'each expanded book adds all six previously hidden cards');
      assert.equal(shelf.querySelectorAll('button').filter(button => button.dataset.presentation === 'fan').length, index + 1,
        'opening a book leaves the other book disclosures unchanged');
      assert.equal(shelf.dataset.bookOverflow, index < 2 ? 'false' : 'true',
        'overflow follows the measured content height instead of shrinking the cards');
    }
    context.meldExpanded = {}; context.finishedBookStyle = 'spread';
    context.renderMine(); shelf.scrollHeight = 110; context.fitMine();
    assert.equal(shelf.querySelectorAll('.card').length, 28, 'Spread exposes the full contents of four completed books');
    assert.equal(shelf.dataset.bookSize, 'regular');
    assert.equal(shelf.dataset.bookOverflow, 'true');
    context.finishedBookStyle = 'stacked'; context.renderMine(); shelf.scrollHeight = 60; context.fitMine();
    assert.equal(shelf.querySelectorAll('.card').length, 4, 'Stacked restores one real face per completed book');
    assert.equal(shelf.dataset.bookOverflow, 'false', 'collapsing books remeasures the recovered space');
    books.forEach(book => { book.cards = book.cards.slice(0, 3); });
    context.renderMine(); shelf.scrollHeight = 110; context.fitMine();
    assert.equal(shelf.querySelectorAll('.card').length, 12, 'unfinished books still expose every card');
    shelf.clientWidth = 359; shelf.clientHeight = 10; context.fitMine();
    assert.equal(shelf.dataset.bookSize, 'regular', 'extreme height pressure never reduces own-card size');
    assert.equal(shelf.dataset.compact, 'false', 'own cards never enter the unreadable compact presentation');
    assert.equal(shelf.dataset.bookOverflow, 'true', 'the shelf reports overflow instead of replacing cards with dots');
  } finally {
    context.view = before.view; context.sel = before.sel; context.actionPending = before.pending;
    context.finishedBookStyle = before.finished; context.opponentMeldStyle = before.presentation;
    context.meldExpanded = before.overrides;
    shelf.clientWidth = before.width; shelf.clientHeight = before.height;
    shelf.scrollHeight = before.scrollHeight; shelf.dataset = before.dataset;
  }
}

// A selected card changes legal actions and footer copy, but must preserve the
// displayed cards and per-book expansion instead of changing presentation tiers.
{
  const shelf = ids.get('myMelds');
  const before = {
    view: context.view, sel: context.sel, handLayout: context.handLayout,
    pending: context.actionPending, opponentMeldStyle: context.opponentMeldStyle,
    overrides: context.meldExpanded, width: shelf.clientWidth, height: shelf.clientHeight,
    scrollHeight: shelf.scrollHeight, dataset: { ...shelf.dataset },
    viewportWidth: context.window.innerWidth, viewportHeight: context.window.innerHeight,
  };
  const books = ['T', '4', '5', '6', '7', '8'].map(rank => ({
    id: 'stable-' + rank, rank, cards: [rank + 'S1', rank + 'H1', rank + 'D1'],
  }));
  try {
    setup(books); context.view.code = 'FITX'; context.view.round = 0;
    context.view.you.hand = ['TS0', '9H0', 'KC0'];
    context.view.you.hasInitialMeld = true;
    context.sel = []; context.handLayout = 'spread'; context.opponentMeldStyle = 'cards';
    context.meldExpanded = {}; context.actionPending = false;
    context.window.innerWidth = 410; context.window.innerHeight = 852;
    shelf.clientWidth = 390; shelf.clientHeight = 150; shelf.scrollHeight = 140;
    const paintBooks = () => { context.renderMine(); context.renderActions(); context.fitMine(); };
    const presentation = () => shelf.querySelectorAll('button').map(button => ({
      id: button.dataset.meldId, presentation: button.dataset.presentation,
      cards: button.querySelectorAll('.card').map(card => [card['aria-label'],
        card.querySelector('.r').textContent, card.querySelector('.s').textContent]),
    }));
    paintBooks();
    assert.equal(shelf.dataset.bookSize, 'regular');
    assert.equal(shelf.querySelectorAll('button').length, 6, 'each unselected book is an accessible disclosure control');
    assert.equal(shelf.querySelectorAll('.target').length, 0, 'without selected cards no book is an add destination');
    const settledPresentation = presentation();
    assert.equal(shelf.querySelectorAll('.card').length, 18);

    context.sel = ['TS0']; shelf.clientHeight = 126;
    paintBooks();
    assert.deepEqual(shelf.querySelectorAll('.target').map(button => button.dataset.meldId), ['stable-T'],
      'selecting a ten offers exactly the matching book as an add destination');
    assert.deepEqual(presentation(), settledPresentation, 'selection and footer height loss preserve all displayed card faces');
    assert.equal(shelf.dataset.bookSize, 'regular');
    assert.equal(shelf.dataset.bookOverflow, 'true', 'footer height loss uses measured overflow instead of reducing card size');
    assert(discardAction(), 'the selected ten still has its legal discard action');
    context.sel = []; paintBooks();
    assert.deepEqual(presentation(), settledPresentation, 'deselecting preserves the shelf presentation');

    context.window.innerHeight = 760; paintBooks();
    assert.equal(shelf.dataset.bookSize, 'regular', 'a viewport height change does not resize book cards');
    shelf.clientHeight = 150; paintBooks();
    assert.equal(shelf.dataset.bookOverflow, 'false', 'fresh measurements recognize recovered shelf space');
    context.view.you.hand.push('QH0'); paintBooks();
    assert.deepEqual(presentation(), settledPresentation, 'a hand-count change leaves book faces unchanged');

    shelf.clientHeight = 126; books[0].cards.push('TC1'); paintBooks();
    assert.equal(shelf.dataset.bookSize, 'regular', 'adding a real card never shrinks the surrounding books');
    assert.equal(shelf.querySelectorAll('.card').length, 19, 'a meld update adds the new real card face');
    shelf.clientWidth = 300; paintBooks();
    assert.equal(shelf.dataset.bookSize, 'regular', 'a narrower shelf lets CSS wrap the same-size cards');
    assert.equal(shelf.dataset.compact, 'false');
    context.view.you.redThrees = ['3H0']; paintBooks();
    assert.equal(shelf.querySelectorAll('.card').length, 20, 'a laid-off red three appears as a real card');
    context.view.you.redThrees.push('3D0'); paintBooks();
    assert.equal(shelf.querySelectorAll('.card').length, 21, 'additional laid-off threes update the shelf');
    context.opponentMeldStyle = 'tiles'; paintBooks();
    assert.equal(shelf.querySelectorAll('button').filter(button => button.dataset.presentation === 'stack').length, 6,
      'the explicit shared Tiles preference condenses every own meld using stack geometry');
    assert.equal(shelf.dataset.bookSize, 'regular', 'an explicit display preference still does not activate card shrinking');
  } finally {
    context.view = before.view; context.sel = before.sel; context.handLayout = before.handLayout;
    context.actionPending = before.pending;
    context.opponentMeldStyle = before.opponentMeldStyle; context.meldExpanded = before.overrides;
    context.window.innerWidth = before.viewportWidth; context.window.innerHeight = before.viewportHeight;
    shelf.clientWidth = before.width; shelf.clientHeight = before.height;
    shelf.scrollHeight = before.scrollHeight; shelf.dataset = before.dataset;
  }
}

// Destination outlines mean this exact owned selection can legally be played,
// including natural additions to completed books when the rules allow them.
{
  const before = { view: context.view, sel: context.sel, pending: context.actionPending };
  const open = { ...closed, id: 'outline-open', cards: closed.cards.slice(0, 3) };
  const black = { ...closed, id: 'outline-black', cards: closed.cards.slice(0, 6).concat('2C1') };
  function highlighted(meld, own = true) {
    return context.meldDisplayElement(meld, 0, own).className.split(' ').includes('target');
  }
  try {
    setup([closed, open, black]); context.actionPending = false; context.sel = ['4S0'];
    assert(highlighted(closed), 'a natural card highlights an extendable completed red book');
    assert(highlighted(black), 'a natural card highlights an extendable completed black book');
    assert(highlighted(open), 'a natural card highlights a matching unfinished meld');
    assert(!highlighted(open, false), 'opponent books are never play destinations');
    context.renderMine(); context.renderActions();
    assert.match(ids.get('meldHint').textContent, /Tap a highlighted book to add/);
    assert.match(ids.get('actionHint').innerHTML, /Tap a highlighted book to add/);
    context.view.settings = { ...E.DEFAULTS, closedBooksLocked: true };
    assert(!highlighted(closed), 'locked completed books cannot be highlighted');
    assert(highlighted(open), 'locking completed books leaves unfinished destinations available');
    context.view.settings = E.DEFAULTS; context.sel = ['2S0'];
    assert(!highlighted(closed), 'a wild card cannot highlight a completed red book');
    context.view.you.hand.push('QS0'); context.sel = ['QS0'];
    assert(!highlighted(open), 'a different natural rank cannot highlight the meld');
    context.sel = ['4C9']; assert(!highlighted(open), 'an unowned card cannot highlight a destination');
    context.sel = ['4S0', '4S0']; assert(!highlighted(open), 'duplicate selected IDs cannot highlight a destination');
    context.sel = ['4S0']; context.actionPending = true;
    assert(!highlighted(open), 'pending actions suppress legal destination highlights');
    context.actionPending = false; context.view.you.inFoot = true; context.view.you.hasInitialMeld = true;
    context.view.you.hand = ['4S0', 'QS0']; context.view.seats[0].melds = [open];
    assert(!highlighted(open), 'a play leaving an illegal one-card foot is not highlighted');
    context.view.you.inFoot = false; context.view.turnPhase = 'draw';
    assert(!highlighted(open), 'draw phase does not advertise meld destinations');
  } finally {
    context.view = before.view; context.sel = before.sel; context.actionPending = before.pending;
  }
}

// Autodraw chooses by remaining card counts, with deterministic pile-index
// ties, and never silently substitutes a depleted explicitly chosen pile.
const autoChoice = (stocks, mode, chosen = [0, 1]) => context.chooseAutoDrawPiles(stocks, mode, chosen);
assert.equal(autoChoice([10, 20, 30, 40], 'off').ok, false, 'autodraw is opt-in');
assert.deepEqual([...autoChoice([10, 20, 30, 40], 'highest').piles], [3, 2]);
assert.deepEqual([...autoChoice([10, 20, 30, 40], 'lowest').piles], [0, 1]);
assert.deepEqual([...autoChoice([10, 10, 10, 10], 'highest').piles], [0, 1], 'equal high piles resolve by index');
assert.deepEqual([...autoChoice([0, 10, 10, 10], 'lowest').piles], [1, 2], 'low picks skip empty piles and break ties by index');
assert.deepEqual([...autoChoice([10, 20, 30, 40], 'chosen', [0, 3]).piles], [0, 3]);
assert.equal(autoChoice([0, 20, 30, 40], 'chosen', [0, 3]).ok, false, 'an empty fixed pile waits for a manual choice');
assert.equal(autoChoice([10, 20, 30, 40], 'chosen', [2, 2]).ok, false, 'fixed piles must differ while alternatives remain');
assert.equal(autoChoice([10, 20, 30, 40], 'chosen', [0, 4]).ok, false, 'invalid fixed pile indexes are refused');
for (const mode of ['highest', 'lowest', 'chosen', 'random']) {
  assert.deepEqual([...autoChoice([0, 0, 3, 0], mode).piles], [2, 2], 'one remaining pile follows the existing two-card draw rule');
  assert.equal(autoChoice([0, 0, 0, 0], mode).ok, false, 'empty stock never schedules an automatic draw');
}
const immutablePiles = Object.freeze([9, 6, 11, 0]);
assert.deepEqual([...autoChoice(immutablePiles, 'highest').piles], [2, 0], 'choosing piles does not reorder the server stock counts');

const autoMessages = [];
const autoTimers = new Map(); let autoTimerId = 0;
const beforeAutoSend = context.send, beforeAutoRender = context.render, beforeAutoQuery = document.querySelector;
const beforeAutoPicker = context.syncDrawPicker;
// Auto-plan tests isolate transport/timers; dialog integration is exercised below.
context.syncDrawPicker = () => {};
let blockingOverlay = null;
document.querySelector = selector => selector.startsWith('.sheet:not') ? blockingOverlay : beforeAutoQuery(selector);
context.setTimeout = (callback, delay) => { const id = ++autoTimerId; autoTimers.set(id, { callback, delay }); return id; };
context.clearTimeout = id => autoTimers.delete(id);
context.send = message => { autoMessages.push(JSON.parse(JSON.stringify(message))); return true; };
context.render = () => {};
function setupAuto(mode = 'highest') {
  setup();
  context.view.code = 'AUTO'; context.view.round = 0; context.view.turnPhase = 'draw';
  context.view.stocks = [20, 50, 40, 10]; context.view.log = [{ t: 'discard', id: 1 }];
  context.view.discardTop = 'QS1'; context.view.discardCount = 7;
  context.view.you.footCount = 11; context.sel = [];
  context.ws = { readyState: 1 }; context.actionPending = false;
  context.autoDrawMode = mode; context.autoDrawPiles = [0, 1];
  context.autoDrawObservedBase = null; context.autoDrawObservedDiscard = null;
  context.autoDrawTurnContext = null; context.autoDrawAttemptedContext = null;
  context.autoDrawTurnSerial = 0; context.autoDrawStateFresh = true; context.autoDrawStatus = '';
  context.cancelAutoDraw(); context.clearAutomaticDrawOrigin(); autoTimers.clear(); autoMessages.length = 0;
  blockingOverlay = null; document.hidden = false;
}
function fireAutomaticDraw() {
  const id = context.autoDrawTimer; const job = autoTimers.get(id);
  assert(job, 'an automatic draw was scheduled');
  assert.equal(job.delay, 250, 'automatic action has a short cancellable delay');
  autoTimers.delete(id); job.callback();
}

setupAuto('off'); context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, null); assert.equal(autoMessages.length, 0);
setupAuto(); context.maybeAutoDraw();
const firstAutoTimer = context.autoDrawTimer; context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, firstAutoTimer, 'repeated snapshots do not enqueue duplicate automatic draws');
assert.equal(autoMessages.length, 0, 'scheduling is not an immediate draw');
fireAutomaticDraw();
assert.deepEqual(autoMessages, [{ t: 'action', action: 'draw', piles: [1, 2] }]);
assert.deepEqual([...context.automaticDrawOrigin.piles], [1, 2], 'only the automatic sender records the reveal origin');
context.actionPending = false; context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, null, 'a stale draw-phase snapshot cannot repeat a completed attempt');
context.view.log.push({ t: 'rule', id: 2 }); context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, null, 'a rule message does not turn the same draw into a new turn');
context.autoDrawStateFresh = false; context.ws.readyState = 3; context.maybeAutoDraw();
context.ws.readyState = 1; context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, null, 'reconnection waits for a fresh resumed state');
context.autoDrawStateFresh = true; context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, null, 'a reconnect does not replay an attempt from the same turn');
context.view.turn = 1; context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, null, 'another player’s turn never draws automatically');
context.view.turn = 0; context.view.log.push({ t: 'discard', id: 3 }); context.maybeAutoDraw();
fireAutomaticDraw(); assert.equal(autoMessages.length, 2, 'the next actual turn can draw automatically again');

setupAuto(); context.sel = ['2S0']; context.view.discardTop = '4D1';
context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, null, 'a matching natural pair pauses autodraw despite an unrelated selection');
assert.equal(autoMessages.length, 0);
assert(context.autoDrawStatus.toLowerCase().includes('discard pile'));
context.renderCenter();
assert(ids.get('discardPreview').className.split(' ').includes('takeable'), 'a legal pickup is visibly available');
assert(ids.get('discardPreview').className.split(' ').includes('auto-pickup-paused'), 'Auto pauses with a distinct pile cue');
assert.equal(ids.get('discardPreview').querySelector('.pickup-label').textContent, 'View pile');
assert.equal(ids.get('discardPreview').querySelector('.discard-status').textContent, 'Auto paused');
assert(ids.get('discardPreview')['aria-label'].includes('Auto draw paused'), 'the pickup pause is also announced to assistive technology');
context.autoDrawMode = 'off'; context.syncDiscardPickupCue();
assert(!ids.get('discardPreview').className.split(' ').includes('auto-pickup-paused'), 'manual drawing has no false Auto pause');
assert.equal(ids.get('discardPreview').querySelector('.discard-status').textContent, 'Available');
context.autoDrawMode = 'highest'; context.view.turnPhase = 'play'; context.renderCenter();
assert(!ids.get('discardPreview').className.split(' ').includes('takeable'), 'drawing clears the pickup cue');
context.view.turnPhase = 'draw'; context.view.discardTop = '3S0'; context.renderCenter();
assert(!ids.get('discardPreview').className.split(' ').includes('auto-pickup-paused'), 'a frozen pile never advertises an Auto pause');
assert.equal(ids.get('discardPreview').querySelector('.pickup-label').textContent, 'Frozen');
context.view.discardTop = '4D1';
context.sel = []; context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, null, 'a legal unselected pickup is preserved');
assert(context.pileChance(), 'a below-minimum pickup remains an opportunity because the opening is totalled across the turn');

for (const frozenTop of ['3D0', '3S0', '2S0', 'XR0']) {
  setupAuto(); context.view.discardTop = frozenTop; context.maybeAutoDraw(); fireAutomaticDraw();
  assert.equal(autoMessages.length, 1, 'a frozen top is not a pickup opportunity');
}
setupAuto(); context.view.discardTop = '4D1'; context.view.discardCount = 1;
context.view.you.inFoot = true; context.view.you.hand = ['4S0', '4H0', '9S0'];
assert.equal(context.pileChance(), null, 'a short pickup that strands one foot card is illegal');
context.maybeAutoDraw(); fireAutomaticDraw();
assert.equal(autoMessages.length, 1, 'an illegal short-pile pickup does not block stock autodraw');
setupAuto(); context.view.discardTop = '4D1'; context.view.discardCount = 2;
context.view.you.inFoot = true; context.view.you.hand = ['4S0', '4H0', '9S0'];
assert(context.pileChance(), 'one extra pile card restores a legal two-card foot remainder');
context.maybeAutoDraw(); assert.equal(context.autoDrawTimer, null);

setupAuto('chosen'); context.autoDrawPiles = [0, 3]; context.view.stocks = [0, 20, 30, 40];
context.maybeAutoDraw(); assert.equal(context.autoDrawTimer, null);
assert.equal(autoMessages.length, 0, 'an unavailable fixed pair never falls back to different piles');
assert(context.autoDrawStatus.includes('empty'));
setupAuto(); context.view.stocks = [0, 0, 3, 0]; context.maybeAutoDraw(); fireAutomaticDraw();
assert.deepEqual(autoMessages[0], { t: 'action', action: 'draw', piles: [2, 2] });

setupAuto(); context.maybeAutoDraw(); blockingOverlay = new Element('section');
fireAutomaticDraw(); assert.equal(autoMessages.length, 0, 'opening a sheet during the delay cancels the pending automatic action');
blockingOverlay = null; context.maybeAutoDraw(); context.view.turnPhase = 'play';
fireAutomaticDraw(); assert.equal(autoMessages.length, 0, 'manual drawing before the delay expires prevents a second draw');
setupAuto(); context.maybeAutoDraw(); context.ws.readyState = 3;
fireAutomaticDraw(); assert.equal(autoMessages.length, 0, 'disconnecting during the delay prevents a stale send');
setupAuto(); context.maybeAutoDraw(); context.actionPending = true;
fireAutomaticDraw(); assert.equal(autoMessages.length, 0, 'a pending manual action blocks automatic sending');
setupAuto(); context.autoDrawStateFresh = false; context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, null, 'old cached table state cannot trigger autodraw after reconnect');
setupAuto(); document.hidden = true; context.maybeAutoDraw();
assert.equal(context.autoDrawTimer, null, 'a backgrounded page waits until the table is visible');

setupAuto(); let failedAutoSends = 0;
context.send = () => { failedAutoSends++; return false; };
context.maybeAutoDraw(); fireAutomaticDraw();
assert.equal(failedAutoSends, 1); assert.equal(context.actionPending, false);
assert.equal(context.automaticDrawOrigin, null, 'a failed send leaves no later reveal receipt');
context.maybeAutoDraw(); assert.equal(context.autoDrawTimer, null, 'failed automatic sends do not create a retry loop');
context.send = message => { autoMessages.push(JSON.parse(JSON.stringify(message))); return true; };
setupAuto(); context.maybeAutoDraw(); context.rememberAutomaticDrawOrigin([1, 2]); context.stopAutoDrawForTurn();
assert.equal(context.automaticDrawOrigin, null, 'a server error clears the automatic origin before any later manual draw');
assert.equal(context.autoDrawTimer, null, 'a server error cancels a queued automatic draw');
context.maybeAutoDraw(); assert.equal(context.autoDrawTimer, null, 'a refused action requires a manual decision for the rest of the turn');

setupAuto('off'); storedPreferences.delete('hf_auto_draw'); context.loadAutoDrawPreferences();
assert.equal(context.autoDrawMode, 'off', 'a fresh browser starts with autodraw off');
assert(context.saveAutoDrawPreference('chosen', [1, 3]));
assert.deepEqual(JSON.parse(storedPreferences.get('hf_auto_draw')), { mode: 'chosen', piles: [1, 3] });
context.autoDrawMode = 'off'; context.autoDrawPiles = [0, 2]; context.loadAutoDrawPreferences();
assert.equal(context.autoDrawMode, 'chosen'); assert.deepEqual([...context.autoDrawPiles], [1, 3]);
assert.equal(context.saveAutoDrawPreference('chosen', [1, 1]), false, 'an invalid pair is never persisted');
for (const damaged of ['bad json', '{"mode":"cheat","piles":[0,1]}', '{"mode":"chosen","piles":[1,1]}']) {
  storedPreferences.set('hf_auto_draw', damaged); context.loadAutoDrawPreferences();
  assert.equal(context.autoDrawMode, 'off', 'invalid saved choices fail safely to manual draw');
}

// A completed round announces its score once. Every later table snapshot may
// update that score, but it must not reopen a sheet the player dismissed.
const scoresSheet = element('scoreSheet'); scoresSheet.hidden = true;
const renderScoresBeforeLifecycle = context.renderScores;
let scoresRenders = 0;
context.renderScores = () => { scoresRenders++; };
context.scoreAutoShownKey = null;
context.view = { code: 'SCOR', round: 0, phase: 'roundEnd', scores: [[100, 200]], log: [] };
const firstCompletedKey = context.scoreRoundKey(context.view);
context.syncScoreSheet();
assert.equal(scoresSheet.hidden, false); assert.equal(scoresRenders, 1);
context.dismissScores();
assert.equal(scoresSheet.hidden, true);
for (let snapshot = 0; snapshot < 3; snapshot++) {
  context.view = JSON.parse(JSON.stringify(context.view));
  context.view.log.push({ t: 'connected', id: snapshot });
  context.syncScoreSheet();
  assert.equal(scoresSheet.hidden, true, 'repeat and reconnect snapshots leave a dismissed scoreboard closed');
}
assert.equal(scoresRenders, 1, 'dismissed scores are not repeatedly rendered');
context.view.phase = 'gameEnd';
assert.equal(context.scoreRoundKey(context.view), firstCompletedKey, 'final phase promotion is the same completed score');
context.syncScoreSheet(); assert.equal(scoresSheet.hidden, true);
scoresSheet.hidden = false; context.syncScoreSheet();
assert.equal(scoresSheet.hidden, false); assert.equal(scoresRenders, 2, 'manual opening still updates the score sheet');
context.dismissScores();
context.view.phase = 'playing'; context.view.round = 1; context.syncScoreSheet();
assert.equal(scoresSheet.hidden, true); assert.equal(context.scoreAutoShownKey, null);
context.view.phase = 'roundEnd'; context.view.scores.push([300, 400]); context.syncScoreSheet();
assert.equal(scoresSheet.hidden, false); assert.equal(scoresRenders, 3, 'the next completed round opens once');
context.dismissScores(); context.syncScoreSheet(); assert.equal(scoresSheet.hidden, true);
context.view.phase = 'playing'; context.view.round = 0; context.view.scores = []; context.syncScoreSheet();
context.view.phase = 'roundEnd'; context.view.scores = [[100, 200]]; context.syncScoreSheet();
assert.equal(scoresSheet.hidden, false); assert.equal(scoresRenders, 4, 'a rematch rearms even when code, round, and scores repeat');
context.dismissScores();

setupAuto(); scoresSheet.hidden = false;
document.querySelector = selector => selector.startsWith('.sheet:not')
  ? blockingOverlay || (!scoresSheet.hidden ? scoresSheet : null) : beforeAutoQuery(selector);
context.maybeAutoDraw(); assert.equal(context.autoDrawTimer, null, 'an open scoreboard pauses an eligible new-round draw');
context.dismissScores(); fireAutomaticDraw();
assert.equal(autoMessages.length, 1, 'closing Scores resumes the eligible automatic draw without waiting for another server message');
context.renderScores = renderScoresBeforeLifecycle;

{
  const beforeDate = vm.runInContext('Date', context);
  let watchdogNow = 46000, closes = 0;
  try {
    setupAuto(); context.Date = { now: () => watchdogNow };
    context.connectionLastSeen = 1000;
    context.ws = { readyState: 1, close() { closes++; this.readyState = 3; } };
    context.maybeAutoDraw();
    assert.notEqual(context.autoDrawTimer, null, 'the watchdog fixture starts with a queued automatic draw');
    context.checkConnection();
    assert.equal(closes, 0, 'the connection is allowed to answer through the forty-five-second threshold');
    assert.deepEqual(autoMessages, [{ t: 'ping' }], 'a responsive-interval check sends only its keepalive');
    watchdogNow++;
    context.actionPending = true;
    context.checkConnection();
    assert.equal(closes, 1, 'a silent connection older than forty-five seconds is closed');
    assert.equal(context.autoDrawTimer, null, 'closing a silent connection cancels the queued automatic draw');
    assert.equal(context.autoDrawStateFresh, false, 'automatic drawing waits for a resumed authoritative state');
    context.checkConnection();
    assert.equal(closes, 1, 'a closed transport is not repeatedly closed');
    context.ws.readyState = 1; context.actionPending = false;
    context.maybeAutoDraw();
    assert.equal(context.autoDrawTimer, null, 'reopening the transport alone cannot restart the stale automatic draw');
    assert.deepEqual(autoMessages, [{ t: 'ping' }], 'the watchdog never replays the pending game action');
  } finally { context.Date = beforeDate; }
}
context.cancelAutoDraw(); context.send = beforeAutoSend; context.render = beforeAutoRender; context.syncDrawPicker = beforeAutoPicker;
context.setTimeout = savedSetTimeout; context.clearTimeout = savedClearTimeout;
document.querySelector = beforeAutoQuery; document.hidden = false;

// Exercise the actual Leave control after mounting the remaining static IDs.
// Only the transport is replaced, so departure ordering and local teardown
// are observable without opening a real WebSocket in this unit test.
for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
  if (ids.has(match[3])) continue;
  const node = element(match[3], match[1]);
  node.className = (match[2].match(/class="([^"]*)"/) || [])[1] || '';
  node.hidden = /\bhidden\b/.test(match[2]);
}
document.querySelectorAll = selector => selector === '.sheet'
  ? [...ids.values()].filter(node => node.className.split(' ').includes('sheet')) : [];
context.wire(); setup();
context.autoDrawMode = 'off'; context.autoDrawStateFresh = false;
for (const popup of [
  { name: 'Sort', open: context.toggleSortPopover, down: context.handleSortOutsidePointer, click: context.handleSortOutsideClick },
  { name: 'Auto', open: context.toggleAutoDrawPopover, down: context.handleAutoDrawOutsidePointer, click: context.handleAutoDrawOutsideClick },
]) {
  const pointerEvent = pointerId => Object.assign(dismissalEvent(hand), pointerId == null ? {} : { pointerId });
  const cancel = pointerId => {
    const event = pointerEvent(pointerId);
    (documentListeners.get('pointercancel') || []).forEach(callback => callback(event));
  };
  popup.open(); const firstFinger = pointerEvent(101); popup.down(firstFinger);
  assert(firstFinger.prevented && firstFinger.stopped, popup.name + ': the outside pointer dismisses the popup');
  popup.down(pointerEvent(202));
  const otherClick = pointerEvent(202); popup.click(otherClick);
  assert(!otherClick.prevented, popup.name + ': an unrelated finger keeps its ordinary click');
  const originalClick = pointerEvent(101); popup.click(originalClick);
  assert(originalClick.prevented && originalClick.stopped, popup.name + ': another finger cannot release the original dismissal click');

  popup.open(); popup.down(pointerEvent(303)); cancel(303);
  const afterCancel = pointerEvent(); popup.click(afterCancel);
  assert(!afterCancel.prevented, popup.name + ': a cancelled gesture does not swallow a later compatibility click');

  popup.open(); popup.down(pointerEvent(404));
  popup.open(); popup.down(pointerEvent(405)); cancel(404);
  const survivingClick = pointerEvent(405); popup.click(survivingClick);
  assert(survivingClick.prevented, popup.name + ': cancelling one finger preserves another pending dismissal');
  const cancelledClick = pointerEvent(404); popup.click(cancelledClick);
  assert(!cancelledClick.prevented, popup.name + ': the cancelled finger has no stale dismissal guard');

  popup.open(); popup.down(pointerEvent(506));
  const legacyClick = pointerEvent(); popup.click(legacyClick);
  assert(legacyClick.prevented, popup.name + ': a compatibility click without pointerId still consumes the active dismissal');
  popup.open(); popup.down(pointerEvent(606)); popup.down(pointerEvent(606));
  const freshGesture = pointerEvent(606); popup.click(freshGesture);
  assert(!freshGesture.prevented, popup.name + ': a new gesture from the same pointer clears its old dismissal');
}
context.view.code = 'EXIT';
storedPreferences.set('hf_code', 'EXIT');
const departure = [];
context.send = message => { departure.push(JSON.parse(JSON.stringify(message))); return true; };
context.ws = { readyState: 1, close() { departure.push('close'); } };
context.connect = () => { departure.push('connect'); };
ids.get('leaveBtn').onclick();
assert.deepEqual(departure, [{ t: 'leave' }, 'close', 'connect'], 'Leave notifies the server before closing and replacing the connection');
assert.equal(context.view, null, 'Leave removes the current table view');
assert.equal(storedPreferences.has('hf_code'), false, 'Leave clears the saved table code');
assert.equal(ids.get('lobby').hidden, false); assert.equal(ids.get('table').hidden, true);

// The waiting room exposes the same Leave lifecycle directly in its header.
{
  const back = ids.get('waitingBackBtn'), originalLeave = ids.get('leaveBtn').onclick;
  const priorMenu = context.window.HFMenu;
  let delegated = 0, homeShown = 0;
  ids.get('leaveBtn').onclick = () => { delegated++; originalLeave(); };
  context.window.HFMenu = { showHome() { homeShown++; } };
  try {
    setup(); context.view.phase = 'lobby'; context.view.code = 'BACK'; context.syncWaitingTableBack();
    assert.equal(back.hidden, false, 'the waiting table shows Back to menu');
    const waitingClick = back.onclick;
    for (const phase of ['playing', 'roundEnd', 'gameEnd']) {
      context.view.phase = phase; context.syncWaitingTableBack();
      assert.equal(back.hidden, true, 'Back to menu is hidden during ' + phase);
      assert.equal(waitingClick(), false, 'a stale waiting-room click cannot leave during ' + phase);
    }
    context.view.phase = 'lobby'; context.view.code = 'NEXT';
    assert.equal(waitingClick(), false, 'an old waiting-room handler cannot leave a different table');
    assert.equal(delegated, 0);
    context.syncWaitingTableBack();
    storedPreferences.set('hf_code', 'NEXT'); context.myCode = 'NEXT'; context.sel = ['4S0']; context.pileSel = [0];
    context.ws = { readyState: 1, close() { departure.push('close'); } }; departure.length = 0;
    ids.get('table').hidden = false; ids.get('lobby').hidden = true;
    back.focus(); assert.equal(back.onclick(), true);
    assert.equal(delegated, 1, 'Back delegates to the existing Leave table handler');
    assert.deepEqual(departure, [{ t: 'leave' }, 'close', 'connect'], 'Back preserves departure and connection ordering');
    assert.equal(context.view, null); assert.equal(context.myCode, null);
    assert.equal(storedPreferences.has('hf_code'), false);
    assert.deepEqual([...context.sel], []); assert.deepEqual([...context.pileSel], []);
    assert.equal(ids.get('lobby').hidden, false); assert.equal(ids.get('table').hidden, true);
    assert.equal(back.hidden, true); assert.equal(homeShown, 1, 'Back returns through the established home-menu wiring');
    assert.equal(document.activeElement, ids.get('homePlay'), 'Back focuses the home Play action');
    back.onclick(); assert.equal(delegated, 1, 'repeated Back activation cannot leave twice');
  } finally {
    ids.get('leaveBtn').onclick = originalLeave;
    if (priorMenu === undefined) delete context.window.HFMenu; else context.window.HFMenu = priorMenu;
  }
}
// The Real Rules preset uses one stock, legal final discards, closed books,
// and the active points table throughout the client action layer.
setup([closed]); context.view.settings = E.rulesForPreset('real');
context.view.stocks = [100]; context.view.turnPhase = 'draw'; context.sel = []; context.pileSel = [];
context.view.discardTop = '3C0'; context.renderActions();
assert(context.drawPickerSelection(), 'one stock draws immediately without choosing two piles');
let realAction;
const beforeRealAct = context.act;
context.act = (action, extra) => { realAction = { action, ...extra }; return true; };
context.autoDrawStateFresh = true; context.ws = { readyState: 1 }; context.expandedSeat = null;
context.openDrawPicker(); context.confirmDrawPicker(); context.closeDrawPicker(false, true); context.autoDrawStateFresh = false;
assert.deepEqual(JSON.parse(JSON.stringify(realAction)), { action: 'draw', piles: [0, 0] });
context.view.turnPhase = 'play'; context.view.turnState = { drew: true, melded: 0 };
context.view.you.inFoot = true; context.view.you.hasInitialMeld = true; context.view.you.canGoOut = { ok: true };
context.view.you.hand = ['4S0']; context.sel = ['4S0']; context.renderActions();
assert.equal(context.canAddSelection(closed), false, 'Real Rules cannot add to a closed book');
assert(discardAction(), 'complete books allow the required final discard');
context.view.you.canGoOut = { ok: false, reason: 'need a black book' }; context.renderActions();
assert.equal(discardAction(), undefined, 'incomplete books cannot use the final discard');
context.view.you.hand = ['8S0', '8H0', '8D0', '3C0', 'KH0']; context.sel = context.view.you.hand.slice(0, 3); context.renderActions();
assert(ids.get('actionHint').innerHTML.includes('30 points'), 'Real Rules counts three eights as thirty points');
context.view.you.hand = context.view.you.hand.slice(0, 3);
assert.equal(context.quickMeldStopReason(null, '8'), 'Keep one card for your final discard.');
context.view.you.redThrees = ['3H0']; assert.equal(context.laidRedThreeValue(), 100);
context.act = beforeRealAct;

// A full preset can be queued mid-round without altering the active rules.
setup(); context.view.code = 'PSET'; context.view.round = 0; context.view.canConfigureRules = true;
context.view.seats = [{ name: 'Host', melds: [] }, { name: 'Vic', melds: [] }];
context.rulesDraft = null; context.rulesEditorBase = null; context.rulesEditorPresetBase = null; context.rulesSignature = null;
context.rulesConfigRequest = null; context.actionPending = false;
context.openRules('rules');
ids.get('rulesPreset').value = 'real';
ids.get('rulesEditor').oninput({ target: ids.get('rulesPreset') });
assert.equal(ids.get('rulesPreset').value, 'real', 'a native input event preserves the newly selected preset until change applies it');
ids.get('rulesPreset').onchange();
assert.deepEqual(JSON.parse(JSON.stringify(context.readRulesEditor())), E.rulesForPreset('real'));
context.view.reshufflesRemaining = 0; context.renderRules();
assert.equal(ids.get('rulesPreset').value, 'real', 'incoming state preserves a selected preset draft');
let presetPatch;
context.act = (action, extra) => { presetPatch = JSON.parse(JSON.stringify(extra.rules)); return true; };
context.submitRulesConfig();
assert.equal(presetPatch.stockPiles, 1); assert.equal(presetPatch.distinctDrawPiles, 1);
assert.equal(presetPatch.goOutWithDiscard, true); assert.equal(presetPatch.redThreeBonus, true);
assert.equal(context.view.settings.stockPiles, 4, 'queued rules do not mutate this round');
context.finishRulesConfig(false, 'test complete'); context.act = beforeRealAct;

// Random chooses each ordered pair uniformly and never draws an empty stock.
const pairCounts = new Map();
for (let first = 0; first < 4; first++) for (let second = 0; second < 3; second++) {
  const rolls = [(first + .25) / 4, (second + .25) / 3];
  const result = context.chooseAutoDrawPiles([1, 2, 3, 4], 'random', [], () => rolls.shift());
  assert.notEqual(result.piles[0], result.piles[1]);
  const key = result.piles.join(','); pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
}
assert.equal(pairCounts.size, 12); assert([...pairCounts.values()].every(count => count === 1));
assert.deepEqual([...context.chooseAutoDrawPiles([0, 9, 0, 2], 'random', [], () => 0).piles], [1, 3]);
assert.deepEqual([...context.chooseAutoDrawPiles([0, 0, 2, 0], 'random').piles], [2, 2]);
assert.equal(context.chooseAutoDrawPiles([0, 0, 0, 0], 'random').ok, false);
context.saveAutoDrawPreference('random', [0, 1]); context.loadAutoDrawPreferences();
assert.equal(context.autoDrawMode, 'random', 'Random persists and reloads as an Auto mode');
for (const id of ['autoDrawBtn', 'autoDrawOff', 'autoDrawChosen', 'autoDrawHighest', 'autoDrawLowest', 'autoDrawRandom', 'autoDrawFixed', 'autoDrawStatus', 'autoDrawHelp', 'closeAutoDraw', 'autoDrawPile0', 'autoDrawPile1', 'autoDrawPile2', 'autoDrawPile3']) if (!ids.has(id)) element(id);
context.autoDrawDraftMode = 'random'; context.view.settings = E.rulesForPreset('christine'); context.syncAutoDrawControls();
assert.equal(ids.get('autoDrawRandom').hidden, false); assert.equal(ids.get('autoDrawRandom')['aria-pressed'], 'true');
assert.equal(ids.get('autoDrawChosen').textContent, 'Choose two piles');
context.view.settings = E.rulesForPreset('real'); context.syncAutoDrawControls();
assert.equal(ids.get('autoDrawRandom').hidden, true); assert.equal(ids.get('autoDrawHighest').hidden, true);
assert.equal(ids.get('autoDrawLowest').hidden, true); assert.equal(ids.get('autoDrawFixed').hidden, true);
assert.equal(ids.get('autoDrawChosen').textContent, 'On'); assert.equal(ids.get('autoDrawChosen')['aria-pressed'], 'true');
setupAuto('random');
context.view.discardTop = '4S8'; context.view.discardCount = 7; context.view.you.hand = ['4H8', '4D8', 'KS8'];
assert(context.pileChance(), 'the Random pause fixture has a legal pickup');
assert.equal(context.autoDrawPlan(), null, 'Random also pauses for a legal discard pickup');

// The compact tray and draw dialog share selection state, with one automatic
// invitation per authoritative draw turn and no implicit draw on a pile tap.
{
  const previous = { query: document.querySelector, all: document.querySelectorAll,
    render: context.render, send: context.send, setTimeout: context.setTimeout, clearTimeout: context.clearTimeout,
    showPeek: context.showPeek, ws: context.ws };
  const sheet = ids.get('drawPickerSheet'), sent = [];
  const pendingTimers = new Map(); let timerId = 0;
  let otherModal = null;
  document.querySelector = selector => {
    if (selector.startsWith('.sheet:not([hidden]):not(#drawPickerSheet)')) return otherModal;
    if (selector.startsWith('.sheet:not')) return otherModal || (!sheet.hidden ? sheet : null);
    return previous.query(selector);
  };
  context.setTimeout = (fn, delay) => { const id = ++timerId; pendingTimers.set(id, { fn, delay }); return id; };
  context.clearTimeout = id => pendingTimers.delete(id);
  context.send = message => { sent.push(JSON.parse(JSON.stringify(message))); return true; };
  context.render = () => { context.renderCenter(); context.syncDrawPicker(); };
  function pickerSetup(mode = 'off') {
    setupAuto(mode);
    otherModal = null; sent.length = 0; pendingTimers.clear();
    context.expandedSeat = null; context.drawPickerContext = null; context.drawPickerShownContext = null;
    sheet.hidden = true; context.view.turnId = 100; context.pileSel = [];
    context.view.settings = E.rulesForPreset('christine');
    context.view.discardTop = 'QS1'; context.view.discardCount = 7;
    context.view.you.hand = ['4S0', '4H0', '2S0', '8D0'];
    context.notice = ''; context.noticeBad = false;
    context.syncAutoDrawTurn();
  }
  try {
    pickerSetup(); context.maybeAutoDraw();
    assert.equal(sheet.hidden, false, 'a fresh manual draw turn opens the picker');
    assert.equal(ids.get('drawPickerDraw').disabled, true, 'the popup waits for two chosen stocks');
    assert.equal(sent.length, 0, 'opening the picker never draws or selects a stock');
    assert.equal(document.activeElement, ids.get('closeDrawPicker'), 'automatic opening focuses a neutral close control');
    assert.equal(ids.get('drawPickerPiles').children.length, 5, 'four draw stocks and the discard share one row');
    ids.get('drawPickerPile0').onclick();
    assert.deepEqual([...context.pileSel], [0]);
    assert.equal(sheet.hidden, false, 'a first selected stock does not close the popup');
    ids.get('drawPickerPile1').onclick();
    assert.equal(ids.get('drawPickerDraw').disabled, false, 'two different live stocks enable Draw');
    context.closeDrawPicker(true, true); context.maybeAutoDraw();
    assert.equal(sheet.hidden, true, 'dismiss stays dismissed for the same turn');
    context.view = JSON.parse(JSON.stringify(context.view));
    context.view.log.push({ t: 'connected', id: 10 }); context.maybeAutoDraw();
    assert.equal(sheet.hidden, true, 'an unrelated state update does not reopen the picker');
    const priorPickerMode = context.interactionMode; context.interactionMode = 'buttons';
    context.renderCenter(); ids.get('drawPile0').onclick();
    assert.equal(sheet.hidden, true, 'table stock changes selection without reopening the invitation');
    assert.deepEqual([...context.pileSel], [1]);
    ids.get('drawPile2').onclick();
    assert.deepEqual([...context.pileSel], [1, 2]);
    assert.equal(sheet.hidden, true);
    assert.equal(context.confirmTableDraw(), true);
    assert.deepEqual(sent, [{ t: 'action', action: 'draw', turnId: 100, piles: [1, 2] }]);
    assert.equal(context.confirmTableDraw(), false); assert.equal(sent.length, 1, 'double-clicks cannot submit a second draw');
    context.interactionMode = priorPickerMode;
    context.view.turnPhase = 'play'; context.maybeAutoDraw();
    assert.equal(sheet.hidden, true, 'accepted draw closes immediately even during the click guard');

    pickerSetup(); const oldTapMode = context.interactionMode; context.interactionMode = 'tap';
    context.maybeAutoDraw(); context.closeDrawPicker(false, true); context.renderCenter();
    ids.get('drawPile0').onclick(); assert.equal(sent.length, 0, 'Tap waits for the second stock');
    ids.get('drawPile1').onclick(); assert.equal(sent.length, 1, 'Tap completes the draw directly on the table');
    assert.equal(sheet.hidden, true); assert.deepEqual([...sent[0].piles], [0, 1]);
    ids.get('drawPile1').onclick(); assert.equal(sent.length, 1, 'pending Tap draw cannot repeat');
    context.interactionMode = oldTapMode;

    pickerSetup(); otherModal = ids.get('chatSheet'); context.maybeAutoDraw();
    assert.equal(sheet.hidden, true, 'a draw invitation never steals focus from an open chat');
    assert.equal(context.drawPickerShownContext, null, 'blocked invitations remain eligible once the other dialog closes');
    otherModal = null; context.maybeAutoDraw(); assert.equal(sheet.hidden, false);
    otherModal = ids.get('rulesSheet'); context.maybeAutoDraw();
    assert.equal(sheet.hidden, true, 'opening another modal closes the picker');
    otherModal = null; context.maybeAutoDraw(); assert.equal(sheet.hidden, true, 'the same invitation does not reopen after another modal closes');

    pickerSetup(); context.expandedSeat = 1; context.maybeAutoDraw();
    assert.equal(sheet.hidden, true, 'opponent detail defers the turn invitation');
    context.closeOpponentDetail();
    assert.equal(sheet.hidden, true, 'closing detail defers until the current interaction finishes');
    let detailResume = pendingTimers.get(context.opponentDetailResumeTimer); assert(detailResume); detailResume.fn();
    assert.equal(sheet.hidden, false, 'closing opponent detail resumes the pending draw invitation');
    context.closeDrawPicker(false, true); pendingTimers.clear(); context.closeOpponentDetail();
    assert.equal(pendingTimers.size, 0, 'render-time no-op closes do not schedule invitations');

    pickerSetup(); context.view.seats.push({ name: 'Vic', melds: [], handCount: 11, footCount: 11, redThrees: [] });
    context.seatNodes = []; context.renderSeats();
    context.expandedSeat = 1; context.maybeAutoDraw();
    context.seatNodes[1].toggle.onclick();
    assert.equal(context.expandedSeat, null, 'the seat toggle uses the same close lifecycle');
    detailResume = pendingTimers.get(context.opponentDetailResumeTimer); assert(detailResume); detailResume.fn();
    assert.equal(sheet.hidden, false, 'closing detail through the seat toggle resumes the invitation');

    pickerSetup(); context.expandedSeat = 1; context.closeOpponentDetail();
    detailResume = pendingTimers.get(context.opponentDetailResumeTimer); assert(detailResume);
    otherModal = ids.get('autoDrawPopover'); detailResume.fn();
    assert.equal(sheet.hidden, true, 'transferring from opponent detail to another popup does not steal focus');
    otherModal = null; context.maybeAutoDraw(); assert.equal(sheet.hidden, false);

    pickerSetup(); context.view.turn = 1; context.maybeAutoDraw(); assert.equal(sheet.hidden, true, 'opponent turns have no draw picker');
    context.view.turn = 0; context.actionPending = true; context.maybeAutoDraw(); assert.equal(sheet.hidden, true, 'pending actions cannot open a new picker');
    context.actionPending = false; context.maybeAutoDraw(); assert.equal(sheet.hidden, false);
    context.closeDrawPicker(false, true); context.view.turnId++;
    context.maybeAutoDraw(); assert.equal(sheet.hidden, false, 'the next authoritative turn receives its own invitation');
    context.closeDrawPicker(false, true); context.view.round++;
    context.maybeAutoDraw(); assert.equal(sheet.hidden, false, 'a new round receives a new invitation');
    context.view.code = 'ELSE'; context.maybeAutoDraw();
    assert(context.drawPickerContext.startsWith('ELSE:'), 'a room change replaces the old popup context');
    context.view.phase = 'roundEnd'; context.maybeAutoDraw(); assert.equal(sheet.hidden, true);

    pickerSetup(); context.autoDrawStateFresh = false; context.maybeAutoDraw(); assert.equal(sheet.hidden, true, 'cached state never opens a live action');
    context.autoDrawStateFresh = true; context.maybeAutoDraw(); assert.equal(sheet.hidden, false);
    context.ws.readyState = 3; context.maybeAutoDraw(); assert.equal(sheet.hidden, true, 'disconnect closes a draw picker');
    context.ws.readyState = 1; context.maybeAutoDraw(); assert.equal(sheet.hidden, true, 'reconnect cannot repeat an already shown invitation');

    pickerSetup('highest'); context.maybeAutoDraw();
    assert.equal(sheet.hidden, true, 'an eligible automatic plan bypasses the dialog');
    assert.notEqual(context.autoDrawTimer, null, 'automatic drawing remains live with the new dialog');
    let timer = pendingTimers.get(context.autoDrawTimer); assert(timer); timer.fn();
    assert.equal(sent.length, 1);
    pickerSetup('chosen'); context.autoDrawPiles = [0, 1]; context.view.stocks = [0, 20, 30, 40];
    context.maybeAutoDraw(); assert.equal(sheet.hidden, false, 'an unavailable fixed pair opens the manual fallback');
    assert(ids.get('drawPickerHint').textContent.includes('empty'));
    assert.equal(context.autoDrawTimer, null, 'manual fallback never schedules a competing automatic action');

    pickerSetup('highest'); context.view.discardTop = '4D1'; context.maybeAutoDraw();
    assert.equal(sheet.hidden, false, 'a legal pickup pauses Auto with a visible choice');
    assert.equal(ids.get('drawPickerTitle').textContent, 'Take the pile or draw');
    assert.equal(ids.get('drawPickerEyebrow').textContent, 'Auto paused');
    assert.equal(ids.get('drawPickerTake').hidden, false);
    assert.equal(ids.get('drawPickerTake').textContent, 'View pile · ' + context.pileChance().take, 'the draw chooser describes inspection before pickup');
    let inspections = 0; context.showPeek = () => { inspections++; };
    assert.equal(context.openDrawPickerTake(), true);
    assert.equal(sheet.hidden, true); assert.equal(inspections, 1);
    assert.equal(sent.length, 0, 'View pile opens the existing confirmation instead of sending a blind pickup');
    context.showPeek = previous.showPeek;

    pickerSetup('highest'); context.view.discardTop = '4D1'; context.maybeAutoDraw();
    context.pileSel = [0, 1]; context.renderDrawPicker();
    assert.equal(context.confirmDrawPicker(), true);
    assert.equal(context.automaticDrawOrigin, null, 'manually choosing stocks after an Auto pickup pause never requests the You drew reveal');
    assert.equal(context.autoDrawMode, 'highest', 'the manual decision does not turn off the preference');

    pickerSetup(); context.view.settings = E.rulesForPreset('real'); context.view.stocks = [25];
    context.maybeAutoDraw();
    assert.equal(ids.get('drawPickerPiles').children.length, 2, 'one-stock rules render only the stock and discard');
    assert.equal(ids.get('drawPickerDraw').disabled, false, 'one-stock draw needs no pretend pair selection');
    context.confirmDrawPicker(); assert.deepEqual(sent[0].piles, [0, 0]);
    pickerSetup(); context.view.stocks = [0, 0, 2, 0]; context.maybeAutoDraw();
    assert.equal(ids.get('drawPickerDraw').disabled, false, 'the last live stock remains drawable');
    context.confirmDrawPicker(); assert.deepEqual(sent[0].piles, [2, 2]);
    pickerSetup(); context.view.stocks = [0, 0, 0, 0]; context.maybeAutoDraw();
    assert.equal(ids.get('drawPickerDraw').disabled, true, 'empty stocks do not create a stale Draw action');

    pickerSetup('chosen'); context.autoDrawPiles = [0, 1]; context.view.stocks[0] = 0;
    context.maybeAutoDraw(); context.pileSel = [1, 2];
    context.confirmDrawPicker(); context.stopAutoDrawForTurn();
    context.noticeBad = true; context.notice = 'That stock changed; choose again.';
    context.acknowledgeAction();
    const unlock = pendingTimers.get(context.actionUnlockTimer); assert(unlock); unlock.fn();
    assert.equal(sheet.hidden, false, 'a refused draw keeps its manual chooser open');
    assert.equal(ids.get('drawPickerDraw').disabled, false, 'the rejected-action guard releases for a deliberate retry');
    assert.equal(ids.get('drawPickerHint').textContent, context.notice);
    assert.equal(context.autoDrawTimer, null, 'a server rejection cannot restart Auto behind the chooser');

    pickerSetup(); context.maybeAutoDraw();
    context.pileSel = [0, 1]; context.renderDrawPicker();
    context.view.stocks[0] = 0;
    assert.equal(context.confirmDrawPicker(), false, 'the click revalidates live stocks before sending');
    assert.equal(sent.length, 0);
    context.view.turnId++; assert.equal(context.confirmDrawPicker(), false, 'stale dialog context cannot act on a different turn');
    context.closeDrawPicker(false, false); context.openDrawPicker();
    context.ws.close = function () { this.readyState = 3; };
    ids.get('leaveBtn').onclick();
    assert.equal(sheet.hidden, true, 'leaving a table closes the draw picker');
    assert.equal(context.drawPickerShownContext, null, 'leaving clears invitation history for the next table');
    assert.equal(context.view, null);

  } finally {
    context.closeDrawPicker(false, false); context.drawPickerShownContext = null; context.cancelAutoDraw();
    document.querySelector = previous.query; document.querySelectorAll = previous.all;
    context.render = previous.render; context.send = previous.send; context.showPeek = previous.showPeek;
    context.setTimeout = previous.setTimeout; context.clearTimeout = previous.clearTimeout;
    context.ws = previous.ws; context.actionPending = false;
  }
}

// Playing actions live on their actual table destinations. Footer controls are
// reserved for starting or advancing a game, and every destination revalidates.
{
  const before = { send: context.send, render: context.render, query: document.querySelector, stateFresh: context.autoDrawStateFresh };
  const sent = [];
  context.send = message => { sent.push(JSON.parse(JSON.stringify(message))); return true; };
  context.render = () => {};
  function directSetup(melds = []) {
    setup(melds); context.view.seats.push({ name: 'Vic', melds: [] });
    context.actionPending = false; context.notice = ''; context.noticeBad = false;
    context.view.code = 'DIRC'; context.view.round = 0; context.view.turnId = 40;
    context.view.stocks = [10, 11, 12, 13]; context.view.discardTop = 'QS8'; context.view.discardCount = 7;
    context.view.you.hasInitialMeld = true; context.view.you.hand = ['6S0', '6H0', '6D0', '3S0', '9C0'];
    context.sel = context.view.you.hand.slice(0, 3); context.autoDrawStateFresh = false;
    context.closeDiscardConfirmation(false); context.closeDrawPicker(false, false);
    for (const id of ['peekSheet', 'rulesSheet', 'scoreSheet', 'chatSheet']) ids.get(id).hidden = true;
    sent.length = 0;
  }
  try {
    directSetup(); context.renderActions();
    const slot = ids.get('newMeldSlot'), play = newMeldAction();
    assert(slot && ids.get('myMelds').contains(slot), 'the new-meld destination is in the player’s meld shelf');
    assert(play && slot.contains(play));
    assert.equal(play['aria-label'], 'New meld: play 3 6s');
    assert.equal(bar.querySelectorAll('button').length, 0, 'legal new melds do not recreate a footer action');
    const shelf = ids.get('myMelds'), shelfRect = shelf.getBoundingClientRect, slotRect = slot.getBoundingClientRect;
    const oldShelfScroll = shelf.scrollTop, oldHandScroll = hand.scrollTop, focusBeforeReveal = document.activeElement;
    shelf.scrollTop = 0;
    shelf.getBoundingClientRect = () => ({ top: 100, bottom: 160, height: 60 });
    slot.getBoundingClientRect = () => ({ top: 220, bottom: 270, height: 50 });
    context.revealNewMeldTarget();
    assert.equal(shelf.scrollTop, 110, 'a newly available target scrolls into view inside a dense meld shelf');
    assert.equal(hand.scrollTop, oldHandScroll); assert.equal(document.activeElement, focusBeforeReveal);
    context.revealNewMeldTarget(); assert.equal(shelf.scrollTop, 110, 'unrelated layout passes do not keep forcing the shelf position');
    shelf.getBoundingClientRect = shelfRect; slot.getBoundingClientRect = slotRect; shelf.scrollTop = oldShelfScroll;
    play.onclick(); play.onclick();
    assert.deepEqual(sent, [{ t: 'action', action: 'meldNew', turnId: 40, rank: '6', cards: ['6S0', '6H0', '6D0'] }]);
    assert.equal(play.disabled, true, 'the in-table destination locks immediately after sending');

    function acceptKeyboardMeld() {
      const played = ['6S0', '6H0', '6D0'];
      context.view.seats[0].melds = [{ id: 'keyboard-six', rank: '6', cards: played }];
      context.view.you.hand = context.view.you.hand.filter(card => !played.includes(card));
      context.sel = []; context.view.turnState.melded = 15;
      context.view.log = [{ id: 1, t: 'meld', seat: 0, rank: '6', n: 3 }];
    }
    directSetup(); context.renderMine();
    let keyboardTarget = newMeldAction(); keyboardTarget.focus(); keyboardTarget.onclick({ detail: 0 });
    assert(context.newMeldFocusRequest, 'keyboard activation records a focus destination request');
    acceptKeyboardMeld(); context.renderMine();
    assert.equal(document.activeElement, keyboardTarget, 'a pending action does not move keyboard focus early');
    context.actionPending = false; context.renderMine();
    const acceptedBook = ids.get('myMelds').querySelectorAll('.meld').find(node => node.dataset.meldId === 'keyboard-six');
    assert.equal(document.activeElement, acceptedBook, 'accepted keyboard melding focuses the resulting book');
    assert.equal(acceptedBook.lastFocusOptions.preventScroll, true, 'focus recovery cannot move the table viewport');
    assert.equal(context.newMeldFocusRequest, null);
    context.freshPlays = { '6S0': Date.now() }; context.renderMine();
    const highlightedBook = ids.get('myMelds').querySelectorAll('.meld').find(node => node.dataset.meldId === 'keyboard-six');
    assert.notEqual(highlightedBook, acceptedBook);
    assert.equal(document.activeElement, highlightedBook, 'a fresh-card repaint preserves the focused book');
    context.freshPlays = {}; context.renderMine();
    const settledBook = ids.get('myMelds').querySelectorAll('.meld').find(node => node.dataset.meldId === 'keyboard-six');
    assert.notEqual(settledBook, highlightedBook);
    assert.equal(document.activeElement, settledBook, 'highlight expiry cannot drop the recovered keyboard focus');
    assert.equal(settledBook.lastFocusOptions.preventScroll, true);
    ids.get('sortBtn').focus(); context.freshPlays = { '6S0': Date.now() }; context.renderMine();
    assert.equal(document.activeElement, ids.get('sortBtn'), 'a book repaint does not steal focus from a toolbar control');
    context.freshPlays = {};

    directSetup(); context.renderMine(); keyboardTarget = newMeldAction(); keyboardTarget.focus(); keyboardTarget.onclick({ detail: 1 });
    assert.equal(context.newMeldFocusRequest, null, 'pointer melding does not opt into keyboard focus recovery');
    acceptKeyboardMeld(); context.renderMine(); context.actionPending = false; context.renderMine();
    assert.equal(document.activeElement, keyboardTarget, 'pointer play never forces focus to the completed destination');

    directSetup(); context.renderMine(); keyboardTarget = newMeldAction(); keyboardTarget.focus(); keyboardTarget.onclick({ detail: 0 });
    context.stopAutoDrawForTurn(); context.renderMine(); context.actionPending = false; context.renderMine();
    assert.equal(document.activeElement, newMeldAction(), 'a refused keyboard meld restores the retry target');
    assert.equal(context.newMeldFocusRequest, null);

    directSetup(); context.renderMine(); keyboardTarget = newMeldAction(); keyboardTarget.focus(); keyboardTarget.onclick({ detail: 0 });
    context.actionPending = false; context.restoreNewMeldFocus();
    assert(context.newMeldFocusRequest, 'an unrelated state acknowledgement cannot pretend the meld succeeded');
    context.view.round++; context.restoreNewMeldFocus();
    assert.equal(context.newMeldFocusRequest, null, 'a new round retires a stale focus request');

    directSetup(); context.view.you.hand = ['QS0', 'QH0', 'QD0', '3S0', '9C0']; context.sel = context.view.you.hand.slice(0, 3);
    context.renderActions();
    assert.equal(newMeldAction().querySelector('.new-meld-caption').textContent, '3 × Q', 'the visible new-meld caption stays compact');
    assert.match(newMeldAction()['aria-label'], /3 queens/, 'the accessible name retains the spoken rank');

    directSetup(); context.renderActions();
    const retainedSlot = ids.get('newMeldSlot'), oldPlay = newMeldAction();
    context.sel = ['9C0']; context.renderActions();
    assert.equal(ids.get('newMeldSlot'), retainedSlot, 'selection only updates the stable reserved slot');
    assert.equal(retainedSlot.dataset.available, 'false'); assert.equal(retainedSlot.children.length, 0);
    oldPlay.onclick(); assert.equal(sent.length, 0, 'a stale new-meld click cannot play the replacement selection');
    context.sel = ['6S0', '6H0', '6D0']; context.renderActions();
    const staleTurnTarget = newMeldAction(); context.view.turnId++; staleTurnTarget.onclick();
    assert.equal(sent.length, 0, 'a stale turn-token target cannot play a new meld');

    for (const invalidate of [
      () => { context.sel = ['6S0', '6S0', '6D0']; },
      () => { context.sel = ['6S0', '6H0', '6C9']; },
      () => { context.sel = ['6S0', '9C0', '3S0']; },
      () => { context.view.turnPhase = 'draw'; },
      () => { context.view.turn = 1; },
      () => { context.actionPending = true; },
      () => { context.view.you.inFoot = true; context.view.you.hand = context.sel.slice(); },
    ]) {
      directSetup(); invalidate(); context.renderActions();
      assert.equal(newMeldAction(), undefined, 'illegal or stale selections never create a new-meld destination');
      assert.equal(bar.querySelectorAll('button').length, 0);
    }
    directSetup([{ id: 'six-open', rank: '6', cards: ['6S1', '6H1', '6D1'] }]); context.renderActions();
    assert.equal(newMeldAction(), undefined, 'an incomplete same-rank book is extended by its existing target');
    directSetup([{ id: 'six-closed', rank: '6', cards: ['6S1', '6H1', '6D1', '6C1', '6S2', '6H2', '6D2'] }]);
    context.renderActions(); assert(newMeldAction(), 'a finished book permits another legal book of the same rank');

    directSetup(); context.sel = ['3S0']; context.view.discardTop = null; context.view.discardCount = 0;
    context.renderCenter(); context.renderActions();
    const emptyDiscard = ids.get('discardPreview');
    assert.equal(emptyDiscard.tagName, 'button', 'an empty discard pile is still a playable table destination');
    assert(emptyDiscard.className.includes('discard-ready'));
    assert.equal(emptyDiscard.querySelector('.discard-action-cue').textContent, 'Tap to discard');
    assert.match(emptyDiscard['aria-label'], /Discard 3 of spades/);
    emptyDiscard.onclick(); emptyDiscard.onclick();
    assert.deepEqual(sent, [{ t: 'action', action: 'discard', turnId: 40, card: '3S0' }]);
    assert.equal(emptyDiscard.disabled, true, 'the table discard target locks immediately while pending');

    directSetup(); context.sel = ['6S0']; context.renderCenter();
    ids.get('discardPreview').onclick();
    assert.equal(ids.get('discardConfirmSheet').hidden, false, 'discarding a card usable in a new meld preserves the warning');
    assert.equal(sent.length, 0); context.confirmDiscard();
    assert.equal(sent.length, 1); assert.equal(sent[0].action, 'discard');

    directSetup(); context.sel = ['3S0']; context.renderCenter(); const staleDiscard = ids.get('discardPreview');
    context.sel = ['9C0']; staleDiscard.onclick(); assert.equal(sent.length, 0, 'a previously painted discard target cannot discard a newly selected card');
    context.renderCenter(); const stalePhaseDiscard = ids.get('discardPreview');
    context.view.turnPhase = 'draw'; stalePhaseDiscard.onclick(); assert.equal(sent.length, 0);
    for (const change of [
      () => { context.sel = []; }, () => { context.sel = ['6S0', '6H0']; },
      () => { context.view.turn = 1; }, () => { context.view.turnPhase = 'draw'; },
      () => { context.actionPending = true; },
      () => { context.view.you.hasInitialMeld = false; context.view.turnState.melded = 10; },
    ]) {
      directSetup(); context.sel = ['3S0']; change(); context.renderCenter();
      assert(!ids.get('discardPreview').className.includes('discard-ready'), 'only an actionable single-card selection highlights discard');
      assert.equal(ids.get('discardPreview').querySelector('.discard-action-cue'), null);
    }
    directSetup(); context.sel = ['3S0']; context.renderPileChoices(ids.get('drawPickerPiles'), true);
    assert(!ids.get('drawPickerDiscard').className.includes('discard-ready'), 'a draw picker never turns into a discard action');

    directSetup(); context.sel = ['3S0']; context.view.turnState.melded = 20; context.renderActions();
    ids.get('tableUndo').onclick();
    assert.equal(sent.length, 0, 'Undo beside a live Discard requires confirmation');
    assert.equal(ids.get('undoSheet').hidden, false);
    assert.equal(document.activeElement, ids.get('cancelUndo'));
    ids.get('cancelUndo').onclick(); assert.equal(sent.length, 0);
    ids.get('tableUndo').onclick(); ids.get('confirmUndo').onclick();
    assert.equal(sent.length, 1); assert.equal(sent[0].action, 'undo');
    ids.get('confirmUndo').onclick(); assert.equal(sent.length, 1, 'confirmation cannot send twice');
    directSetup(); context.sel = []; context.view.turnState.melded = 20;
    context.view.you.returnableWilds = [{ meldId: 'm1', rank: '7', card: 'XR0' }];
    context.renderActions(); ids.get('tableUndo').onclick();
    assert.equal(sent.length, 0); assert.equal(ids.get('undoWildOptions').children.length, 1);
    ids.get('undoWildOptions').children[0].onclick();
    assert.equal(sent[0].action, 'returnWild'); assert.equal(sent[0].card, 'XR0');
    directSetup(); context.sel = ['3S0']; context.view.turnState.melded = 20; context.renderActions();
    ids.get('tableUndo').onclick(); context.view.turn = 1; context.renderActions();
    ids.get('confirmUndo').onclick(); assert.equal(sent.length, 0, 'stale confirmation cannot reset another turn');

    directSetup(); context.sel = []; context.view.turnState.melded = 20; context.renderActions();
    assert.equal(ids.get('tableUndo').hidden, false); assert.equal(ids.get('tableUndo')['aria-label'], 'Undo melds');
    assert.equal(bar.querySelectorAll('button').length, 0);
    ids.get('tableUndo').onclick(); assert.equal(sent[0].action, 'undo');
    assert.equal(ids.get('tableUndo').disabled, true); ids.get('tableUndo').onclick(); assert.equal(sent.length, 1);
    directSetup(); context.view.turnState.melded = 20; context.view.turnState.tookPile = true; context.renderActions();
    assert.equal(ids.get('tableUndo')['aria-label'], 'Undo pickup');
    context.view.turn = 1; context.renderActions(); assert.equal(ids.get('tableUndo').disabled, true);
    ids.get('tableUndo').onclick(); assert.equal(sent.length, 0, 'undo cannot act after the player’s turn ends');

    directSetup(); context.sel = [];
    const geometry = { handRect: hand.getBoundingClientRect, style: context.getComputedStyle, handParent: hand.parentNode, actionParent: actions.parentNode,
      width: context.window.innerWidth, height: context.window.innerHeight, overflow: context.boardOverflowContext };
    try {
      context.window.innerWidth = 320; context.window.innerHeight = 700; context.expandedSeat = null;
      context.getComputedStyle = element => ({ position: 'relative', paddingBottom: element === board ? '8px' : '0px' });
      hand.getBoundingClientRect = () => ({ top: 500, bottom: 690, height: 190, width: 300 });
      context.boardOverflowContext = null; context.sizeBoard();
      assert.equal(board.dataset.overflow, 'true', 'inline action hints still reserve room and trigger cramped-screen fallback');
      hand.parentNode = actions.parentNode = new Element('div');
      context.boardOverflowContext = null; context.sizeBoard();
      assert.notEqual(board.dataset.overflow, 'true', 'a toolbar above the hand is not subtracted again as a footer');
      const footer = ids.get('tableFooter'), oldFooterHeight = footer.offsetHeight;
      try {
        footer.offsetHeight = 44;
        context.sizeBoard();
        assert.equal(board.dataset.overflow, 'true', 'bottom round/instruction information reserves space before hand cards can be clipped');
      } finally { footer.offsetHeight = oldFooterHeight; }
    } finally {
      hand.getBoundingClientRect = geometry.handRect; context.getComputedStyle = geometry.style;
      hand.parentNode = geometry.handParent; actions.parentNode = geometry.actionParent;
      context.window.innerWidth = geometry.width; context.window.innerHeight = geometry.height;
      context.boardOverflowContext = geometry.overflow;
    }

    // The hand has not moved on the first animation frame. Judge where it
    // will finish, rather than needlessly compressing every opponent first.
    const strip = ids.get('playButtons');
    const stripGeometry = { rect: strip.getBoundingClientRect, hidden: strip.hidden,
      mode: context.interactionMode, handRect: hand.getBoundingClientRect,
      style: context.getComputedStyle, width: context.window.innerWidth,
      height: context.window.innerHeight, overflow: context.boardOverflowContext };
    try {
      context.window.innerWidth = 390; context.window.innerHeight = 844;
      context.interactionMode = 'buttons'; strip.hidden = false;
      context.getComputedStyle = element => ({ position: 'relative', rowGap: '8px',
        paddingBottom: element === board ? '8px' : '0px', marginTop: element === strip ? '-8px' : '0px' });
      strip.getBoundingClientRect = () => ({ height: 0 });
      hand.getBoundingClientRect = () => ({ top: 610, bottom: 760, height: 150, width: 370 });
      context.boardOverflowContext = null; context.sizeBoard();
      assert.notEqual(board.dataset.overflow, 'true', 'opening the action strip does not compress a table that will fit after its animation');
      hand.getBoundingClientRect = () => ({ top: 670, bottom: 820, height: 150, width: 370 });
      context.boardOverflowContext = null; context.sizeBoard();
      assert.equal(board.dataset.overflow, 'true', 'genuine overflow still falls back after allowing for the strip animation');
    } finally {
      strip.getBoundingClientRect = stripGeometry.rect; strip.hidden = stripGeometry.hidden;
      context.interactionMode = stripGeometry.mode; hand.getBoundingClientRect = stripGeometry.handRect;
      context.getComputedStyle = stripGeometry.style; context.window.innerWidth = stripGeometry.width;
      context.window.innerHeight = stripGeometry.height; context.boardOverflowContext = stripGeometry.overflow;
    }

    // A 22-card pickup has one arrivals row above two settled rows. Reclaim
    // unused shelf space, then tray padding, before hiding opponent rows.
    const crowdedGeometry = {
      media: context.window.matchMedia, width: context.window.innerWidth, height: context.window.innerHeight,
      mode: context.interactionMode, layout: context.handLayout, style: context.getComputedStyle,
      handRect: hand.getBoundingClientRect, handHeight: hand.clientHeight, handScroll: hand.scrollHeight,
      handParent: hand.parentNode, actionParent: actions.parentNode, stripRect: strip.getBoundingClientRect,
      shelfHeight: shelf.clientHeight, shelfScroll: shelf.scrollHeight, overflow: context.boardOverflowContext,
    };
    try {
      directSetup();
      context.view.you.hand = deck.slice(0, 22); context.view.you.picked = deck.slice(20, 22);
      context.view.seats = [4, 7, 7, 7].map((count, seat) => ({ name: 'Seat ' + seat,
        melds: Array.from({ length: count }, (_, index) => ({ id: seat + '-' + index,
          rank: '4', cards: ['4S0', '4H0', '4D0'] })) }));
      context.interactionMode = 'buttons'; context.handLayout = 'spread';
      context.window.innerWidth = 390; context.window.innerHeight = 844;
      context.window.matchMedia = query => ({ matches: !query.includes('max-height') });
      hand.parentNode = actions.parentNode = new Element('div');
      context.getComputedStyle = element => ({ position: 'relative', rowGap: '8px',
        paddingBottom: element === board ? '6px' : '0px', marginTop: '0px' });
      strip.getBoundingClientRect = () => ({ height: 44 });
      hand.getBoundingClientRect = () => ({ top: 645, bottom: 786, height: 141, width: 370 });
      hand.clientHeight = hand.scrollHeight = 141;
      shelf.clientHeight = 90; shelf.scrollHeight = 97;
      context.boardOverflowContext = null; context.sizeBoard();
      assert.equal(hand.style['--hand-fresh-rows'], '1');
      assert.equal(hand.style['--hand-settled-rows'], '2');
      assert.equal(board.style['--play-buttons-height'], '52px', 'Buttons keeps its reserved row on the crowded table');
      assert.equal(board.dataset.compactPiles, 'true', 'a squeezed two-row own shelf reclaims tray padding');
      assert.notEqual(board.dataset.overflow, 'true', 'a complete hand does not collapse opponent detail');
      shelf.clientHeight = 100; context.sel = [context.view.you.hand[0]]; context.sizeBoard();
      assert.equal(board.dataset.compactPiles, 'true', 'the recovered space and card selection cannot toggle tray height back');

      context.view.you.hand = deck.slice(0, 16); context.view.you.picked = [];
      context.sizeBoard();
      assert.equal(board.dataset.compactPiles, undefined, 'the normal tray returns when a less crowded hand fits');

      context.view.you.hand = deck.slice(0, 22); context.view.you.picked = deck.slice(20, 22);
      hand.clientHeight = 114; hand.scrollHeight = 141;
      context.sizeBoard();
      assert.equal(board.dataset.compactPiles, 'true');
      assert.equal(board.dataset.overflow, 'true', 'internal hand clipping is detected even when its box ends above the Buttons row');
    } finally {
      context.window.matchMedia = crowdedGeometry.media; context.window.innerWidth = crowdedGeometry.width;
      context.window.innerHeight = crowdedGeometry.height; context.interactionMode = crowdedGeometry.mode;
      context.handLayout = crowdedGeometry.layout; context.getComputedStyle = crowdedGeometry.style;
      hand.getBoundingClientRect = crowdedGeometry.handRect; hand.clientHeight = crowdedGeometry.handHeight;
      hand.scrollHeight = crowdedGeometry.handScroll; hand.parentNode = crowdedGeometry.handParent;
      actions.parentNode = crowdedGeometry.actionParent; strip.getBoundingClientRect = crowdedGeometry.stripRect;
      shelf.clientHeight = crowdedGeometry.shelfHeight; shelf.scrollHeight = crowdedGeometry.shelfScroll;
      context.boardOverflowContext = crowdedGeometry.overflow;
      delete board.dataset.compactPiles;
    }

    for (const [phase, label, action] of [['lobby', 'Deal the first round', 'start'], ['roundEnd', 'Next round', 'nextRound'], ['gameEnd', 'Play again', 'rematch']]) {
      directSetup(); context.view.phase = phase; context.view.seated = 2; context.renderActions();
      const control = bar.querySelectorAll('button').find(button => button.textContent === label);
      assert(control, 'lifecycle controls remain available in ' + phase); control.onclick();
      assert.equal(sent[0].action, action); assert.equal(ids.get('tableUndo').disabled, true);
    }
  } finally {
    context.send = before.send; context.render = before.render; document.querySelector = before.query;
    context.autoDrawStateFresh = before.stateFresh; context.actionPending = false; context.closeDiscardConfirmation(false);
  }
}

// Personal interaction modes share the same legal actions and stale guards.
{
  const before = { render: context.render, send: context.send, mode: context.interactionMode,
    ws: context.ws, fresh: context.autoDrawStateFresh, auto: context.autoDrawMode, saved: storedPreferences.get('hf_interactions'),
    setTimeout: context.setTimeout, clearTimeout: context.clearTimeout };
  const sent = [], region = ids.get('playButtons');
  context.render = () => {};
  context.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  context.clearTimeout = id => timers.delete(id);
  context.send = message => { sent.push(JSON.parse(JSON.stringify(message))); return true; };
  const buttons = () => region.hidden ? [] : region.querySelectorAll('button').filter(button => !button.disabled);
  function modeSetup(melds = []) {
    setup(melds); context.view.seats.push({ name: 'Vic', melds: [] });
    context.view.code = 'MODE'; context.view.round = 0; context.view.turnId = 91;
    context.view.stocks = [10, 11, 12, 13]; context.view.discardTop = 'QS8'; context.view.discardCount = 7;
    context.view.you.hand = ['6S0', '6H0', '6D0', '3S0', '9C0']; context.view.you.hasInitialMeld = true;
    context.sel = context.view.you.hand.slice(0, 3); context.actionPending = false;
    context.interactionMode = 'buttons'; context.newMeldFocusRequest = null;
    context.cancelMeldTap(); context.closeDiscardConfirmation(false); context.closeDrawPicker(false, false);
    for (const id of ['peekSheet', 'rulesSheet', 'scoreSheet', 'chatSheet']) ids.get(id).hidden = true;
    sent.length = 0;
  }
  try {
    context.view = null; storedPreferences.delete('hf_interactions'); context.loadLook();
    assert.equal(context.interactionMode, 'buttons', 'Buttons is the fresh-device default');
    context.setInteractionMode('buttons');
    assert.equal(storedPreferences.get('hf_interactions'), 'buttons');
    context.interactionMode = 'tap'; context.loadLook(); assert.equal(context.interactionMode, 'buttons', 'reload restores the personal mode');
    assert.equal(sent.length, 0, 'changing interaction preferences never sends a table action');
    storedPreferences.set('hf_interactions', 'tap'); context.loadLook(); assert.equal(context.interactionMode, 'tap', 'an explicit Tap preference survives reload');
    storedPreferences.set('hf_interactions', 'invalid'); context.loadLook(); assert.equal(context.interactionMode, 'buttons');

    modeSetup(); context.renderActions();
    assert.deepEqual(buttons().map(button => button.id), ['playNewMeld']);
    assert(!newMeldAction(), 'Buttons removes the direct new-meld destination');
    const newButton = ids.get('playNewMeld'); newButton.focus();
    context.freshPlays = {}; context.renderMine(); context.renderActions();
    assert.equal(ids.get('playNewMeld'), newButton, 'highlight expiry retains the action node');
    assert.equal(document.activeElement, newButton, 'highlight expiry retains keyboard focus');
    newButton.onclick({ detail: 0 }); newButton.onclick({ detail: 0 });
    assert.equal(sent.length, 1); assert.equal(sent[0].action, 'meldNew');
    assert.equal(sent[0].turnId, 91); assert.equal(newButton.disabled, true, 'pending action locks the strip immediately');
    context.view.seats[0].melds.push({ id: 'accepted-six', rank: '6', cards: ['6S0', '6H0', '6D0'] });
    context.view.you.hand = ['3S0', '9C0']; context.sel = []; context.actionPending = false;
    context.view.log = [{ id: 1, t: 'meld', seat: 0, rank: '6' }]; context.renderMine(); context.renderActions();
    assert.equal(document.activeElement.dataset.meldId, 'accepted-six', 'accepted keyboard meld focuses its table destination');

    modeSetup(); context.renderActions(); const retryButton = ids.get('playNewMeld'); retryButton.focus(); retryButton.onclick({ detail: 0 });
    context.newMeldFocusRequest.rejected = true; context.actionPending = false; context.renderMine(); context.renderActions();
    assert.equal(document.activeElement, ids.get('playNewMeld'), 'a refused keyboard meld retains its retry action');
    assert.equal(ids.get('playNewMeld').disabled, false);

    modeSetup(); context.renderActions();
    const staleNew = ids.get('playNewMeld').onclick;
    context.sel = ['3S0']; staleNew({ detail: 1 }); assert.equal(sent.length, 0, 'stale selection cannot play a meld');
    context.renderActions(); const staleDiscard = ids.get('playDiscard').onclick;
    context.view.turnId++; staleDiscard(); assert.equal(sent.length, 0, 'stale turn cannot discard');
    context.renderActions(); ids.get('playDiscard').onclick(); ids.get('playDiscard').onclick();
    assert.equal(sent.length, 1); assert.equal(sent[0].action, 'discard');

    for (const joker of ['XR0', 'XB0']) {
      modeSetup(); context.view.you.hand.push(joker); context.sel = [joker]; context.renderActions();
      assert.equal(ids.get('playDiscard').textContent, 'Discard joker', 'both joker colors fit the fixed Discard slot');
      assert.equal(ids.get('playDiscard')['aria-label'], 'Discard ' + E.label(joker), 'the accessible label retains the joker’s full color identity');
      assert.equal(ids.get('playDiscard').disabled, false);
    }
    modeSetup(); context.sel = ['3S0']; context.renderActions();
    assert.equal(ids.get('playDiscard').textContent, 'Discard ' + E.label('3S0'), 'ordinary cards keep their existing visible discard label');

    const sixes = { id: 'sixes', rank: '6', cards: ['6S1', '6H1', '6D1'] };
    const sevens = { id: 'sevens', rank: '7', cards: ['7S1', '7H1', '7D1'] };
    modeSetup([sixes, sevens]); context.view.you.hand.push('2S0'); context.sel = ['2S0']; context.renderMine(); context.renderActions();
    assert.deepEqual(buttons().map(button => button.id), ['playDiscard'], 'a selected wild offers no existing-meld Add buttons');
    assert.deepEqual(ids.get('myMelds').querySelectorAll('.target').map(book => book.dataset.meldId), ['sixes', 'sevens'],
      'a selected wild highlights both legal books directly');
    const destinations = ids.get('playDestinations');
    assert.equal(destinations.hidden, false, 'the fixed left slot remains visible beside Discard');
    assert.equal(ids.get('playNewMeld').disabled, true, 'a selected wild cannot start an unavailable new meld');
    assert.equal(region.querySelectorAll('button').some(button => button.id.startsWith('playAdd-')), false);
    assert.equal(ids.get('playDiscard').parentNode, region, 'Discard remains its ordinary button');
    assert(ids.get('actionHint').innerHTML.includes('Tap a highlighted book to add'));
    assert(!ids.get('actionHint').innerHTML.includes('Add button'));
    const shelf = ids.get('myMelds'), priorShelfMetrics = { height: shelf.clientHeight, total: shelf.scrollHeight, top: shelf.scrollTop };
    shelf.clientHeight = 63; shelf.scrollHeight = 93; shelf.scrollTop = 0; context.syncTableScrollHints();
    assert.equal(shelf.dataset.scrollEnd, 'true', 'a clipped own-meld row exposes a downward cue');
    shelf.scrollTop = 30; context.syncTableScrollHints();
    assert.equal(shelf.dataset.scrollStart, 'true'); assert.equal(shelf.dataset.scrollEnd, 'false');
    shelf.clientHeight = priorShelfMetrics.height; shelf.scrollHeight = priorShelfMetrics.total; shelf.scrollTop = priorShelfMetrics.top;
    const ownBook = id => ids.get('myMelds').querySelectorAll('button').find(button => button.dataset.meldId === id);
    const prepareButtonMeld = () => {
      modeSetup([sixes, sevens]); context.view.you.hand.push('2S0'); context.sel = ['2S0'];
      context.renderMine(); context.renderActions();
    };
    ownBook('sixes').onclick({ detail: 0 }); ownBook('sixes').onclick({ detail: 0 });
    assert.equal(sent.length, 1, 'book keyboard activation adds once in Buttons');
    assert.deepEqual(sent[0], { t: 'action', action: 'meldAdd', meldId: 'sixes', cards: ['2S0'], turnId: 91 });

    prepareButtonMeld();
    assert(ownBook('sixes')['aria-label'].includes('Tap to add selected cards'), 'book guidance explains the direct add in Buttons');
    ownBook('sixes').onclick({ detail: 1 });
    assert.equal(sent.length, 0, 'one tap waits only for the double-tap disclosure window');
    fireMeldTap();
    assert.equal(sent.length, 1, 'one pointer tap adds in Buttons without an Add-button confirmation');
    assert.deepEqual(sent[0], { t: 'action', action: 'meldAdd', meldId: 'sixes', cards: ['2S0'], turnId: 91 });
    ownBook('sixes').onclick({ detail: 1 });
    assert.equal(sent.length, 1, 'a pending direct add cannot send twice');

    for (const detail of [1, 2]) {
      prepareButtonMeld();
      const wasExpanded = context.isMeldExpanded(sixes, 0);
      ownBook('sixes').onclick({ detail: 1 }); const queuedAdd = timers.get(context.meldTapTimer);
      ownBook('sixes').onclick({ detail }); queuedAdd.callback();
      assert.equal(context.isMeldExpanded(sixes, 0), !wasExpanded, 'mobile and desktop double-taps only change the book view in Buttons');
      assert.equal(sent.length, 0, 'a double-tap cancels the queued Buttons-mode add');
    }
    for (const invalidate of [
      () => { context.sel = ['6S0']; },
      () => { context.view.turnId++; },
      () => { context.actionPending = true; },
      () => { context.discardConfirmation = {}; },
    ]) {
      prepareButtonMeld(); ownBook('sixes').onclick({ detail: 1 }); invalidate(); fireMeldTap();
      assert.equal(sent.length, 0, 'changed selection, turn, pending action, or discard confirmation blocks the queued Buttons-mode add');
    }
    modeSetup([sixes, sevens]); context.sel = ['6S0', '6H0']; context.renderMine(); context.renderActions();
    assert.equal(region.hidden, false, 'an existing-meld-only selection keeps the static action row');
    assert.equal(buttons().length, 0, 'both static slots are disabled for an existing-meld-only selection');
    assert.deepEqual(ids.get('myMelds').querySelectorAll('.target').map(book => book.dataset.meldId), ['sixes']);
    ownBook('sixes').onclick({ detail: 1 }); fireMeldTap();
    assert.deepEqual(sent, [{ t: 'action', action: 'meldAdd', meldId: 'sixes', cards: ['6S0', '6H0'], turnId: 91 }],
      'natural cards still add to their highlighted book with one tap and no button');

    modeSetup([sixes]); context.sel = ['6S0']; context.renderActions();
    assert.deepEqual(buttons().map(button => button.id), ['playDiscard'], 'a single matching natural exposes Discard without an Add action');
    ids.get('playDiscard').onclick(); assert(context.discardConfirmation, 'button discard retains the playable-card warning');
    assert.equal(sent.length, 0); context.confirmDiscard(); context.confirmDiscard(); assert.equal(sent.length, 1);
    modeSetup(); context.sel = ['3S0']; context.renderActions(); context.renderCenter();
    assert(!ids.get('discardPreview').className.includes('discard-ready'));
    ids.get('discardPreview').onclick(); assert.equal(sent.length, 0, 'discard pile opens inspection in Buttons');
    assert.equal(ids.get('peekSheet').hidden, false); ids.get('peekSheet').hidden = true;

    for (const invalidate of [() => { context.sel = []; }, () => { context.sel = ['6S0', '3S0']; },
      () => { context.sel = ['6S0', '6S0', '6D0']; }, () => { context.view.turn = 1; },
      () => { context.view.phase = 'roundEnd'; }, () => { context.view.you.hand = ['3S0']; context.sel = ['3S0']; context.view.you.inFoot = true; }]) {
      modeSetup(); invalidate(); context.renderActions();
      assert.equal(region.hidden, context.view.phase !== 'playing', 'only leaving active play hides the Buttons row');
      assert.equal(buttons().length, 0, 'unavailable actions disable both slots');
      region.querySelectorAll('button').forEach(button => button.onclick());
      assert.equal(sent.length, 0, 'disabled slots cannot send even when their handlers are called programmatically');
    }
    modeSetup(); context.view.you.hasInitialMeld = false; context.view.turnState.melded = 20; context.sel = ['3S0']; context.renderActions();
    assert.equal(region.hidden, false, 'a partial opening retains the action row');
    assert.equal(ids.get('playDiscard').disabled, true, 'a partial opening cannot discard');
    modeSetup(); context.renderActions(); const oldButtonMode = ids.get('playNewMeld').onclick;
    context.setInteractionMode('tap'); oldButtonMode(); assert.equal(sent.length, 0, 'switching modes invalidates old actions');
    context.renderActions(); assert.equal(region.hidden, true); assert(newMeldAction(), 'Tap restores the table destination');

    modeSetup(); context.view.turnPhase = 'draw'; context.sel = []; context.autoDrawMode = 'off';
    context.autoDrawStateFresh = true; context.ws = { readyState: 1 }; context.expandedSeat = null;
    context.pileSel = []; context.renderActions();
    assert.equal(ids.get('playChooseDraw').disabled, true, 'select stocks first');
    assert.equal(ids.get('playDiscard').textContent, 'View pile');
    context.pileSel = [0, 2]; context.renderActions();
    assert.equal(ids.get('playChooseDraw').textContent, 'Draw piles 1 & 3');
    ids.get('playChooseDraw').onclick(); assert.equal(sent[0].action, 'draw');
    assert.deepEqual([...sent[0].piles], [0, 2]);
    context.actionPending = false; context.pileSel = []; context.autoDrawMode = 'highest'; context.renderActions();
    assert.equal(region.hidden, false, 'automatic drawing retains the fixed action row');
    assert.equal(ids.get('playChooseDraw').disabled, true, 'unselected stocks cannot draw');
    context.ws.readyState = 3; context.autoDrawMode = 'off'; context.renderActions();
    assert.equal(ids.get('playChooseDraw').disabled, true, 'a disconnected draw cannot be invoked');

    const beforeStyle = context.getComputedStyle;
    try {
      context.getComputedStyle = element => Object.assign({}, beforeStyle(element), { rowGap: '8px' });
      for (const arrange of [
        () => { context.sel = []; },
        () => { context.sel = ['6S0', '6H0', '6D0']; },
        () => { context.sel = ['3S0']; },
        () => { context.view.turn = 1; },
        () => { context.actionPending = true; },
        () => { context.view.turnPhase = 'draw'; context.sel = []; },
      ]) {
        modeSetup(); arrange(); context.renderActions(); context.sizeBoard();
        assert.equal(region.hidden, false, 'selection, waiting, pending, and draw states all retain the row');
        assert.equal(region.querySelectorAll('button').length, 2, 'the fixed action row always contains exactly two slots');
        assert.equal(board.style['--play-buttons-height'], '52px', 'selection and turn state cannot change the 44-pixel row plus its gap');
        assert.equal(ids.get('playDiscard').parentNode, region, 'Discard stays in the right slot');
      }
      modeSetup(); context.sel = []; context.renderActions();
      const disabledNewMeld = ids.get('playNewMeld'), disabledDiscard = ids.get('playDiscard');
      disabledNewMeld.onclick(); disabledDiscard.onclick();
      assert.equal(sent.length, 0, 'empty-selection disabled actions have no executable command');
      context.sel = ['6S0', '6H0', '6D0']; context.renderActions();
      assert.equal(ids.get('playNewMeld'), disabledNewMeld, 'selection updates the left action in place');
      assert.equal(ids.get('playDiscard'), disabledDiscard, 'selection updates the right action in place');
    } finally {
      context.getComputedStyle = beforeStyle;
    }
  } finally {
    context.cancelMeldTap(); context.closeDiscardConfirmation(false); context.closeDrawPicker(false, false);
    context.render = before.render; context.send = before.send; context.interactionMode = before.mode;
    context.ws = before.ws; context.autoDrawStateFresh = before.fresh; context.autoDrawMode = before.auto;
    context.setTimeout = before.setTimeout; context.clearTimeout = before.clearTimeout;
    context.actionPending = false; context.newMeldFocusRequest = null;
    if (before.saved === undefined) storedPreferences.delete('hf_interactions'); else storedPreferences.set('hf_interactions', before.saved);
  }
}

// Only an explicit server choice gate can open the face-down deal. Choosing a
// foot reverses the protocol's hand pile, with mode-specific confirmation.
{
  const before = { view: context.view, ws: context.ws, send: context.send, mode: context.interactionMode,
    pending: context.actionPending, motion: context.cardMotionOn, media: context.window.matchMedia,
    timeout: context.setTimeout, clearTimeout: context.clearTimeout, focus: document.activeElement,
    seen: storedPreferences.get('hf_seen_deals'), createElement: document.createElement };
  const sent = [], timers = new Map(); let timer = 0;
  const backdrop = new Element('main'); backdrop.inert = false; document.body.appendChild(backdrop);
  function chooseSetup(mode = 'tap', sizes = [11, 11], turnId = 101) {
    context.closeDealChoice(false); setup();
    context.view.code = 'DEAL-UI'; context.view.round = 0; context.view.turnId = turnId;
    context.view.phase = 'choosing'; context.view.you.hand = []; context.view.you.picked = [];
    context.view.seats.push({ name: 'Other', melds: [], handChosen: false });
    context.view.handChoice = { pending: true, canSwap: sizes[0] === sizes[1], pileSizes: sizes, chosenPile: null, remaining: 2 };
    context.interactionMode = mode; context.actionPending = false; context.notice = ''; context.noticeBad = false;
    context.sel = []; context.ws = { readyState: 1 }; sent.length = 0;
  }
  try {
    storedPreferences.delete('hf_seen_deals');
    context.send = message => { sent.push(JSON.parse(JSON.stringify(message))); return true; };
    context.setTimeout = (fn, delay) => { timers.set(++timer, { fn, delay }); return timer; };
    context.clearTimeout = id => timers.delete(id);
    context.cardMotionOn = true; context.window.matchMedia = () => ({ matches: false });
    setup(); context.renderDealChoice(); assert.equal(context.dealChoice, null, 'legacy playing views never acquire a deal gate');
    context.view.phase = 'choosing'; context.renderDealChoice();
    assert.equal(context.dealChoice, null, 'phase alone cannot invent a choice without server metadata');

    chooseSetup(); backdrop.focus(); context.renderDealChoice();
    let active = context.dealChoice;
    assert.equal(active.dialog['aria-modal'], 'true', 'fallback dialogs retain modal semantics');
    assert.equal(backdrop.inert, true, 'the fallback makes the rest of the app inert');
    assert.equal(active.dialog.querySelectorAll('.deal-choice-stack').reduce((n, stack) => n + stack.children.length, 0), 22);
    assert.equal(active.dialog.querySelectorAll('[data-card]').length, 0, 'face-down piles reveal no private identities');
    assert.equal(active.dialog.querySelectorAll('.r').length, 0, 'the chooser never paints a card rank');
    assert(active.dialog.className.split(' ').includes('is-dealing'));
    assert.equal(document.activeElement, active.title, 'initial focus introduces the choice without making either pile look selected');
    active.dialog.onkeydown({ key: 'Tab', shiftKey: false, preventDefault() {} });
    assert.equal(document.activeElement, active.piles[0].button, 'Tab enters the pile choices from the heading');
    assert.equal(active.confirm.hidden, true, 'Tap has no extra confirmation step');
    const originalDialog = active.dialog; context.renderDealChoice();
    assert.equal(context.dealChoice.dialog, originalDialog, 'presence updates preserve the in-progress deal DOM');
    let prevented = false; active.dialog.oncancel({ preventDefault() { prevented = true; } });
    assert(prevented, 'Escape cannot bypass the server-required choice');
    active.dialog.onkeydown({ key: 'Tab', shiftKey: true, preventDefault() {} });
    assert.equal(document.activeElement, active.piles[1].button, 'keyboard navigation stays within available choices');
    const firstKey = active.key, staleTap = active.piles[0].button.onclick;
    active.piles[0].button.onclick(); active.piles[1].button.onclick();
    assert.deepEqual(sent, [{ t: 'action', action: 'chooseHand', pile: 1, seat: 0, turnId: 101 }], 'one Tap chooses that pile as foot and the opposite pile as hand');
    assert.equal(active.piles[0].button.disabled, true, 'accepted sends lock both piles against duplicate taps');
    assert.equal(context.act('draw', { piles: [0, 1] }), false, 'normal gameplay cannot act through the choice gate');

    context.actionPending = false; context.view.handChoice.pending = false;
    context.view.handChoice.chosenPile = 1; context.view.handChoice.remaining = 1;
    context.renderDealChoice();
    assert.equal(active.dialog.dataset.state, 'waiting');
    assert.deepEqual(Array.from(active.piles, pile => pile.label.textContent), ['Foot', 'Hand']);
    assert(active.piles.every(pile => pile.button.disabled)); assert.equal(active.confirm.hidden, true);
    assert.equal(document.activeElement, active.title, 'waiting moves focus off now-disabled choices');
    assert(active.status.textContent.includes('Waiting for 1 player'));
    context.view.phase = 'playing'; context.view.handChoice = null; context.renderDealChoice();
    assert.equal(context.dealChoice, null); assert.equal(backdrop.inert, false);
    assert.equal(document.activeElement, backdrop, 'closing the completed chooser restores prior focus');

    chooseSetup('buttons', [11, 11], 102); context.renderDealChoice(); active = context.dealChoice;
    assert.equal(active.confirm.disabled, true); active.confirm.onclick(); assert.equal(sent.length, 0);
    active.piles[1].button.onclick();
    assert.equal(sent.length, 0, 'Buttons only highlights the candidate foot');
    assert.equal(active.piles[1].button['aria-pressed'], 'true'); assert.equal(active.confirm.disabled, false);
    assert.equal(active.confirm.textContent, 'Select foot'); active.confirm.onclick(); active.confirm.onclick();
    assert.deepEqual(sent, [{ t: 'action', action: 'chooseHand', pile: 0, seat: 0, turnId: 102 }]);
    context.actionPending = false; context.view.you.seat = 1; context.renderDealChoice();
    assert.notEqual(context.dealChoice.key, active.key, 'practice seats receive distinct choice contexts');
    staleTap(); assert.equal(context.submitDealFoot(firstKey), false); assert.equal(sent.length, 1, 'stale callbacks cannot choose for another seat or round');

    chooseSetup('tap', [9, 13], 103); context.renderDealChoice(); active = context.dealChoice;
    assert.deepEqual(Array.from(active.piles, pile => pile.label.textContent), ['Hand', 'Foot']);
    assert(active.piles.every(pile => pile.button.disabled));
    assert.equal(active.confirm.hidden, false); assert.equal(active.confirm.textContent, 'Continue');
    assert.equal(context.pickDealFoot(0, active.key), false, 'unequal custom piles cannot be swapped');
    active.confirm.onclick(); assert.equal(sent[0].pile, 0, 'assigned-size acknowledgement keeps the protocol’s original hand');

    chooseSetup('tap', [11, 11], 104); context.renderDealChoice();
    context.closeDealChoice(false); context.renderDealChoice();
    assert(!context.dealChoice.dialog.className.split(' ').includes('is-dealing'), 'reconnecting to the same pending deal does not replay the animation');
    context.ws.readyState = 3; context.renderDealChoice();
    assert(context.dealChoice.piles.every(pile => pile.button.disabled));
    assert(context.dealChoice.status.textContent.includes('Reconnecting'));
    context.ws.readyState = 1; context.renderDealChoice();
    assert(context.dealChoice.piles.every(pile => !pile.button.disabled));

    chooseSetup('tap', [25, 25], 105); context.renderDealChoice();
    const backs = context.dealChoice.dialog.querySelectorAll('.deal-choice-stack').flatMap(stack => stack.children);
    assert.equal(backs.length, 50, 'configured counts determine all dealt backs');
    assert(Math.max(...backs.map(back => Number(back.style['--deal-index']))) <= 21, 'large custom deals still fit the two-second animation');
    const dealTimer = [...timers.values()].find(entry => entry.delay === 2200); dealTimer.fn();
    assert(!context.dealChoice.dialog.className.split(' ').includes('is-dealing'));
    for (const reduce of [false, true]) {
      chooseSetup('tap', [11, 11], reduce ? 107 : 106);
      context.cardMotionOn = reduce; context.window.matchMedia = () => ({ matches: reduce }); context.renderDealChoice();
      assert(!context.dealChoice.dialog.className.split(' ').includes('is-dealing'), 'motion off and reduced motion both skip the deal sequence');
    }
    context.syncTitle(); assert(document.title.startsWith('Choose your foot'));
    context.renderActions(); assert(ids.get('actionHint').textContent.includes('Choose a pile for your foot'));
    ids.get('scoreSheet').hidden = false; context.syncScoreSheet(); assert.equal(ids.get('scoreSheet').hidden, true);
  } finally {
    context.closeDealChoice(false); document.body.removeChild(backdrop);
    context.view = before.view; context.ws = before.ws; context.send = before.send; context.interactionMode = before.mode;
    context.actionPending = before.pending; context.cardMotionOn = before.motion; context.window.matchMedia = before.media;
    context.setTimeout = before.timeout; context.clearTimeout = before.clearTimeout; document.activeElement = before.focus;
    document.createElement = before.createElement;
    if (before.seen === undefined) storedPreferences.delete('hf_seen_deals'); else storedPreferences.set('hf_seen_deals', before.seen);
  }
}

// The shared deadline, adjusted to server time, owns the start countdown.
// Its overlay updates without replacing melds or requiring another snapshot.
{
  const before = { view: context.view, render: context.render, send: context.send, ws: context.ws, Date: context.Date,
    timeout: context.setTimeout, clearTimeout: context.clearTimeout, offset: context.serverClockOffset,
    countdown: context.roundCountdownTimer, auto: context.autoDrawMode, fresh: context.autoDrawStateFresh,
    attempted: context.autoDrawAttemptedContext, mode: context.interactionMode, pending: context.actionPending };
  let now = 10000, nextTimer = 0, resumed = 0;
  const timers = new Map(), sent = [];
  function advance(ms) {
    const target = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = target;
  }
  try {
    context.Date = { now: () => now };
    context.setTimeout = (fn, ms) => { timers.set(++nextTimer, { fn, at: now + ms }); return nextTimer; };
    context.clearTimeout = id => timers.delete(id);
    context.send = message => { sent.push(JSON.parse(JSON.stringify(message))); return true; };
    setup([closed]); context.view.code = 'COUNT'; context.view.round = 0; context.view.turnId = 501;
    context.view.turnPhase = 'draw'; context.view.stocks = [20, 20, 20, 20]; context.view.discardTop = null;
    context.view.serverNow = 100000; context.view.roundBeginsAt = 103000;
    context.ws = { readyState: 1 }; context.autoDrawStateFresh = true; context.autoDrawMode = 'highest';
    context.autoDrawAttemptedContext = null; context.autoDrawTimer = null; context.actionPending = false;
    context.interactionMode = 'buttons'; context.sel = []; context.expandedSeat = null;
    ['scoreSheet', 'rulesSheet', 'peekSheet', 'chatSheet', 'drawPickerSheet', 'sortPopover', 'autoDrawPopover'].forEach(id => ids.get(id).hidden = true);
    context.updateServerClock(context.view);
    assert.equal(context.roundCountdownRemaining(), 3000, 'server clock calibration handles a large local-clock skew');
    context.renderMine();
    const shelf = ids.get('myMelds'), book = shelf.querySelector('.meld'), overlay = ids.get('roundCountdown');
    assert.equal(overlay.parentNode, shelf, 'countdown is inside the existing own-meld area');
    assert.equal(overlay.querySelector('.round-countdown-label').textContent, 'Game begins');
    assert.equal(overlay.querySelector('.round-countdown-number').textContent, '3');
    assert.equal(overlay.role, 'status');
    assert.equal(context.isMyTurn(), false);
    assert(ids.get('myHand').querySelectorAll('[data-card]').every(card => card.disabled));
    assert.equal(context.toggleHandCard(context.view.you.hand[0]), false); assert.equal(context.sel.length, 0);
    assert.equal(context.act('draw', { piles: [0, 1] }), false);
    assert.equal(context.openDrawPicker(), false);
    context.maybeAutoDraw(); assert.equal(context.autoDrawTimer, null); assert.equal(sent.length, 0);
    context.render = () => {
      resumed++; context.renderRoundCountdown(); context.renderHand(); context.renderActions(); context.maybeAutoDraw();
    };
    advance(1000);
    assert.equal(overlay.querySelector('.round-countdown-number').textContent, '2');
    assert.equal(shelf.querySelector('.meld'), book, 'the timer never replaces existing meld nodes');
    context.updateServerClock({ serverNow: 101000 }); context.renderRoundCountdown();
    assert.equal(ids.get('roundCountdown'), overlay, 'a reconnect snapshot retains the same countdown overlay');
    advance(1000); assert.equal(overlay.querySelector('.round-countdown-number').textContent, '1');
    assert.equal(sent.length, 0); assert.equal(context.autoDrawTimer, null);
    advance(1000);
    assert.equal(resumed, 1, 'the client resumes rendering at the deadline without waiting for a new state message');
    assert.equal(shelf.contains(overlay), false); assert.equal(shelf.dataset.countdown, 'false');
    assert.equal(context.isMyTurn(), true);
    assert(ids.get('myHand').querySelectorAll('[data-card]').every(card => !card.disabled));
    assert.notEqual(context.autoDrawTimer, null, 'automatic draw becomes eligible only after zero');
    advance(249); assert.equal(sent.length, 0);
    advance(1); assert.equal(sent.length, 1); assert.equal(sent[0].action, 'draw');
    context.updateServerClock({ serverNow: 104000 }); context.renderRoundCountdown();
    assert.equal(shelf.querySelector('.round-countdown'), null, 'an expired deadline never restarts on reconnect');
    delete context.view.roundBeginsAt; context.renderRoundCountdown();
    assert.equal(context.roundCountdownRemaining(), 0, 'legacy snapshots do not get an invented countdown');
  } finally {
    context.cancelAutoDraw(); context.view = null; context.renderRoundCountdown();
    context.view = before.view; context.render = before.render; context.send = before.send; context.ws = before.ws;
    if (before.Date === undefined) delete context.Date; else context.Date = before.Date;
    context.setTimeout = before.timeout; context.clearTimeout = before.clearTimeout; context.serverClockOffset = before.offset;
    context.roundCountdownTimer = before.countdown; context.autoDrawMode = before.auto; context.autoDrawStateFresh = before.fresh;
    context.autoDrawAttemptedContext = before.attempted; context.interactionMode = before.mode; context.actionPending = before.pending;
  }
}

console.log('Client legality, interaction modes, foot choice, start countdown, three settings sections, stable hand/book/action nodes, fresh-play expiry, turn tokens, accessible discard names, safe autodraw, and existing UI regressions passed.');
