'use strict';

// Run the real setup controller and shared rule schema without a server. These
// assertions check what each form actually sends, not a duplicate payload builder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('./engine');
const html = fs.readFileSync(require.resolve('./index.html'), 'utf8');
const joinInput = html.match(/<input\b[^>]*\bid="joinCode"[^>]*>/);
assert(joinInput, 'the join form has a native code input');
const joinPattern = joinInput[0].match(/\bpattern="([^"]+)"/);
assert(joinPattern, 'the join code supplies native form validation');
const acceptsCode = new RegExp('^(?:' + joinPattern[1] + ')$');
for (const code of ['ABCD', 'abcd', 'AbCd']) {
  assert(acceptsCode.test(code), 'native validation accepts four letters in either case: ' + code);
}
for (const code of ['ABC', 'ABCDE', 'AB1D', 'AB D']) {
  assert(!acceptsCode.test(code), 'native validation rejects malformed codes: ' + code);
}
assert(html.indexOf('src="engine.js"') < html.indexOf('src="app.js"') &&
  html.indexOf('src="app.js"') < html.indexOf('src="menu.js"'), 'shared rules load before the setup controller');
const ids = new Map(), nodes = [], sent = [], storage = new Map();
let document;
class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.className = ''; this.value = '';
    this.textContent = ''; this.hidden = false; this.checked = false; this.disabled = false;
    this.listeners = {}; this.isConnected = true; nodes.push(this);
  }
  set id(value) { assert(!ids.has(value), 'no duplicate editor id: ' + value); this._id = value; ids.set(value, this); }
  get id() { return this._id; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(node => node !== child); child.parentNode = null; return child; }
  setAttribute(key, value) { this[key] = value; }
  getAttribute(key) { return this[key]; }
  removeAttribute(key) { delete this[key]; }
  addEventListener(type, callback) { (this.listeners[type] || (this.listeners[type] = [])).push(callback); }
  emit(type, target = this) { (this.listeners[type] || []).forEach(callback => callback.call(this, { target, preventDefault() {} })); }
  focus() { document.activeElement = this; }
  reportValidity() { return true; }
  closest(selector) {
    if (matches(this, selector)) return this;
    return this.parentNode ? this.parentNode.closest(selector) : null;
  }
  querySelectorAll(selector) {
    return nodes.filter(node => node !== this && this.contains(node) && matches(node, selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  getClientRects() { return this.hidden ? [] : [{}]; }
}
function matches(node, selector) {
  if (selector === '[hidden]') return node.hidden;
  if (selector === '.sheet:not([hidden])') return node.className.split(' ').includes('sheet') && !node.hidden;
  if (selector.startsWith('.')) return node.className.split(' ').includes(selector.slice(1));
  if (selector === '[data-menu-to]') return false;
  return node.tagName === selector;
}
for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
  const node = new Element(match[1]); node.id = match[3];
  node.className = (match[2].match(/class="([^"]*)"/) || [])[1] || '';
  node.hidden = /\bhidden\b/.test(match[2]); node.checked = /\bchecked\b/.test(match[2]);
}
for (const [select, value] of [['seatCount', '3'], ['botCount', '2']]) ids.get(select).value = value;
ids.get('hostForm').appendChild(ids.get('hostSetupRules'));
ids.get('computerForm').appendChild(ids.get('botSetupRules'));
document = {
  activeElement: null,
  createElement: tag => new Element(tag), getElementById: id => ids.get(id) || null,
  querySelectorAll: selector => nodes.filter(node => matches(node, selector)),
  querySelector: selector => nodes.find(node => matches(node, selector)) || null,
  addEventListener() {},
};
const context = {
  E, document, console, send: message => { sent.push(JSON.parse(JSON.stringify(message))); return true; },
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
  setTimeout() { return 1; }, clearTimeout() {}, MutationObserver: class { observe() {} },
};
context.window = context;
vm.createContext(context);
const fields = fs.readFileSync(require.resolve('./app.js'), 'utf8').match(/var RULE_CONFIG_FIELDS = \[[\s\S]+?\n\];/);
assert(fields, 'setup reuses the actual current rule field definitions');
vm.runInContext(fields[0], context);
vm.runInContext(fs.readFileSync(require.resolve('./menu.js'), 'utf8'), context);
const input = id => ids.get(id);
const finish = () => context.HFMenu.finishRequest();
const defaultsBefore = JSON.stringify(E.DEFAULTS);

for (const prefix of ['host', 'bot']) {
  for (const suffix of ['ruleDeckCount', 'ruleRequireRedBook', 'ruleRequireBlackBook', 'rulePickupTotal']) {
    assert.equal(input(prefix + '-' + suffix).closest('details'), null, 'main setup rule stays visible: ' + prefix + '-' + suffix);
  }
  assert(input(prefix + '-ruleHandSize').closest('details'), 'additional rule controls live under More rules');
  assert.equal(input(prefix + '-rulePickupTotal').value, '7', 'pickup shows total, not hidden extra count');
  assert.equal(input(prefix + '-ruleReshuffleOnce').checked, true);
}
assert.equal(input('joinForm').querySelectorAll('.setup-rules').length, 0, 'joining never offers host rule controls');

input('hostName').value = '  Vic  '; input('seatCount').value = '4';
input('host-ruleDeckCount').value = '1'; input('host-ruleRequireRedBook').value = '2';
input('host-ruleRequireBlackBook').value = '2'; input('host-rulePickupTotal').value = '5';
input('hostForm').emit('submit');
assert.equal(sent.length, 0, 'insufficient decks are rejected before sending create');
assert.equal(input('hostRulesError').hidden, false);
assert.match(input('hostRulesError').textContent, /more decks|smaller deal/i);
assert.equal(input('host-rulePickupTotal').value, '5', 'invalid submission preserves all chosen values');
assert.equal(input('createBtn').disabled, false, 'invalid choices do not lock setup');
input('host-ruleDeckCount').value = '5'; input('hostForm').emit('input');
assert.equal(input('hostRulesError').hidden, true, 'editing a choice clears the stale inline error');
assert.equal(input('host-automaticDecks').textContent, 'Auto · 6 decks', 'automatic deck label follows reserved seats');
input('host-opening0').value = '60'; input('hostReveal').checked = false;
input('hostForm').emit('submit');
assert.equal(sent.length, 1);
assert.equal(sent[0].t, 'create'); assert.equal(sent[0].name, 'Vic'); assert.equal(Number(sent[0].seats), 4);
assert.equal(sent[0].rules.deckCount, 5); assert.equal(sent[0].rules.requireRedBook, 2);
assert.equal(sent[0].rules.requireBlackBook, 2); assert.equal(sent[0].rules.pileTakeExtra, 4);
assert.deepEqual(sent[0].rules.minMelds, [60, 90, 120, 150]);
assert.equal(sent[0].rules.revealPileTake, false); assert.equal(sent[0].revealDiscard, false);
assert.equal(sent[0].rules.stockPiles, 4, 'complete preset mechanics are sent alongside editable rules');
input('hostForm').emit('submit'); assert.equal(sent.length, 1, 'repeated create is suppressed while pending');
finish();

input('botName').value = 'Dan'; input('botCount').value = '3';
input('bot-ruleDeckCount').value = '2'; input('bot-ruleHandSize').value = '20'; input('bot-ruleFootSize').value = '20';
input('bot-ruleRequireRedBook').value = '0'; input('bot-ruleRequireBlackBook').value = '2';
input('bot-rulePickupTotal').value = '1'; input('bot-ruleGoOutBonus').value = '650';
input('bot-ruleRedThreeAutoLayOff').checked = true; input('bot-ruleReshuffleOnce').checked = false;
input('computerForm').emit('submit');
assert.equal(sent.length, 1, 'CPU capacity includes the human plus all requested bots');
assert.equal(input('botRulesError').hidden, false);
input('botCount').value = '1'; input('computerForm').emit('change');
assert.equal(input('botRulesError').hidden, true);
assert.equal(input('bot-automaticDecks').textContent, 'Auto · 4 decks');
input('computerForm').emit('submit');
assert.equal(sent.length, 2);
assert.equal(sent[1].t, 'vsbot'); assert.equal(Number(sent[1].bots), 1);
assert.equal(sent[1].rules.deckCount, 2); assert.equal(sent[1].rules.handSize, 20); assert.equal(sent[1].rules.footSize, 20);
assert.equal(sent[1].rules.requireRedBook, 0); assert.equal(sent[1].rules.requireBlackBook, 2);
assert.equal(sent[1].rules.pileTakeExtra, 0, 'total pickup of one converts to zero extra cards');
assert.equal(sent[1].rules.goOutBonus, 650); assert.equal(sent[1].rules.redThreeAutoLayOff, true);
assert.equal(sent[1].rules.reshuffleOnce, false); assert.equal(sent[1].rules.revealPileTake, true);
assert.deepEqual(sent[1].rules.minMelds, E.DEFAULTS.minMelds, 'friend and computer setup drafts are independent');
finish();

input('host-rulePickupTotal').value = '';
input('hostForm').emit('submit'); assert.equal(sent.length, 2, 'blank numeric choices cannot silently become zero');
assert.equal(input('hostRulesError').hidden, false);
input('host-rulePickupTotal').value = '2.5';
input('hostForm').emit('submit'); assert.equal(sent.length, 2, 'fractional rule values are rejected');
input('joinCode').value = ' abcd '; input('joinName').value = 'Lee'; input('joinForm').emit('submit');
assert.deepEqual(sent[2], { t: 'join', code: 'ABCD', name: 'Lee' }, 'join remains a simple code-and-name request');
assert.equal(JSON.stringify(E.DEFAULTS), defaultsBefore, 'setup never mutates authoritative defaults');
// Selecting a named preset replaces every mechanic; later edits preserve the
// selected rule set's less visible flags instead of falling back to house rules.
finish();
for (const [prefix, form, name] of [['host', 'hostForm', 'hostName'], ['bot', 'computerForm', 'botName']]) {
  const other = prefix === 'host' ? 'bot' : 'host';
  const otherBefore = input(other + '-ruleDeckCount').value;
  input(prefix + 'RulePreset').value = 'real';
  input(form).emit('input', input(prefix + 'RulePreset'));
  assert.equal(input(prefix + 'RulePreset').value, 'real', 'the native input event must not reset a preset before its change event');
  input(prefix + 'RulePreset').emit('change');
  assert.equal(input(prefix + 'RulePreset').value, 'real');
  assert.equal(input(prefix + '-ruleDeckCount').value, '5');
  assert.equal(input(prefix + '-ruleStockPiles').value, '1');
  assert.equal(input(prefix + '-ruleMinNaturalsWild').value, '4');
  assert.equal(input(prefix + '-ruleClosedBooksLocked').checked, true);
  assert.equal(input(prefix + '-ruleHighEightNine').checked, true);
  assert.equal(input(prefix + '-ruleGoOutWithDiscard').checked, true);
  assert.equal(input(prefix + 'Reveal').checked, false);
  assert(input(prefix + 'PresetDifferences').children.some(line => line.textContent.includes('final discard')));
  assert.equal(input(other + '-ruleDeckCount').value, otherBefore, 'preset changes stay in their own form');
  input(name).value = 'Rules test'; input(form).emit('submit');
  assert.deepEqual(sent.at(-1).rules, E.rulesForPreset('real'), 'full real preset reaches the server');
  finish();
  input(prefix + '-ruleRequireRedBook').value = '2'; input(form).emit('change');
  assert.equal(input(prefix + 'RulePreset').value, 'custom');
  input(form).emit('submit');
  assert.equal(sent.at(-1).rules.requireRedBook, 2);
  assert.equal(sent.at(-1).rules.goOutWithDiscard, true, 'custom edits keep Real Rules mechanics');
  assert.equal(sent.at(-1).rules.distinctDrawPiles, 1);
  finish();
  input(prefix + 'RulePreset').value = 'christine'; input(prefix + 'RulePreset').emit('change');
  input(form).emit('submit');
  assert.deepEqual(sent.at(-1).rules, E.rulesForPreset('christine'), 'switching back restores all house defaults');
  finish();
}
input('hostRulePreset').value = 'real'; input('hostRulePreset').emit('change');
context.HFMenu.goTo('host', false);
assert.equal(input('hostRulePreset').value, 'christine', 'fresh table setup starts with Christine’s Rules');
assert.equal(JSON.stringify(E.DEFAULTS), defaultsBefore);
console.log('Game setup: visible primary rules, independent forms, complete create/CPU payloads, validation, error recovery, duplicate guard, and unchanged join tests passed.');
