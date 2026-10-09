/* Hand and Foot — solo (no partnerships) rules engine.
 * Pure functions over a plain-JSON game state so the same code runs in node
 * tests and in the browser, and the whole state can live in one synced doc.
 *
 * Card id: RANK + SUIT + DECK, e.g. "AS0" = ace of spades from deck 0,
 * "XR2" = red joker from deck 2. Ranks: 2..9 T J Q K A, X = joker.
 */

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['S', 'H', 'D', 'C'];
const RED_SUITS = new Set(['H', 'D', 'R']);

const DEFAULTS = {
  deckCount: 0,          // 0 follows players + 2; otherwise use this fixed count
  handSize: 11,
  footSize: 11,
  drawCount: 2,
  stockPiles: 4,          // the stock is split into this many draw piles
  distinctDrawPiles: 2,   // a two-card draw must come from this many different piles
  pileTakeExtra: 6,       // top card + this many behind it
  pileNaturalsRequired: 2, // naturals in hand matching the top card
  /* Whether you may look at the cards a pile-take would bring in before you
   * commit to it. At a physical table the pile is squared face-down and the
   * take is a gamble; this table plays it open. It changes no rule — only what
   * you are allowed to know — so it is the same for every seat, always. */
  revealPileTake: true,
  bookSize: 7,
  maxWildsInBook: 2,       // at most this many wilds in a book, start to finish
  minNaturalsInMeld: 2,    // and never fewer than this many real cards
  minNaturalsWithWild: 2,
  closedBooksLocked: false,
  highEightNine: false,
  redThreeBonus: false,
  goOutWithDiscard: false,
  allowWildBooks: false,
  minMelds: [50, 90, 120, 150],
  redBookBonus: 500,
  blackBookBonus: 300,
  goOutBonus: 500,
  redThreeValue: -100,
  redThreeMode: 'penalty', // 'penalty' | 'bonus' | 'meldable'
  /* How a red three behaves in play. This table plays them as dead cards: they
   * sit in your hand like anything else, they cannot be melded, you discard
   * them to be rid of them, and they only cost you the 100 if you are still
   * holding one when the round ends. Set this true for the other common rule,
   * where a red three lays itself face up the moment it arrives and a
   * replacement card is drawn in its place. */
  redThreeAutoLayOff: false,
  requireRedBook: 1,
  requireBlackBook: 1,
  reshuffleOnce: true,   // first empty stock pile recycles the stock once per round
};

const RULE_RANGES = {
  deckCount: [0, 12], handSize: [5, 20], footSize: [5, 20],
  requireRedBook: [0, 5], requireBlackBook: [0, 5],
  pileTakeExtra: [0, 19], bookSize: [3, 10], maxWildsInBook: [0, 4],
  minNaturalsInMeld: [2, 3], minNaturalsWithWild: [2, 4],
  stockPiles: [1, 4], distinctDrawPiles: [1, 2], redBookBonus: [0, 2000],
  blackBookBonus: [0, 2000], goOutBonus: [0, 2000], redThreeValue: [-2000, 0],
};
const RULE_BOOLEANS = ['revealPileTake', 'redThreeAutoLayOff', 'reshuffleOnce',
  'closedBooksLocked', 'highEightNine', 'redThreeBonus', 'goOutWithDiscard'];
const FIXED_RULES = { drawCount: 2, pileNaturalsRequired: 2, allowWildBooks: false, redThreeMode: 'penalty' };

/* Named presets are complete rule values, never a client-supplied label that
 * overrides a host's edits. Real Rules uses Bicycle's published play rules,
 * adapted to individual scoring. Both keep this app's four-round match. */
const RULE_PRESETS = Object.freeze({
  christine: Object.freeze(Object.assign({}, DEFAULTS, { minMelds: Object.freeze(DEFAULTS.minMelds.slice()) })),
  real: Object.freeze(Object.assign({}, DEFAULTS, {
    deckCount: 5, stockPiles: 1, distinctDrawPiles: 1, revealPileTake: false,
    maxWildsInBook: 3, minNaturalsWithWild: 4, closedBooksLocked: true,
    highEightNine: true, redThreeAutoLayOff: true, redThreeBonus: true,
    goOutBonus: 100, goOutWithDiscard: true, reshuffleOnce: false,
    minMelds: Object.freeze(DEFAULTS.minMelds.slice()),
  })),
});
function rulesForPreset(id) {
  const preset = Object.prototype.hasOwnProperty.call(RULE_PRESETS, id) ? RULE_PRESETS[id] : null;
  return preset ? Object.assign({}, preset, { minMelds: preset.minMelds.slice() }) : null;
}
function rulePresetId(settings) {
  const value = Object.assign({}, DEFAULTS, settings || {});
  return Object.keys(RULE_PRESETS).find(id => Object.keys(DEFAULTS).every(key =>
    JSON.stringify(value[key]) === JSON.stringify(RULE_PRESETS[id][key]))) || 'custom';
}

