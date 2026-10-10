'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('./app.js'), 'utf8');
const html = fs.readFileSync(require.resolve('./index.html'), 'utf8');
const source = app.slice(app.indexOf('function wireChat()'), app.indexOf('/* ---------------- selection helpers'));
const nodes = new Map();
let document;
class Element {
  constructor(id = '') { this.id = id; this.children = []; this.dataset = {}; this.value = ''; this.hidden = false; this.selectionStart = 0; this.selectionEnd = 0; this.scrollHeight = 400; this.scrollTop = 0; this.clientHeight = 200; this.focuses = 0; this.textContent = ''; }
  set innerHTML(value) { this.children = []; }
  setAttribute(key, value) { this[key] = value; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter(item => item !== child); }
  focus() { this.focuses++; document.activeElement = this; }
  blur() { if (document.activeElement === this) document.activeElement = null; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}
['chatBtn', 'chatSheet', 'chatInput', 'closeChat', 'chatForm', 'chatSend', 'chatStatus', 'chatKeyboard', 'chatKeys', 'hideChatKeyboard', 'chatDeviceKeyboard', 'chatMessages', 'chatUnread', 'chatPlayers'].forEach(id => nodes.set(id, new Element(id)));
const node = id => nodes.get(id);
document = { activeElement: null, createElement: () => new Element() };
node('chatInput').readOnly = true;
node('chatSheet').hidden = true;
node('chatKeyboard').hidden = true;
let connected = true, sent = [];
const context = { document, $: node, view: null, chatKeyboardShift: false, chatKeyboardNumbers: false,
  chatMessages: [], chatUnread: 0, chatPending: null, closeSortPopover() {}, closeAutoDrawPopover() {},
  meSeat: () => 0, send(message) { if (!connected) return false; sent.push(message); return true; } };
vm.createContext(context); vm.runInContext(source, context); context.wireChat();
let checks = 0;
const check = (name, run) => { run(); checks++; };
const event = (key, extra = {}) => Object.assign({ key, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }, extra);
const draft = (value, start = value.length, end = start) => { node('chatInput').value = value; node('chatInput').setSelectionRange(start, end); };
const key = value => node('chatKeys').children.flatMap(row => row.children).find(button => button.dataset.chatKey === value);

check('HTML makes composer read-only without autofocus or a native keyboard request', () => {
  const input = html.match(/<input[^>]*id="chatInput"[^>]*>/)[0];
  assert.match(input, /\breadonly\b/); assert.match(input, /inputmode="none"/); assert.doesNotMatch(input, /autofocus/);
});
check('opening chat preserves draft, focuses Close and leaves both keyboards closed', () => {
  draft('Still here'); node('chatBtn').onclick();
  assert.equal(node('chatInput').value, 'Still here'); assert.equal(document.activeElement, node('closeChat'));
  assert.equal(node('chatInput').focuses, 0); assert.equal(node('chatInput').readOnly, true);
  assert.equal(node('chatInput').inputmode, 'none'); assert.equal(node('chatKeyboard').hidden, true);
  assert.equal(node('chatSheet').dataset.keyboard, 'closed');
});
check('history and incoming messages neither open the keyboard nor steal focus', () => {
  context.renderChat(true); context.chatMessages = [{ id: 1, text: 'Hello', name: 'Vic', seat: 1, at: 1 }];
  context.renderChat(false);
  assert.equal(node('chatInput').focuses, 0); assert.equal(document.activeElement, node('closeChat'));
  assert.equal(node('chatKeyboard').hidden, true);
});
check('only explicit composer click opens the built-in keyboard and keeps native input disabled', () => {
  node('chatInput').focus(); assert.equal(node('chatKeyboard').hidden, true, 'focus alone is not a request to show keys');
  node('chatInput').onclick(); assert.equal(node('chatKeyboard').hidden, false);
  assert.equal(node('chatInput')['aria-expanded'], 'true'); assert.equal(node('chatInput').readOnly, true);
  assert.equal(node('chatSheet').dataset.keyboard, 'open');
});
check('player rail names all occupied seats and marks the current turn without exposing cards', () => {
  context.view = { phase: 'playing', turn: 1, seats: [
    { name: 'Dan', seated: true, hand: ['secret'] }, { name: 'Vic', seated: true },
    { name: 'Sam', seated: true }, { name: 'Maya', seated: true }
  ] };
  context.renderChatPlayers();
  const pills = node('chatPlayers').children;
  assert.deepEqual(pills.map(pill => pill.children[0].textContent), ['Dan', 'Vic', 'Sam', 'Maya']);
  assert.equal(pills[0]['aria-label'], 'Dan, you');
  assert.equal(pills[1]['aria-current'], 'true'); assert.equal(pills[1].children[1].textContent, 'Turn');
  assert.equal(pills[1]['aria-label'], 'Vic, current turn'); assert.equal(pills[0].children.length, 1);
  assert(!JSON.stringify(pills).includes('secret'));
});
check('quiet-game turn updates leave the draft, keyboard, message history and focus unchanged', () => {
  draft('Still writing', 5); node('chatInput').focus();
  const messages = node('chatMessages').children, oldPills = node('chatPlayers').children;
  context.renderChatPlayers(); assert.equal(node('chatPlayers').children, oldPills, 'unchanged players stay mounted');
  context.view.turn = 2; context.renderChatPlayers();
  assert.equal(node('chatPlayers').children[1]['aria-current'], undefined);
  assert.equal(node('chatPlayers').children[2]['aria-current'], 'true');
  assert.equal(node('chatInput').value, 'Still writing'); assert.equal(node('chatInput').selectionStart, 5);
  assert.equal(document.activeElement, node('chatInput')); assert.equal(node('chatKeyboard').hidden, false);
  assert.equal(node('chatMessages').children, messages);
});
check('lobby omits empty seats, names are plain text, and finished rounds clear the turn marker', () => {
  context.view = { phase: 'lobby', turn: 0, seats: [{ name: '<b>Vic</b>', seated: true }, { name: 'Open seat', seated: false }] };
  context.renderChatPlayers(); assert.equal(node('chatPlayers').children.length, 1);
  assert.equal(node('chatPlayers').children[0].children[0].textContent, '<b>Vic</b>');
  assert.equal(node('chatPlayers').children[0]['aria-current'], undefined);
  context.view.phase = 'roundOver'; context.renderChatPlayers();
  assert.equal(node('chatPlayers').children[0]['aria-current'], undefined);
  context.view = null; context.renderChatPlayers(); assert.equal(node('chatPlayers').hidden, true);
});
check('app keys insert at selection and support one-shot shift, numbers, punctuation and space', () => {
  draft('Hllo', 1); key('e').onclick(); assert.equal(node('chatInput').value, 'Hello');
  draft('Hello', 5); key('space').onclick(); key('shift').onclick(); key('v').onclick();
  assert.equal(node('chatInput').value, 'Hello V'); assert.equal(context.chatKeyboardShift, false);
  key('mode').onclick(); key('1').onclick(); key('!').onclick();
  assert.equal(node('chatInput').value, 'Hello V1!'); key('mode').onclick();
});
check('delete, selection replacement and cursor keys handle Unicode without splitting pairs', () => {
  draft('A😀B', 3); key('backspace').onclick(); assert.equal(node('chatInput').value, 'AB');
  draft('A😀B', 1); key('right').onclick(); assert.equal(node('chatInput').selectionStart, 3);
  key('left').onclick(); assert.equal(node('chatInput').selectionStart, 1);
  draft('abcd', 1, 3); key('left').onclick(); assert.equal(node('chatInput').selectionStart, 1);
  draft('abcd', 1, 3); key('right').onclick(); assert.equal(node('chatInput').selectionStart, 3);
  draft('replace', 1, 6); key('i').onclick(); assert.equal(node('chatInput').value, 'rie');
});
check('physical typing, Delete and pasted text work without revealing the app keyboard', () => {
  context.hideChatKeyboard(false); draft('ab', 1);
  const typed = event('c'); node('chatInput').onkeydown(typed); assert(typed.prevented); assert.equal(node('chatInput').value, 'acb');
  node('chatInput').onkeydown(event('Delete')); assert.equal(node('chatInput').value, 'ac');
  const pasted = event('', { clipboardData: { getData: () => ' one\ntwo' } }); node('chatInput').onpaste(pasted);
  assert.equal(node('chatInput').value, 'ac one two'); assert(pasted.prevented); assert.equal(node('chatKeyboard').hidden, true);
  const shortcut = event('a', { metaKey: true }); node('chatInput').onkeydown(shortcut); assert(!shortcut.prevented);
});
check('length limit caps replacement and pasted emojis safely', () => {
  draft('a'.repeat(499)); context.editChatDraft('😀'); assert.equal(node('chatInput').value.length, 499);
  context.editChatDraft('bc'); assert.equal(node('chatInput').value.length, 500);
  draft('a'.repeat(500), 0, 2); context.editChatDraft('😀'); assert.equal(node('chatInput').value.length, 500);
  assert.equal(node('chatInput').value.slice(0, 2), '😀');
});
check('hide and close keep drafts and never switch on native input', () => {
  draft('saved draft'); context.showChatKeyboard(); node('hideChatKeyboard').onclick();
  assert.equal(node('chatKeyboard').hidden, true); assert.equal(node('chatInput').value, 'saved draft');
  assert.equal(node('chatInput').readOnly, true); node('closeChat').onclick();
  assert.equal(node('chatSheet').hidden, true); assert.equal(document.activeElement, node('chatBtn'));
});
check('explicit device keyboard is available but closing and reopening resets to safe mode', () => {
  node('chatBtn').onclick(); node('chatInput').onclick(); node('chatDeviceKeyboard').onclick();
  assert.equal(node('chatInput').readOnly, false); assert.equal(node('chatInput').inputmode, 'text');
  assert.equal(document.activeElement, node('chatInput')); assert.equal(node('chatKeyboard').hidden, true);
  const typed = event('x'); node('chatInput').onkeydown(typed); assert(!typed.prevented, 'native editing is not intercepted');
  node('closeChat').onclick(); node('chatBtn').onclick(); assert.equal(node('chatInput').readOnly, true);
  assert.equal(node('chatInput').inputmode, 'none'); assert.equal(document.activeElement, node('closeChat'));
});
check('send keeps draft until acknowledgment, prevents duplicate sends and never focuses input', () => {
  draft(' hello '); const focuses = node('chatInput').focuses;
  node('chatForm').onsubmit(event('')); assert.equal(sent.length, 1); assert.equal(sent[0].text, 'hello');
  assert.equal(context.chatPending, 'hello'); assert.equal(node('chatInput').value, ' hello ');
  assert.equal(node('chatSend').disabled, true); node('chatForm').onsubmit(event('')); assert.equal(sent.length, 1);
  assert.equal(node('chatInput').focuses, focuses);
});
check('offline send preserves draft and keyboard state', () => {
  context.chatPending = null; connected = false; draft('Try after reconnect');
  const focuses = node('chatInput').focuses; node('chatForm').onsubmit(event(''));
  assert.equal(node('chatInput').value, 'Try after reconnect'); assert.match(node('chatStatus').textContent, /Reconnecting/);
  assert.equal(node('chatInput').focuses, focuses); assert.equal(node('chatKeyboard').hidden, true);
});
console.log(`${checks} chat checks passed: no autofocus, explicit keyboard activation, editing, accessibility fallback, draft retention and send safety.`);
