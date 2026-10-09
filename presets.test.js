/* Preset behavior and complete bot matches under both individual rulesets. */
const assert = require('node:assert/strict');
const E = require('./engine.js');
const G = require('./game.js');
const BOT = require('./bot.js');
let checks = 0;
function test(name, f) { f(); checks++; console.log('  ok  ' + name); }
function played(id = 'christine') {
  const g = G.createGame(['A', 'B'], E.rulesForPreset(id));
  assert(G.startRound(g).ok);
  g.turn = 0; g.turnPhase = 'play'; g.turnState.drew = true;
  g.players[0].hasInitialMeld = true;
  g.players[0].hand = ['4S4', '5S4'];
  return g;
}
function book(rank, black = false, deck = 0) {
  return { id: rank + '-' + deck, rank, cards: black
    ? ['S', 'H', 'D', 'C'].map(s => rank + s + deck).concat([rank + 'S' + (deck+1), rank + 'H' + (deck+1), 'XB' + deck])
    : ['S', 'H', 'D', 'C'].map(s => rank + s + deck).concat([rank + 'S' + (deck+1), rank + 'H' + (deck+1), rank + 'D' + (deck+1)]) };
}
test('Christine is the default and presets are fresh, complete, and server-valid', () => {
  assert.equal(E.rulePresetId(), 'christine');
  for (const id of ['christine', 'real']) {
    const r = E.rulesForPreset(id);
    assert.equal(E.rulePresetId(r), id);
    for (const n of [2, 3, 4]) assert(E.validateSettings(r, n).ok);
    r.minMelds[0] = 5;
    assert.equal(E.rulesForPreset(id).minMelds[0], 50);
    assert.equal(E.rulePresetId(r), 'custom');
  }
  assert.equal(E.rulesForPreset('unknown'), null);
  assert.equal(E.rulesForPreset('__proto__'), null);
  assert(!E.validateSettings({ ruleset: 'real' }, 2).ok);
  assert(!E.validateSettings({ drawCount: 99 }, 2).ok);
  assert(!E.validateSettings({ stockPiles: 1 }, 2).ok);
});
test('each new capability can be customized and survives validation', () => {
  const fields = { minNaturalsWithWild: 4, closedBooksLocked: true, highEightNine: true,
    redThreeBonus: true, goOutWithDiscard: true, stockPiles: 1, distinctDrawPiles: 1 };
  const result = E.validateSettings(fields, 3);
  assert(result.ok); assert.equal(E.rulePresetId(result.settings), 'custom');
  for (const [k, v] of Object.entries(fields)) assert.equal(result.settings[k], v);
});
test('a second same-rank meld waits until the first is a completed book, in both presets', () => {
  for (const id of ['christine', 'real']) for (const firstBlack of [false, true]) {
    const g = played(id), p = g.players[0];
    const first = book('7', firstBlack);
    p.melds = [{ ...first, cards: first.cards.slice(0, 6) }];
    const newCards = ['7S2','7H2','7D2','7C2','7S3','7H3', ...(firstBlack ? ['7D3'] : ['XR3'])];
    p.hand.push(...newCards);
    assert(!G.meldNew(g, 0, '7', newCards).ok);
    p.melds = [first];
    assert(G.meldNew(g, 0, '7', newCards).ok);
    assert.equal(p.melds.length, 2);
    assert.equal(p.melds.filter(m => E.meldStats(m, g.settings).isRedBook).length, 1);
    assert.equal(p.melds.filter(m => E.meldStats(m, g.settings).isBlackBook).length, 1);
  }
});
test('Christine completed books accept naturals; Real completed books lock at seven', () => {
  for (const id of ['christine', 'real']) {
    const g = played(id); g.players[0].melds = [book('7')]; g.players[0].hand.push('7S3');
    assert.equal(G.meldAdd(g, 0, '7-0', ['7S3']).ok, id === 'christine');
  }
});
test('Real permits natural triples but needs four naturals when wilds join, and caps at seven', () => {
  const s = E.rulesForPreset('real');
  assert(E.checkMeld('7', ['7S0','7H0','7D0'], s).ok);
  assert(!E.checkMeld('7', ['7S0','7H0','XR0'], s).ok);
  assert(!E.checkMeld('7', ['7S0','7H0','7D0','XR0'], s).ok);
  assert(E.checkMeld('7', ['7S0','7H0','7D0','7C0','XR0','2D0','XB0'], s).ok);
  assert(!E.checkMeld('7', ['7S0','7H0','7D0','7C0','7S1','7H1','7D1','7C1'], s).ok);
});
test('single-stock draw takes two cards, replaces red threes and never recycles', () => {
  const g = played('real'); g.turnPhase = 'draw'; g.turnState.drew = false;
  g.stocks = [['3H0','9S0','8S0','4C0']];
  const p = g.players[0], start = p.hand.length, red = p.redThrees.length;
  assert(G.drawStock(g, 0, [0,0]).ok);
  assert.equal(p.hand.length, start + 2); assert.equal(p.redThrees.length, red + 1);
  assert(p.hand.includes('9S0')); assert(p.hand.includes('8S0'));
  assert.deepEqual(g.stocks, [['4C0']]); assert.equal(g.reshufflesUsed, 0);
});
test('Real scores 8/9 at ten, laid red threes positive, held red threes negative', () => {
  assert.equal(E.cardValue('8S0'), 5); assert.equal(E.cardValue('9S0', E.rulesForPreset('real')), 10);
  const g = played('real'), p = g.players[0];
  p.hand = ['3D0']; p.foot = []; p.redThrees = ['3H0'];
  p.melds = [{ id:'n', rank:'9', cards:['9S0','9H0','9C0'] }];
  const score = G.scoreRound(g)[0];
  assert.equal(score.meldPts, 30); assert.equal(score.redThreePts, 100);
  assert.equal(score.handCount, 100); assert.equal(score.total, 30);
});
test('Real must discard its final foot card; Christine must meld it', () => {
  for (const id of ['christine', 'real']) {
    const g = played(id), p = g.players[0];
    p.inFoot = true; p.foot = []; p.melds = [book('7'), book('8', true)]; p.hand = ['9S0'];
    const before = JSON.stringify(p);
    const result = G.discard(g, 0, '9S0');
    assert.equal(result.ok, id === 'real');
    if (id === 'real') { assert.equal(g.phase,'roundEnd'); assert.equal(g.roundDetail[0].out,100); }
    else assert.equal(JSON.stringify(p), before);
  }
  const g = played('real'), p = g.players[0]; p.inFoot = true; p.foot = [];
  p.melds = [book('7'), book('8',true), {id:'n',rank:'9',cards:['9S0','9H0','9D0']}]; p.hand = ['9C0'];
  const before = JSON.stringify(p);
  assert(!G.meldAdd(g,0,'n',['9C0']).ok); assert.equal(JSON.stringify(p),before);
});
test('Real may meld to one foot card only when it can legally go out', () => {
  const g = played('real'), p = g.players[0]; p.inFoot = true; p.foot=[];
  p.melds = [book('7'),book('8',true),{id:'n',rank:'9',cards:['9S0','9H0','9D0']}];
  p.hand=['9C0','5C0']; assert(G.meldAdd(g,0,'n',['9C0']).ok);
  assert(G.discard(g,0,'5C0').roundEnded);
});
function rng(seed) { return () => { seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function view(g,seat) {
  const p=g.players[seat];
  return {phase:g.phase,turn:g.turn,turnPhase:g.turnPhase,turnState:g.turnState,settings:g.settings,minMeld:G.minMeldFor(g),
    you:{seat,hand:p.hand.slice(),inFoot:p.inFoot,hasInitialMeld:p.hasInitialMeld,canGoOut:G.canGoOut(g,seat)},
    seats:g.players.map(p=>({melds:p.melds.map(m=>({...m,cards:m.cards.slice()}))})),
    stocks:g.stocks.map(s=>s.length),discardTop:g.discard.at(-1),discardCount:g.discard.length};
}
function apply(g,seat,m) {
  if (!m) return {ok:false,reason:'no move'};
  return {draw:()=>G.drawStock(g,seat,m.piles),pile:()=>G.takePile(g,seat,m.cards),
    meldNew:()=>G.meldNew(g,seat,m.rank,m.cards),meldAdd:()=>G.meldAdd(g,seat,m.meldId,m.cards),
    discard:()=>G.discard(g,seat,m.card),undo:()=>G.undoTurnMelds(g,seat)}[m.action]();
}
for (const id of ['christine','real']) for (const style of BOT.STYLES) test(id+' / '+style+': 12 full matches conserve cards and propose only legal moves',()=>{
  const prior=Math.random;
  try {
    for(let seed=0;seed<12;seed++) {
      Math.random=rng(481+seed*997+BOT.STYLES.indexOf(style)*31);
      const n=2+seed%3,g=G.createGame(['A','B','C','D'].slice(0,n),E.rulesForPreset(id));
      assert(G.startRound(g).ok); const total=E.deckCountFor(g.settings,n)*54;
      let steps=0;
      while(g.phase!=='gameEnd'&&steps++<40000) {
        if(g.phase==='roundEnd'){assert(G.nextRound(g).ok);continue;}
        const m=BOT.decide(view(g,g.turn),style),r=apply(g,g.turn,m);
        assert(r.ok,JSON.stringify({id,style,seed,m,reason:r.reason,hand:g.players[g.turn].hand, melds:g.players[g.turn].melds}));
        const cards=g.stocks.flat().concat(g.discard,...g.players.map(p=>p.hand.concat(p.foot,p.redThrees,...p.melds.map(m=>m.cards))));
        assert.equal(cards.length,total);assert.equal(new Set(cards).size,total);
      }
      assert.equal(g.phase,'gameEnd',JSON.stringify({id,style,seed,turn:g.turn,round:g.round,phase:g.turnPhase,hand:g.players[g.turn].hand,melds:g.players[g.turn].melds,turnState:g.turnState,log:g.log.slice(-8)}));assert.equal(g.scores.length,4);
    }
  } finally {Math.random=prior;}
});
console.log('\n'+checks+' preset checks passed; 96 complete four-round matches.');
