'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require.resolve('./app.js'), 'utf8');
const planner = code.split('/* Motion planner: pure snapshot data; also exercised by motion.test.js. */')[1].split('/* End motion planner. */')[0];
const ctx = {}; vm.createContext(ctx); vm.runInContext(planner, ctx);
const plan = (a, b, seen = 10) => JSON.parse(JSON.stringify(ctx.planCardMotion(a, b, seen)));
const copy = value => structuredClone(value);
let checks = 0;
function check(title, fn) { fn(); checks++; }
function initial() {
  return { code: 'TEST', phase: 'playing', round: 0, you: { seat: 0, hand: ['a', 'b', 'c'], picked: [], inFoot: false, redThrees: [] },
    stocks: [20, 19, 18, 17], discardTop: 'top', discardCount: 9, settings: { redThreeAutoLayOff: false },
    log: [{ id: 10, t: 'discard', seat: 1, card: 'top' }], seats: [{ melds: [] }, { melds: [] }] };
}
function event(state, info) { state.log.push(Object.assign({ id: 11, seat: 0 }, info)); return state; }
function draw() {
  const before = initial(), after = copy(before);
  after.you.hand = ['second', 'a', 'b', 'first', 'c']; after.you.picked = ['first', 'second'];
  event(after, { t: 'draw', n: 2, piles: [4, 2] }); return { before, after };
}
check('draw uses accepted arrival order and the actual selected stocks', () => {
  const { before, after } = draw();
  assert.deepEqual(plan(before, after), [
    { card: 'first', from: { zone: 'stock', pile: 3 }, to: { zone: 'hand' } },
    { card: 'second', from: { zone: 'stock', pile: 1 }, to: { zone: 'hand' } },
  ]);
});
check('a refused action or duplicate snapshot cannot move cards', () => {
  const before = initial(); assert.deepEqual(plan(before, copy(before)), []);
  const { after } = draw(); assert.deepEqual(plan(after, copy(after), 11), []);
});
check('sorting the same cards is not a draw', () => {
  const before = initial(), after = copy(before); after.you.hand.reverse(); assert.deepEqual(plan(before, after), []);
});
check('a discard must be removed from the hand and become the accepted top', () => {
  const before = initial(), after = event(copy(before), { t: 'discard', card: 'a' });
  after.you.hand = ['b', 'c']; after.discardTop = 'a';
  assert.deepEqual(plan(before, after), [{ card: 'a', from: { zone: 'hand' }, to: { zone: 'discard' } }]);
  after.discardTop = 'other'; assert.deepEqual(plan(before, after), []);
});
check('new and existing meld targets follow card IDs, not a selected rank', () => {
  const before = initial(); before.seats[0].melds = [{ id: 'old', rank: '5', cards: ['oldCard'] }];
  const after = event(copy(before), { t: 'meld', n: 2, rank: '5' }); after.you.hand = ['c'];
  after.seats[0].melds[0].cards.push('a', 'b');
  assert.deepEqual(plan(before, after).map(m => m.to), [{ zone: 'meld', meld: 'old' }, { zone: 'meld', meld: 'old' }]);
  after.seats[0].melds = [{ id: 'new', rank: '5', cards: ['a', 'b'] }];
  assert.deepEqual(plan(before, after).map(m => m.to.meld), ['new', 'new']);
});
check('pickup has separate hand-to-meld, top-to-meld, and discard-to-hand paths', () => {
  const before = initial(), after = event(copy(before), { t: 'pile', n: 3, rank: '5' });
  after.you.hand = ['c', 'take1', 'take2']; after.seats[0].melds = [{ id: 'book', cards: ['a', 'b', 'top'] }];
  const moves = plan(before, after);
  assert.equal(moves.length, 5);
  assert.deepEqual(moves.find(m => m.card === 'top'), { card: 'top', from: { zone: 'discard' }, to: { zone: 'meld', meld: 'book' } });
  assert.deepEqual(moves.filter(m => m.to.zone === 'hand').map(m => m.card), ['take1', 'take2']);
});
check('automatic red-three replacements never claim an uncertain pickup source', () => {
  const before = initial(), after = event(copy(before), { t: 'pile', n: 3, rank: '5' });
  after.settings.redThreeAutoLayOff = true; after.you.hand.push('replacement');
  assert.deepEqual(plan(before, after), []);
  const drawPair = draw(); drawPair.after.you.redThrees = ['redThree'];
  assert.deepEqual(plan(drawPair.before, drawPair.after), []);
});
check('picking up the foot never makes its eleven cards fly from a stock/discard', () => {
  const before = initial(), after = event(copy(before), { t: 'meld', n: 3, rank: '5' });
  after.log.push({ id: 12, t: 'foot', seat: 0 }); after.you.hand = ['foot1', 'foot2']; after.you.inFoot = true;
  after.seats[0].melds = [{ id: 'book', cards: ['a', 'b', 'c'] }];
  assert.equal(plan(before, after).length, 3); assert(plan(before, after).every(m => m.to.zone === 'meld'));
});
check('undo restores cards without replaying the surviving draw event', () => {
  const { before, after } = draw(); const undo = copy(before); undo.you.hand.push('restored');
  assert.deepEqual(plan(after, undo, 11), []);
});
check('multiple actions and missing history skip catch-up animation', () => {
  const { before, after } = draw(); after.log.push({ id: 12, t: 'meld', seat: 0, n: 3 });
  assert.deepEqual(plan(before, after), []);
  after.log = [{ id: 20, t: 'draw', seat: 0, n: 2, piles: [1, 2] }]; assert.deepEqual(plan(before, after), []);
});
check('first state, new room/round, end of round, and changing practice seat skip movement', () => {
  const { before, after } = draw(); assert.deepEqual(plan(null, after), []);
  for (const [field, value] of [['code', 'ELSE'], ['round', 1], ['phase', 'roundEnd']]) {
    const changed = copy(after); changed[field] = value; assert.deepEqual(plan(before, changed), []);
  }
  const changed = copy(after); changed.you.seat = 1; assert.deepEqual(plan(before, changed), []);
});
check('opponent events cannot expose their hidden hand', () => {
  const { before, after } = draw(); after.log[1].seat = 1; assert.deepEqual(plan(before, after), []);
});
check('missing or inconsistent draw metadata fails closed', () => {
  const { before, after } = draw(); after.log[1].piles = null; assert.deepEqual(plan(before, after), []);
  after.log[1].piles = [1, 2]; after.you.picked = ['first']; assert.deepEqual(plan(before, after), []);
});
check('large custom pickup movement remains bounded', () => {
  const before = initial(), after = event(copy(before), { t: 'pile', n: 20, rank: '5' });
  after.you.hand.push(...Array.from({ length: 19 }, (_, i) => 'taken' + i));
  assert.equal(plan(before, after).length, 8);
});
check('log watermark uses the greatest ID, independent of log trimming', () => {
  assert.equal(ctx.latestMotionLogId({ log: [{ id: 19 }, { id: 21 }, { t: 'round' }] }), 21);
  assert.equal(ctx.latestMotionLogId(null), 0);
});
console.log(`${checks} card-motion checks passed: accepted routes, source order, pickup, privacy, undo, catch-up, foot/replacement safety and bounded effects.`);
