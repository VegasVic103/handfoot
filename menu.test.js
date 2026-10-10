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
assert(html.includes('src="startup.js"'), 'the startup guard loads the game scripts');
assert(!/<script\b[^>]*\bsrc="(?:engine|app|menu)\.js"/.test(html),
  'direct game script tags cannot bypass the startup guard');
const playPage = html.match(/<section\b[^>]*id="menu-play"[\s\S]*?<\/section>/)[0];
assert.deepEqual([...playPage.matchAll(/data-menu-to="([^"]+)"/g)].map(match => match[1]),
  ['home', 'host', 'computer', 'join'], 'Play leads directly to every task without a friends submenu');
for (const page of ['host', 'join', 'computer']) {
  const section = html.match(new RegExp('<section\\b[^>]*id="menu-' + page + '"[\\s\\S]*?<\\/section>'))[0];
  assert(section.includes('data-menu-to="play"'), page + ' returns to the same choice screen');
  assert(section.includes(' Back</button>'), page + ' has a visible Back label');
}
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
  appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.children.push(child); return child; }
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
for (const [prefix, form, button] of [['host', 'hostForm', 'createBtn'], ['bot', 'computerForm', 'vsBotBtn']]) {
  const revealLabel = new Element('label'); revealLabel.appendChild(ids.get(prefix + 'Reveal'));
  ids.get(form).appendChild(revealLabel);
  ids.get(form).appendChild(ids.get(prefix + 'RulesError'));
  ids.get(form).appendChild(ids.get(button));
}
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
    assert.equal(input(prefix + '-' + suffix).closest('details'), input(prefix + 'CustomizeRules'), 'primary rule editing is disclosed intentionally: ' + prefix + '-' + suffix);
  }
  assert.equal(input(prefix + 'RuleOverview').closest('details'), null, 'current rule values stay visible outside the editor');
  assert.equal(input(prefix + '-summary-deckCount').textContent, 'Auto · 5');
  assert.equal(input(prefix + '-summary-requireRedBook').textContent, '1');
  assert.equal(input(prefix + '-summary-requireBlackBook').textContent, '1');
  assert.equal(input(prefix + '-summary-pileTakeExtra').textContent, '7 cards');
  assert.equal(input(prefix + '-ruleHandSize').closest('details'), input(prefix + 'CustomizeRules'), 'all rule controls are directly available in Customize');
  assert.equal(input(prefix + 'CustomizeRules').querySelectorAll('details').length, 0, 'no nested Advanced rules disclosure');
  assert.equal(input(prefix + 'CustomizeRules').querySelectorAll('.setup-editor-group').length, 5, 'rules have five readable groups');
  assert.equal(input(prefix + 'Reveal').closest('details'), input(prefix + 'CustomizeRules'), 'discard preview remains editable inside Customize');
  assert.equal(input(prefix === 'host' ? 'createBtn' : 'vsBotBtn').closest('details'), null, 'submit is never hidden with the rule editor');
  assert.equal(input(prefix === 'host' ? 'createBtn' : 'vsBotBtn').parentNode, input(prefix + 'SetupFooter'));
  assert.equal(input(prefix + '-rulePickupTotal').value, '7', 'pickup shows total, not hidden extra count');
  assert.equal(input(prefix + '-ruleReshuffleOnce').checked, true);
  assert.equal(input(prefix + 'ResetRules').hidden, true, 'unchanged defaults do not present an unnecessary reset');
  assert.equal(input(prefix + 'CustomizationCount').textContent, 'Optional');
}
assert.equal(input('hostSeatsHint').textContent, 'You + 2 friends');
assert.equal(input('botSeatsHint').textContent, '3 players, including you');
assert.equal(input('hostSubmitSummary').textContent, 'Next: share your code with 2 friends.');
assert.equal(input('botSubmitSummary').textContent, 'You + 2 computers. Choose your foot, then play.');
assert.equal(input('joinForm').querySelectorAll('.setup-rules').length, 0, 'joining never offers host rule controls');