function deckCountFor(settings, players) { return settings.deckCount || players + 2; }

/* The client and server share the same setup validation. Only explicitly
 * supported choices enter game state; fixed turn mechanics cannot be changed
 * by slipping additional settings into a browser request. */
function validateSettings(input, players, base) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'Rules must be an object.' };
  }
  if (!Number.isInteger(players) || players < 2 || players > 6) {
    return { ok: false, reason: 'Rules need a table with two to six seats.' };
  }
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(RULE_RANGES, key) &&
        !RULE_BOOLEANS.includes(key) && !Object.prototype.hasOwnProperty.call(FIXED_RULES, key) && key !== 'minMelds') {
      return { ok: false, reason: 'That rule is not adjustable: ' + key + '.' };
    }
  }
  const settings = Object.assign({}, DEFAULTS, base || {}, input);
  for (const [key, limits] of Object.entries(RULE_RANGES)) {
    const value = settings[key];
    if (!Number.isInteger(value) || value < limits[0] || value > limits[1]) {
      return { ok: false, reason: key + ' must be a whole number from ' + limits[0] + ' to ' + limits[1] + '.' };
    }
  }
  for (const key of RULE_BOOLEANS) {
    if (typeof settings[key] !== 'boolean') return { ok: false, reason: key + ' must be on or off.' };
  }
  if (!Array.isArray(settings.minMelds) || settings.minMelds.length !== 4 ||
      settings.minMelds.some(value => !Number.isInteger(value) || value < 0 || value > 500)) {
    return { ok: false, reason: 'Set four opening minimums, each a whole number from 0 to 500.' };
  }
  settings.minMelds = settings.minMelds.slice();
  for (const [key, fixed] of Object.entries(FIXED_RULES)) {
    if (settings[key] !== fixed) return { ok: false, reason: 'That rule is fixed: ' + key + '.' };
  }
  if (![1, 4].includes(settings.stockPiles) ||
      settings.distinctDrawPiles !== (settings.stockPiles === 1 ? 1 : 2)) {
    return { ok: false, reason: 'Use one stock with both cards drawn from it, or four stocks with two different piles.' };
  }
  if (settings.closedBooksLocked && settings.requireBlackBook > 0 &&
      Math.max(settings.minNaturalsInMeld, settings.minNaturalsWithWild) + 1 > settings.bookSize) {
    return { ok: false, reason: 'A required black book needs room for its natural minimum and a wild.' };
  }
  const decks = deckCountFor(settings, players);
  const reserve = settings.redThreeAutoLayOff ? Math.min(decks * 2, players * settings.handSize) : 0;
  if (decks * 54 < players * (settings.handSize + settings.footSize) + settings.stockPiles + 1 + reserve) {
    return { ok: false, reason: 'Use more decks or a smaller deal: leave a discard and at least one card in each stock pile.' };
  }
  if (settings.requireBlackBook > 0 && settings.maxWildsInBook === 0) {
    return { ok: false, reason: 'A required black book needs at least one allowed wild.' };
  }
  if (settings.requireRedBook > 0 && settings.bookSize > decks * 4) {
    return { ok: false, reason: 'Use more decks or a smaller book: there are not enough natural cards of one rank for a red book.' };
  }
  if (settings.requireBlackBook > 0 &&
      settings.bookSize > decks * 4 + Math.min(settings.maxWildsInBook, decks * 6)) {
    return { ok: false, reason: 'Use more decks, a smaller book or more allowed wilds: these decks cannot complete a black book.' };
  }
  if ((settings.requireRedBook + settings.requireBlackBook) * settings.bookSize > decks * 50) {
    return { ok: false, reason: 'The required books need more meldable cards than these decks contain.' };
  }
  return { ok: true, settings: settings };
}

/* ---------- card helpers ---------- */

const rankOf = (c) => c[0];
const suitOf = (c) => c[1];
const isJoker = (c) => c[0] === 'X';
const isWild = (c) => c[0] === 'X' || c[0] === '2';
const isRedThree = (c) => c[0] === '3' && RED_SUITS.has(c[1]);
const isBlackThree = (c) => c[0] === '3' && !RED_SUITS.has(c[1]);
const isRed = (c) => RED_SUITS.has(c[1]);

