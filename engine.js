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
};

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
function cardValue(c) {
  const r = rankOf(c);
  if (r === 'X') return 50;
  if (r === '2' || r === 'A') return 20;
  if (r === '3') return isRed(c) ? 100 : 5;
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
  const minNat = S.minNaturalsInMeld || 2;
  if (naturals < minNat) return { ok: false, reason: `A meld needs at least ${minNat} natural cards.` };
  if (wilds > S.maxWildsInBook) return { ok: false, reason: `At most ${S.maxWildsInBook} wilds in a book.` };
  /* There is deliberately no naturals-outnumber-wilds rule: with the wild cap
   * and the minimum naturals above, the real cards can never fall behind. */
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
  RANKS, SUITS, DEFAULTS,
  rankOf, suitOf, isJoker, isWild, isRedThree, isBlackThree, isRed,
  cardValue, buildDeck, shuffle, meldStats, checkMeld, rankName, label,
};