input('hostName').value = '  Vic  '; input('seatCount').value = '4';
input('host-ruleDeckCount').value = '1'; input('host-ruleRequireRedBook').value = '2';
input('host-ruleRequireBlackBook').value = '2'; input('host-rulePickupTotal').value = '5';
input('hostForm').emit('submit');
assert.equal(sent.length, 0, 'insufficient decks are rejected before sending create');
assert.equal(input('hostRulesError').hidden, false);
assert.equal(input('hostCustomizeRules').open, true, 'invalid rule combinations reveal the editor');
assert.match(input('hostRulesError').textContent, /more decks|smaller deal/i);
assert.equal(input('host-rulePickupTotal').value, '5', 'invalid submission preserves all chosen values');
assert.equal(input('createBtn').disabled, false, 'invalid choices do not lock setup');
input('host-ruleDeckCount').value = '5'; input('hostForm').emit('input');
assert.equal(input('hostRulesError').hidden, true, 'editing a choice clears the stale inline error');
assert.equal(input('host-automaticDecks').textContent, 'Auto · 6 decks', 'automatic deck label follows reserved seats');
assert.equal(input('host-summary-requireRedBook').textContent, '2', 'visible rule summary follows custom edits');
assert.equal(input('hostSubmitSummary').textContent, 'Next: share your code with 3 friends.');
assert.equal(input('hostSeatsHint').textContent, 'You + 3 friends');
assert.equal(input('hostResetRules').hidden, false, 'a customized draft offers an explicit reset');
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
assert.equal(input('botSeatsHint').textContent, '2 players, including you');
assert.equal(input('botSubmitSummary').textContent, 'You + 1 computer. Choose your foot, then play.');
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
  assert.equal(input(prefix + '-ruleGoOutWithDiscard').closest('label').getAttribute('data-changed'), 'true');
  assert.match(input(prefix + 'CustomizationCount').textContent, /changes$/);
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
assert.equal(input('hostRulePreset').value, 'real', 'navigation does not reset the rule draft');
input('host-ruleRequireRedBook').value = '2'; input('hostForm').emit('input');
input('hostCustomizeRules').open = true;
context.HFMenu.goTo('friends', false);
assert.equal(input('lobby').getAttribute('data-menu-page'), 'play', 'legacy friends navigation resolves to the direct choices');
context.HFMenu.goTo('host', false);
assert.equal(input('hostRulePreset').value, 'custom');
assert.equal(input('host-ruleRequireRedBook').value, '2', 'Back preserves custom primary rules');
assert.equal(input('host-ruleGoOutWithDiscard').checked, true, 'Back preserves the entire Real Rules base');
assert.equal(input('hostCustomizeRules').open, true, 'editor retains its draft inspection state');
input('hostRulesDone').onclick();
assert.equal(input('hostCustomizeRules').open, false, 'Done closes the editor');
assert.equal(document.activeElement, input('hostCustomizeTitle'), 'Done returns focus to the editor entry');
assert.equal(input('host-ruleRequireRedBook').value, '2', 'Done preserves rule changes');
input('bot-rulePickupTotal').value = '5'; input('computerForm').emit('input');
context.HFMenu.goTo('computer', false); context.HFMenu.goTo('play', false); context.HFMenu.goTo('computer', false);
assert.equal(input('bot-rulePickupTotal').value, '5', 'CPU draft also survives Back');
assert.equal(input('host-ruleRequireRedBook').value, '2', 'CPU navigation cannot reset friend setup');
input('hostResetRules').onclick();
assert.equal(input('hostRulePreset').value, 'christine', 'reset is explicit');
assert.equal(input('host-ruleRequireRedBook').value, '1');
assert.equal(input('host-ruleGoOutWithDiscard').checked, false);
assert.equal(input('hostResetRules').hidden, true, 'reset disappears again when the default preset is restored');
assert.equal(input('bot-rulePickupTotal').value, '5', 'reset affects only its own form');
input('botCustomizeRules').open = false;
input('computerForm').emit('invalid', input('bot-ruleHandSize'));
assert.equal(input('botCustomizeRules').open, true, 'native invalid inputs are visible before browser focus');
assert.equal(input('bot-ruleHandSize').closest('details'), input('botCustomizeRules'));
assert.equal(JSON.stringify(E.DEFAULTS), defaultsBefore);
console.log('Game setup: visible summaries, disclosed editors, reachable submit, preserved drafts, explicit reset, complete create/CPU payloads, validation, error recovery, duplicate guard and unchanged join tests passed.');
