# Hand & Foot 2.0

An update to Vic’s original Hand & Foot game: the original table design, with clearer setup, adjustable table rules, chat, computer opponents, and more reliable play controls. Scoring is individual, without partnerships.

This package preserves the original `style.css`, with added controls in `enhancements.css` and refreshed theme colors in `menu.css`. Choose Card room, Midnight, Claret, Graphite, Mahogany, or the light Ivory theme. Theme changes preserve table geometry and card meanings. The cover uses the custom scalable `handfoot-mark.svg` identity.

## Run locally

Use Node.js 24 for the version tested with this package. `package.json` permits Node 18 or newer.

```bash
npm ci
npm test
node server.js
```

Open [localhost:3000](http://localhost:3000). `npm start` runs the same server command. A private/incognito window uses a separate browser session and can join as a second player.

All application files belong in one directory. This is plain Node HTTP and WebSockets using `ws`; there is no build output or `public/` folder to create. See [HANDOFF.md](HANDOFF.md) for GitHub and Render integration.

## Playing

- Home offers **Play**, **Settings**, and **Rules**.
- **Play → Vs friends → Start a game** creates a lobby for 2–4 total players, defaulting to 3. Share the table code or invite link, then deal. Unclaimed seats are dropped at the deal.
- **Play → Vs friends → Join a table** takes a table ID and your name.
- **Play → Vs computer** is the practice table: choose 1–3 computer opponents, defaulting to 2, and deal immediately. Each bot receives one of four hidden play styles. Styles are stable during a game and rerolled for a rematch.
- Both creation screens include editable rules before the first deal: decks, required red/black books, and discard pickup total are visible, with the remaining controls under **More rules**. **Settings → Rules** lets the host adjust rules during play for the next round. Personal card style, table color, shared meld presentation, hand arrangement, sorting, and turn reminders remain separate browser preferences.

House Rules is selected for every fresh setup. Selecting **Real Rules** replaces all rule values; later edits show **Customized rules**. The expandable **Different from House Rules** list flags changed mechanics and values. Both modes use individual scoring. See [RULESETS.md](RULESETS.md) for the published reference and app conventions.

Under House Rules, select two different stock piles and press **Draw 2**. Real Rules draws both cards from one stock. Alternatively, open the discard pile and confirm **Take pile**; matching natural cards are chosen from your hand automatically. Opening the window never commits a pickup.

Select cards to play a new meld. For an existing book, one tap chooses the destination for the Add action; a second tap within 400ms adds the same selected cards directly. The turn, selection, target, and legality are rechecked. Finish a normal turn by selecting a card and discarding it. The footer shows actions that apply to the current play.

**Auto** is off initially. It can draw from a chosen pair, the two largest remaining piles, the two smallest, or **Random** (two distinct nonempty piles chosen uniformly). It pauses for a legal discard-pile pickup or an unavailable chosen pile. A single remaining pile supplies both cards. Real Rules shows a simple Auto On/Off option. **Select matching ranks** inside Auto changes card selection only; it does not play cards.

Opponents remain compact above the table. Their melds are public; tapping a player opens a larger inspection view. Their unplayed hand and foot remain hidden. Your hand stays below your books. Melded-point totals count face-up cards and exclude book bonuses.

Completed natural book cards become fully red or black. Jokers remain gold and deuces blue. **Chat**, immediately left of Sort during play, sends messages to the current table. Chat stays in the header while waiting in a lobby. Scores open automatically once when a round finishes and can also be opened manually.

Selecting cards or opening more books never shrinks the other card faces. **Settings → Meld display** applies **Cards** or **Tiles** to both your books and opponents. Cards defaults to spread unfinished melds and stacked completed books; **Finished books → Stacked / Spread** changes that default. Tiles compacts unfinished melds; Finished books remains visible and independently controls completed books in both views. Tap any meld to expand or collapse its public cards. When legal hand cards are selected, tapping your destination book still chooses Add; double-tapping still adds directly. Display preferences are personal and never change the game rules.

Completed books use red/black faces and short rank/count captions. Wild counts appear as gold/blue top/bottom trims on compact stacks and tiles, with split edges when custom rules allow three/four wilds. Hand wilds have cream faces and gold/blue bands; spread meld wilds have full gold/blue faces. All melds one card short of a book show a sideways leading face (or landscape tile), with an ordinary quiet side count. Both shelves identify rank on the card face, without repeating it in a caption. The active opponent uses only a thin gold outline around the whole panel, with no turn pill or name accent; your turn is shown beside Your cards instead of in the top navigation.

Opponent hand/foot counts sit beside the name. Melded points remain in expanded player details; your own points remain in the shared Your cards toolbar. On crowded screens the book shelf scrolls without reducing card size. Rules and Settings use a bounded scrollable dialog with a sticky Close/header, grouped controls, and expandable rule explanations. Newly drawn cards use a single muted mint outline; selection stays gold.

Accepted draws, melds, discards and pile pickups animate between their source and destination for your own seat. Movement never delays the rules engine or controls. **Settings → Card movement** turns it off; device Reduce Motion is respected. Reconnects, undo, old history and ambiguous automatic replacements do not replay card flights.

## Configurable table rules

The original host controls structural and scoring rules. In a waiting lobby, valid changes apply immediately. After the deal, changes are saved for the next round or rematch; everyone sees both the active rules and the pending configuration. Current hands, books, legal moves, and scores keep using the active rules until that round ends. Updating the pending configuration preserves earlier queued choices, and restoring all active values cancels the pending changes.

The server validates each configuration together, including enough cards for every reserved seat, the deal, a starting discard, and the selected stock arrangement. Invalid fields, unsupported rule names, and insufficient decks are rejected without partially changing the table. Joining a table cannot overwrite the host’s rules. The host editor queues all post-deal changes, including preview. For compatibility with older clients, their existing preview-only request still applies immediately and synchronizes any pending preview value.

| Adjustable rule | Accepted values |
|---|---|
| Decks | Automatic (players + 2), or 1–12 decks when the deal fits |
| Hand / foot size | 5–20 cards each |
| Red / black books required to go out | 0–5 each |
| Total discard pickup | 1–20 cards including the top card; limited by actual pile size |
| Book completion size | 3–10 cards |
| Wilds per book | 0–4 |
| Minimum natural cards in a meld | 2–3 |
| Opening minimums | Four whole numbers, 0–500 each |
| Red-book / black-book / going-out bonuses | 0–2,000 each |
| Red-three penalty | −2,000 through 0 |
| Red-three handling | Keep in hand, or lay off automatically with replacements |
| Discard preview | On / Off |
| Stock recycle | Once per round / Off |

Stock arrangement is one stock or four piles. Two-card draws, two matching naturals for discard pickup, and no all-wild books remain fixed. Additional adjustable mechanics include locked completed books, minimum naturals with wilds (2–4), eights/nines worth 10 points, laid red-three bonuses, and a required final discard. Rule controls never change individual scoring into partnerships.

## House Rules (default)

| Rule | Setting |
|---|---|
| Decks | Number of players + 2 |
| Deal | 11 cards in hand and 11 in foot |
| Stock | Four piles; draw two cards from distinct nonempty piles when possible |
| Last stock pile | Both cards may come from it |
| Stock recycle | When any stock pile reaches zero after a draw, shuffle the remaining stocks and discard cards except the visible top card; redeal four piles once per round. The next exhaustion ends and scores the round. |
| Discard pickup | Two matching naturals from your hand; take the top card plus up to six behind it |
| Opening minimum | 50 / 90 / 120 / 150 across four rounds, accumulated over the turn |
| Book | Seven cards closes it; additional cards remain allowed |
| Red book | All naturals; 500-point bonus |
| Black book | Contains wilds; 300-point bonus |
| Melds and wilds | At least two naturals; at most two wilds; threes never meld |
| Additional book of a rank | Allowed after the previous book closes |
| Completed red books | Cannot accept wilds |
| Red threes | Stay in hand; discard normally; each remaining red three costs 100 at round end |
| Frozen discard | Any three or wild on top prevents pickup |
| Going out | In your foot with at least one red and one black book; meld every remaining card, without a final discard; 500-point bonus |

The original README said the going-out bonus was 100. The actual default is **500**. Apart from the requested stock-recycle rule, the listed defaults retain the supplied game’s rules. A pickup may contribute less than the opening minimum, but you must reach the minimum before ending that turn or undo the pickup. A recycle preserves every hand and meld and keeps the visible discard top in place; it never exposes shuffled card identities. With recycling disabled, play continues while any stock remains. The final successful stock draw gets its normal play/discard turn, then the round ends before another player receives an empty-stock turn.

## Sessions and storage

The server validates moves and sends each player only their own hand, public melds, and opponent card counts. A bot receives the same restricted view as a human. Browser storage remembers your seat token; reconnecting with the same session can resume that seat while the table exists.

Game state is saved to `tables.json`, or the path in `SAVE_FILE`. Restarts can restore games only when that file survives. Pending rule choices and the current round’s recycle count are saved with the game. Older saves retain their bot seats and private styles, and existing tables larger than four players are not truncated. Missing new rule fields use their defaults. New-table setup is capped at four. Tables expire after 12 quiet hours.

Saves contain private cards and seat tokens. Keep them out of Git and shared archives. Writes are batched, so an abrupt process failure can lose the latest unsaved moves. The parent directory of a custom save path must already exist and be writable; an unwritable save path leaves games in memory only.

Chat keeps the latest 100 messages in server memory, with a 500-character message limit and rate limiting. Reconnecting to the same running server restores that history. A server restart clears it.

## Verification

Run all seven suites after integrating changes:

- `rules.test.js`: rule validation, authoritative turns, rollback, stock recycling, and game simulations.
- `server.test.js`: real WebSocket play, host permissions, atomic rule changes, next-round configuration, privacy, chat, reconnects, and save restoration.
- `bot.test.js`: legal play for the four hidden styles and complete-game simulations.
- `ui.test.js`: client legality, original themes, personal opponent presentation, stable book layout during selection, action guards, Auto, confirmed pickups, privacy, and score-sheet behavior.
- `menu.test.js`: pre-game rule controls, shared validation, create/practice payloads, and independent setup drafts.

`motion.test.js` checks accepted card routes and cancellation safety; `presets.test.js` checks both rulesets and simulates complete matches. `npm test` runs all seven suites. The client suite uses a DOM test double; it does not replace visual or touch testing on real devices. Physical iPhone Safari, a hosted deployment, and the supplied Dockerfile have not been verified by these automated tests.

Final backend results on Node **v24.19.0**:

| Suite | Result |
|---|---|
| Rules | 117 checks passed, including 1,200 simulated rounds |
| Server/WebSocket integration | 172 assertions passed, 0 failed |
| Bots | 100 checks passed, 0 failed, including 620 complete four-round games |
| Rule presets | 17 checks passed, including 96 additional complete matches |
| Card motion | 15 checks passed |

Bot simulations include 300 baseline games, 160 style-specific games, and 160 games with custom rules. Re-run the complete command after any further integration changes.

## Source map

| File | Purpose |
|---|---|
| `engine.js` | Card values, meld validation, rule defaults, and configuration validation |
| `game.js` | Authoritative turns, stock recycling, next-round rules, foot pickup, undo, and scoring |
| `server.js` | HTTP, WebSockets, table sessions, chat, privacy, and saves |
| `bot.js` | Four private computer play styles |
| `index.html`, `app.js` | Game screens and client interactions |
| `menu.js`, `menu.css` | Setup navigation and supporting dialog presentation |
| `style.css` | Original game styling |
| `enhancements.css` | Compatibility styling for the added controls and table features |
| `*.test.js` | Rules, server, bot, and client regression suites |
| `package.json`, `package-lock.json` | Version 2.0.0, dependency lock, and commands |
| `Dockerfile` | Original optional container recipe; not required for native Node hosting |