/* How the table scores each card:
 *   joker 50 · 2 (wild) 20 · ace 20 · 10 J Q K 10 · 4 through 9 all 5
 *   black three 5 · red three 100 (redThreeValue decides for or against). */
function cardValue(c, settings = DEFAULTS) {
  const r = rankOf(c);
  if (r === 'X') return 50;
  if (r === '2' || r === 'A') return 20;
  if (r === '3') return isRed(c) ? 100 : 5;
  if (settings.highEightNine && (r === '8' || r === '9')) return 10;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  return 5; // 4 5 6 7 8 9
}

function buildDeck(deckCount) {
  const cards = [];
  for (let d = 0; d < deckCount; d++) {
    for (const s of SUITS) for (const r of RANKS) cards.push(r + s + d);
    cards.push('XR' + d);
    cards.push('XB' + d);
  }
  return cards;
}

function shuffle(cards, rng = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- meld inspection ---------- */

function meldStats(meld, S) {
  const naturals = meld.cards.filter((c) => !isWild(c)).length;
  const wilds = meld.cards.filter((c) => isWild(c)).length;
  const size = meld.cards.length;
  const wildBook = meld.rank === 'W';
  return {
    naturals,
    wilds,
    size,
    complete: size >= S.bookSize,
    isRedBook: size >= S.bookSize && wilds === 0,
    isBlackBook: size >= S.bookSize && wilds > 0 && !wildBook,
    isWildBook: size >= S.bookSize && wildBook,
  };
}

/* Can these cards form / extend a meld of `rank`? Returns {ok, reason}. */
function checkMeld(rank, cards, S) {
  if (rank === '3') return { ok: false, reason: 'Threes cannot be melded.' };
  if (rank === 'W') {
    if (!S.allowWildBooks) return { ok: false, reason: 'Wild books are not allowed in this game.' };
    if (cards.some((c) => !isWild(c))) return { ok: false, reason: 'A wild book takes only wilds.' };
    return { ok: true };
  }
  for (const c of cards) {
    if (isWild(c)) continue;
    if (rankOf(c) !== rank) return { ok: false, reason: `${label(c)} is not a ${rankName(rank)}.` };
  }
  const naturals = cards.filter((c) => !isWild(c)).length;
  const wilds = cards.filter((c) => isWild(c)).length;
  if (cards.length < 3) return { ok: false, reason: 'A meld needs at least 3 cards.' };
  /* bookSize is when a pile *becomes* a book, not a ceiling on it. Once it is
   * closed you may keep adding to the same pile, or start a fresh book of the
   * same rank and earn a second bonus — both are legal, and which is worth more
   * is the player's problem, not the referee's. */
  if (S.closedBooksLocked && cards.length > S.bookSize) {
    return { ok: false, reason: `A book holds exactly ${S.bookSize} cards. Start a new book after it is complete.` };
  }
  const minNat = Math.max(S.minNaturalsInMeld || 2, wilds ? (S.minNaturalsWithWild || 2) : 0);
  if (naturals < minNat) return { ok: false, reason: `A meld needs at least ${minNat} natural cards.` };
  if (wilds > S.maxWildsInBook) return { ok: false, reason: `At most ${S.maxWildsInBook} wilds in a book.` };
  /* There is deliberately no additional naturals-outnumber-wilds rule. The
   * table's selected natural minimum and wild cap are the exact constraints. */
  return { ok: true };
}

function rankName(r) {
  return { T: '10', J: 'jack', Q: 'queen', K: 'king', A: 'ace', X: 'joker', W: 'wild' }[r] || r;
}
function label(c) {
  if (isJoker(c)) return (suitOf(c) === 'R' ? 'Red' : 'Black') + ' joker';
  const s = { S: '♠', H: '♥', D: '♦', C: '♣' }[suitOf(c)];
  return (rankOf(c) === 'T' ? '10' : rankOf(c)) + s;
}

module.exports = {
  RANKS, SUITS, DEFAULTS, RULE_RANGES, RULE_BOOLEANS, RULE_PRESETS, rulesForPreset, rulePresetId, deckCountFor, validateSettings,
  rankOf, suitOf, isJoker, isWild, isRedThree, isBlackThree, isRed,
  cardValue, buildDeck, shuffle, meldStats, checkMeld, rankName, label,
};
