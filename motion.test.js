'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('./engine');
const code = fs.readFileSync(require.resolve('./app.js'), 'utf8');
const planner = code.split('/* Motion planner: pure snapshot data; also exercised by motion.test.js. */')[1].split('/* End motion planner. */')[0];
const ctx = {}; vm.createContext(ctx); vm.runInContext(planner, ctx);
const plan = (a, b, seen = 10) => JSON.parse(JSON.stringify(ctx.planCardMotion(a, b, seen)));
const copy = value => structuredClone(value);
let checks = 0;
function check(title, fn) { fn(); checks++; }
function initial() {
  return { code: 'TEST', phase: 'playing', round: 0, turn: 0, turnId: 7, turnPhase: 'draw', you: { seat: 0, hand: ['a', 'b', 'c'], picked: [], inFoot: false, redThrees: [] },
    stocks: [20, 19, 18, 17], discardTop: 'top', discardCount: 9, settings: { redThreeAutoLayOff: false },
    log: [{ id: 10, t: 'discard', seat: 1, card: 'top' }], seats: [{ melds: [] }, { melds: [] }] };
}
function event(state, info) { state.log.push(Object.assign({ id: 11, seat: 0 }, info)); return state; }
function draw() {
  const before = initial(), after = copy(before);
  after.you.hand = ['second', 'a', 'b', 'first', 'c']; after.you.picked = ['first', 'second']; after.turnPhase = 'play';
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

const reveal = (a, b, seen = 10) => JSON.parse(JSON.stringify(ctx.planDrawReveal(a, b, seen)));
check('draw reveal preserves actual own arrivals and their pile order', () => {
  const { before, after } = draw();
  assert.deepEqual(reveal(before, after), { cards: ['first', 'second'], piles: [3, 1] });
});
check('last available one-card draw is displayed as one card, never an invented pair', () => {
  const before = initial(), after = copy(before);
  after.you.hand.push('last'); after.you.picked = ['last']; event(after, { t: 'draw', n: 1, piles: [3] });
  assert.deepEqual(reveal(before, after), { cards: ['last'], piles: [2] });
});
check('replacement arrivals remain readable without claiming an unknown stock source', () => {
  const { before, after } = draw(); after.you.redThrees = ['3H0'];
  assert.deepEqual(reveal(before, after), { cards: ['first', 'second'], piles: [null, null] });
  assert.deepEqual(plan(before, after), []);
});
check('reveal excludes opponents, catch-up, reconnect, duplicate state, undo and new rounds', () => {
  const { before, after } = draw();
  assert.equal(reveal(null, after), null);
  assert.equal(reveal(after, after, 11), null);
  assert.equal(reveal(after, before, 11), null);
  for (const mutate of [state => state.log[1].seat = 1, state => state.round++, state => state.you.inFoot = true,
    state => state.log.push({ id: 12, seat: 0, t: 'meld' }), state => state.log[1].id = 15]) {
    const changed = copy(after); mutate(changed); assert.equal(reveal(before, changed), null);
  }
});
check('a malformed pair never duplicates or reveals a card that was already held', () => {
  const { before, after } = draw();
  for (const picked of [['first', 'first'], ['first', 'a'], ['first', 'second', 'a']]) {
    after.you.picked = picked;
    if (picked.length === 3) assert.deepEqual(reveal(before, after).cards, ['first', 'second']);
    else assert.equal(reveal(before, after), null);
  }
});

// Exercise the actual modal lifecycle against a deterministic DOM/animation
// clock: authoritative hand content stays intact, only its two faces are hidden.
const motionSection = code.slice(code.indexOf("var cardMotionOn ="), code.indexOf('/* ---------------- noticing what everyone else played'));
function revealHarness({ reduced = false, enabled = true, fallback = false } = {}) {
  let now = 0, timerId = 0;
  const timers = new Map(), ids = new Map(), listeners = {}, animations = [];
  let document;
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.className = ''; this.style = {};
      this.listeners = {}; this.attributes = {}; this.open = false; this.isConnected = true; this.inert = false;
      this.classList = {
        add: value => { if (!this.className.split(' ').includes(value)) this.className += ' ' + value; },
        remove: value => { this.className = this.className.split(' ').filter(name => name !== value).join(' '); },
        toggle: (value, on) => on ? this.classList.add(value) : this.classList.remove(value),
      };
      if (fallback && tag === 'dialog') this.showModal = undefined;
    }
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
    removeChild(node) { this.children = this.children.filter(item => item !== node); node.parentNode = null; node.isConnected = false; }
    setAttribute(name, value) { this.attributes[name] = value; if (name === 'open') this.open = true; }
    removeAttribute(name) { delete this.attributes[name]; if (name === 'data-motion-card') delete this.dataset.motionCard; }
    querySelectorAll(selector) {
      return this.children.flatMap(node => (selector === '[data-motion-card]' && node.dataset.motionCard ? [node] : []).concat(node.querySelectorAll(selector)));
    }
    getBoundingClientRect() { return { left: 90, top: 200, width: 86, height: 120, right: 176, bottom: 320 }; }
    closest() { return null; }
    focus() { document.activeElement = this; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    showModal() { this.open = true; }
    close() { this.open = false; if (this.listeners.close) this.listeners.close(); }
    animate(frames, options) {
      const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
      animations.push(animation); return animation;
    }
  }
  document = {
    documentElement: new Node('html'), body: new Node('body'), hidden: false, activeElement: new Node('button'),
    createElement: tag => new Node(tag), querySelector: () => null,
    addEventListener: (type, fn) => listeners[type] = fn,
  };
  const hand = new Node('div'); ids.set('myHand', hand); document.body.appendChild(hand);
  ['old', 'first', 'second'].forEach(card => { const node = new Node('button'); node.dataset.motionCard = card; hand.appendChild(node); });
  function setTimer(fn, delay) { timers.set(++timerId, { fn, at: now + delay }); return timerId; }
  const context = {
    FRESH_MS: Number(code.match(/var FRESH_MS = (\d+);/)[1]),
    document, E: { label: card => card, rankOf: E.rankOf }, get: () => enabled ? 'on' : 'off', $: id => ids.get(id) || null,
    cardEl: card => { const node = new Node('div'); node.dataset.motionCard = card; node.textContent = card; node.className = 'card'; return node; },
    window: {
      innerWidth: 390, innerHeight: 844, requestAnimationFrame: fn => setTimer(fn, 0), cancelAnimationFrame: id => timers.delete(id),
      matchMedia: () => ({ matches: reduced }), setTimeout: setTimer, clearTimeout: id => timers.delete(id),
      addEventListener: (type, fn) => listeners[type] = fn,
    },
  };
  vm.createContext(context); vm.runInContext(motionSection, context);
  const plan = { cards: ['first', 'second'], sources: [{ left: 10, top: 20, width: 30, height: 42 }, { left: 50, top: 20, width: 30, height: 42 }] };
  return {
    context, document, hand, plan, animations, timers, listeners,
    pending: () => hand.children.filter(node => node.className.includes('draw-reveal-pending')).map(node => node.dataset.motionCard),
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = until;
    },
  };
}
check('stock flights arrive, hold readable for 1500ms, then settle into intact hand', () => {
  const h = revealHarness(); const focus = h.document.activeElement;
  h.context.showDrawReveal(h.plan);
  assert.equal(h.context.drawRevealActive(), true);
  assert.deepEqual(h.pending(), ['first', 'second']);
  assert.deepEqual(h.hand.children.map(node => node.dataset.motionCard), ['old', 'first', 'second']);
  assert.equal(h.animations.length, 2);
  h.advance(330); assert.equal(h.context.drawReveal.phase, 'reading');
  h.advance(1499); assert.equal(h.context.drawReveal.phase, 'reading');
  h.advance(1); assert.equal(h.context.drawReveal.phase, 'settling');
  assert.equal(h.animations.length, 4);
  assert(h.hand.children.every(node => !node._arrivalFeedback), 'the hand cue waits until the reveal has landed');
  h.advance(240); assert.equal(h.context.drawRevealActive(), false);
  assert.deepEqual(h.pending(), []); assert.equal(h.document.activeElement, focus); assert.equal(h.timers.size, 0);
  assert.equal(h.hand.children[0]._arrivalFeedback, undefined, 'cards already held never receive the arrival cue');
  for (const node of h.hand.children.slice(1)) {
    const pulse = node._arrivalFeedback;
    assert(pulse.frames.every(frame => frame.outline.includes('#8bd6ff')), 'arrival feedback uses sky blue');
    assert.equal(pulse.options.duration * pulse.options.iterations, h.context.FRESH_MS, 'arrival cue lasts exactly as long as the meld highlight');
    assert.equal(pulse.frames[0].translate, '0 -2px', 'arrival cue uses the meld lift without replacing the selection transform');
  }
});
check('manual draws without flights still highlight only accepted arrivals, without replay on duplicate snapshots', () => {
  const h = revealHarness({ reduced: true }); const { before, after } = draw();
  h.context.view = before; h.context.motionHasState = true; h.context.motionLogId = 10;
  const prepared = h.context.prepareCardMotion(after); h.context.view = after;
  h.context.playCardMotion(prepared);
  assert.equal(h.context.drawRevealActive(), false, 'a manual draw does not gain a popup');
  assert.equal(h.animations.length, 2);
  assert.deepEqual(h.animations[0].frames[0], h.animations[0].frames[1], 'reduced motion uses a steady cue');
  assert.equal(h.animations[0].options.duration, h.context.FRESH_MS);
  h.context.playCardMotion(h.context.prepareCardMotion(copy(after)));
  assert.equal(h.animations.length, 2, 'duplicate state does not restart the cue');
  h.context.resetCardMotion();
  assert(h.animations.every(animation => animation.cancelled), 'leaving the table clears arrival cues');
});
check('draw popup sorts ranks while stock origins and hand destinations stay attached to card IDs', () => {
  for (const [picked, expected] of [
    [['KS0', '4H0'], ['4H0', 'KS0']],
    [['XR0', '2S0'], ['2S0', 'XR0']],
    [['AS0', 'TS0'], ['TS0', 'AS0']],
    [['5H0', '5S0'], ['5H0', '5S0']],
  ]) {
    const h = revealHarness(); h.plan.cards = picked.slice();
    h.hand.children.slice(1).forEach((node, index) => {
      node.dataset.motionCard = picked[index];
      node.getBoundingClientRect = () => ({ left: 200 - index * 100, top: 600, width: 43, height: 62, right: 243 - index * 100, bottom: 662 });
    });
    const originalPlan = copy(h.plan);
    h.context.showDrawReveal(h.plan);
    assert.deepEqual(Array.from(h.context.drawReveal.cards), expected);
    assert.deepEqual(Array.from(h.context.drawReveal.faces, face => face.textContent), expected, 'visible faces match the ascending display order');
    assert.equal(h.context.drawReveal.dialog.children[0].children[1].textContent, expected.join(' and '), 'the accessible summary follows the same order');
    assert.deepEqual(h.plan, originalPlan, 'the planner’s private arrival and stock-source order remains intact');
    expected.forEach((card, index) => {
      const source = originalPlan.sources[picked.indexOf(card)];
      assert(h.animations[index].frames[0].transform.startsWith('translate(' + (source.left - 90) + 'px,'), 'each displayed card flies from its original stock');
    });
    h.advance(330 + 1500);
    expected.forEach((card, index) => {
      const handLeft = 200 - picked.indexOf(card) * 100;
      assert(h.animations[index + 2].frames[1].transform.startsWith('translate(' + (handLeft - 90) + 'px,'), 'settling finds the matching hand card by ID');
    });
    h.advance(240);
    assert.equal(h.context.drawRevealActive(), false); assert.deepEqual(h.pending(), []);
  }
});
check('accepted-state hooks still prepare the readable reveal when flights are switched off', () => {
  const h = revealHarness({ enabled: false }); const { before, after } = draw();
  h.context.view = before; h.context.motionHasState = true; h.context.motionLogId = 10;
  h.context.rememberAutomaticDrawOrigin([3, 1]);
  const prepared = h.context.prepareCardMotion(after);
  assert.equal(prepared.length, 0); assert.deepEqual(Array.from(prepared.drawReveal.cards), ['first', 'second']);
  h.context.view = after; h.context.playCardMotion(prepared);
  assert.equal(h.context.drawRevealActive(), true); assert.equal(h.animations.length, 0);
  h.advance(1500); assert.equal(h.context.drawRevealActive(), false);
});
check('manual draws retain direct stock-to-hand flights without a readable popup', () => {
  const h = revealHarness(); const { before, after } = draw();
  h.context.view = before; h.context.motionHasState = true; h.context.motionLogId = 10;
  h.context.autoDrawMode = 'highest'; // preference is deliberately still on
  h.context.motionElement = () => h.document.createElement('div');
  const prepared = h.context.prepareCardMotion(after);
  assert.equal(prepared.drawReveal, undefined);
  assert.equal(prepared.length, 2);
  assert.deepEqual(Array.from(prepared, item => item.move.from.pile), [3, 1]);
  assert(Array.from(prepared).every(item => item.move.to.zone === 'hand'));
});
check('an accepted automatic draw consumes its origin exactly once', () => {
  const h = revealHarness({ enabled: false }); const { before, after } = draw();
  h.context.view = before; h.context.motionHasState = true; h.context.motionLogId = 10;
  h.context.rememberAutomaticDrawOrigin([3, 1]);
  h.context.autoDrawMode = 'off'; // changing the preference cannot rewrite the sent request
  const prepared = h.context.prepareCardMotion(after);
  assert(prepared.drawReveal); assert.equal(h.context.automaticDrawOrigin, null);
  h.context.view = after;
  assert.equal(h.context.prepareCardMotion(copy(after)).drawReveal, undefined);
});
check('unrelated in-flight state does not discard a valid automatic receipt', () => {
  const h = revealHarness({ enabled: false }); const { before, after } = draw();
  h.context.view = before; h.context.motionHasState = true; h.context.motionLogId = 10;
  h.context.rememberAutomaticDrawOrigin([3, 1]);
  const presence = copy(before); presence.log.push({ id: 11, t: 'connected', seat: 1 });
  assert.equal(h.context.prepareCardMotion(presence).drawReveal, undefined);
  assert(h.context.automaticDrawOrigin);
  h.context.view = presence;
  after.log = presence.log.concat({ id: 12, t: 'draw', seat: 0, n: 2, piles: [4, 2] });
  assert(h.context.prepareCardMotion(after).drawReveal);
});
check('wrong room, round, seat, turn token, expired requests and reconnect never reveal later draws', () => {
  for (const mutate of [state => state.code = 'ELSE', state => state.round++, state => state.you.seat = 1,
    state => state.turn = 1, state => state.turnId++]) {
    const h = revealHarness({ enabled: false }); const { before, after } = draw();
    h.context.view = before; h.context.motionHasState = true; h.context.motionLogId = 10;
    h.context.rememberAutomaticDrawOrigin([3, 1]); mutate(after);
    assert.equal(h.context.prepareCardMotion(after).drawReveal, undefined);
    assert.equal(h.context.automaticDrawOrigin, null);
  }
  for (const expire of [h => h.context.Date = { now: () => 45001 }, h => h.context.resetCardMotion()]) {
    const h = revealHarness({ enabled: false }); const { before, after } = draw();
    h.context.Date = { now: () => 0 }; h.context.view = before;
    h.context.motionHasState = true; h.context.motionLogId = 10;
    h.context.rememberAutomaticDrawOrigin([3, 1]); expire(h);
    assert.equal(h.context.prepareCardMotion(after).drawReveal, undefined);
    assert.equal(h.context.automaticDrawOrigin, null);
  }
});
check('mismatched piles and catch-up states retire automatic origin without a false reveal', () => {
  for (const mutate of [state => state.log[1].piles = [1, 2], state => state.log[1].id = 20,
    state => state.log.push({ id: 12, t: 'meld', seat: 0 })]) {
    const h = revealHarness({ enabled: false }); const { before, after } = draw();
    h.context.view = before; h.context.motionHasState = true; h.context.motionLogId = 10;
    h.context.rememberAutomaticDrawOrigin([3, 1]); mutate(after);
    assert.equal(h.context.prepareCardMotion(after).drawReveal, undefined);
    assert.equal(h.context.automaticDrawOrigin, null);
  }
});
check('motion Off and reduced motion retain the full 1500ms reveal without flights', () => {
  for (const options of [{ enabled: false }, { reduced: true }]) {
    const h = revealHarness(options); h.context.showDrawReveal(h.plan);
    h.advance(1499); assert.equal(h.context.drawRevealActive(), true); assert.equal(h.animations.length, 0);
    h.advance(1); assert.equal(h.context.drawRevealActive(), false); assert.deepEqual(h.pending(), []);
  }
});
check('click dismissal consumes the input and never lets the discarded timer hide cards again', () => {
  const h = revealHarness(); h.context.showDrawReveal(h.plan);
  let prevented = false, stopped = false;
  h.context.drawReveal.dialog.listeners.click({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert(prevented && stopped); assert.equal(h.context.drawRevealActive(), false); assert.deepEqual(h.pending(), []);
  h.advance(5000); assert.deepEqual(h.pending(), []); assert.equal(h.timers.size, 0);
});
check('resize, hidden page, reset and new accepted state cancel safely at every stage', () => {
  for (const elapsed of [0, 400, 1900]) {
    for (const cancel of [h => h.listeners.resize(), h => { h.document.hidden = true; h.listeners.visibilitychange(); },
      h => h.context.resetCardMotion(), h => { h.context.view = null; h.context.prepareCardMotion(initial()); }]) {
      const h = revealHarness(); h.context.showDrawReveal(h.plan); h.advance(elapsed); cancel(h);
      assert.equal(h.context.drawRevealActive(), false); assert.deepEqual(h.pending(), []);
      assert.equal(h.timers.size, 0); assert(h.animations.every(animation => animation.cancelled));
      h.advance(5000); assert.deepEqual(h.pending(), []);
    }
  }
});
check('rerender maintains only the pending faces; fallback modal restores preexisting inertness', () => {
  const h = revealHarness({ fallback: true }); h.hand.inert = true;
  h.context.showDrawReveal(h.plan); assert.equal(h.hand.inert, true);
  h.hand.children.forEach(node => { node.className = 'card'; });
  h.context.syncDrawRevealCards(); assert.deepEqual(h.pending(), ['first', 'second']);
  h.context.closeDrawReveal(); assert.equal(h.hand.inert, true); assert.deepEqual(h.pending(), []);
});
check('an intentional open settings or scores sheet keeps its focus', () => {
  const h = revealHarness(); const focus = h.document.activeElement;
  h.document.querySelector = () => ({ open: true });
  h.context.showDrawReveal(h.plan);
  assert.equal(h.context.drawRevealActive(), false); assert.equal(h.document.activeElement, focus); assert.deepEqual(h.pending(), []);
});
console.log(`${checks} total card-motion and draw-reveal checks passed, including real arrival privacy, timing, dismissal and cancellation.`);
