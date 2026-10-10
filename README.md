# Hand & Foot 2.0

An update to Vic’s original Hand & Foot game, with clearer setup, configurable table rules, chat, computer opponents, and more reliable play controls. Scoring is individual, without partnerships. This version builds on Vic’s table design; both the original styles and the added styles have been edited.

Choose Card room, Midnight, Claret, Graphite, Mahogany, or Ivory. Card meanings remain consistent across themes. The illustrated cover is `handfoot-cover.svg`; `handfoot-mark.svg` is the favicon mark.

## Run locally

Use Node.js 24 to match the reference test runtime. `package.json` permits Node 18 or newer.

```bash
npm ci
npm test
npm start
```

Open [localhost:3000](http://localhost:3000). A private/incognito window uses a separate browser session and can join as another player. All application files belong in one directory. This is plain Node HTTP and WebSockets using `ws`; there is no build output or `public/` directory.

Opening `index.html` directly cannot run multiplayer; it displays server instructions. Over HTTP, `startup.js` loads the server-adapted engine, client, and menu in sequence. See [HANDOFF.md](HANDOFF.md) for integration and hosting.

## Create or join a table

Home offers **Play**, **Settings**, and **Rules**. Play leads directly to:

- **Create table**: choose 2–4 total players, including yourself. The default is 3. Share the table code or invite link, then deal after at least two players join. Unclaimed seats are removed at the deal.
- **Join table**: enter the table ID and your name. The host controls the rules.
- **Practice**: choose 1–3 computer opponents, defaulting to 2. Starting practice begins the deal without waiting for friends. Bots receive one of four hidden play styles, stable for that game and rerolled for a rematch.

Create and Practice each keep their own setup draft. House Rules is the default; selecting Real Rules replaces the complete rule configuration. Later edits show Customized rules. The setup summary shows decks, required red and black books, and discard pickup total.

**Customize rules** opens one inline editor with five groups: The deal, Melds & books, Draw & discard, Opening points, and Scoring & red threes. Controls use full-width rows, with opening points in a 2 × 2 grid. Changed values are marked and counted. **Done** closes the editor without discarding choices; **Reset to House Rules** explicitly restores the default. Invalid combinations stay in the form with feedback. Joining never changes the table rules.

The waiting lobby shows the invite, reserved seats, and **Table rules**. Leaving the lobby releases the reservation; an ordinary disconnection retains a resumable seat.

## Deal and play

Each new round begins with two private face-down packets. In Tap mode, tap the packet to keep as your foot; the other becomes your hand. In Buttons mode, select a packet and confirm **Select foot**. Custom rules with unequal hand and foot sizes retain their assigned packets and use **Continue**. Bots choose randomly. After everyone has chosen, a shared three-second countdown precedes play. Reconnecting retains your choice and the remaining countdown.

Opponents stay compact at the top, with public melds and hand/foot counts. Tap a player for a larger inspection view. Unplayed opponent cards stay hidden. **In foot** uses a contrasting plum pill across all themes. Your hand sits below your books; **Sort, Auto, Scores, Chat, Clear, Undo** share one continuous toolbar below the hand and action buttons. Clear and Undo stay visible but disabled when unavailable. A slim bordered header holds Round, minimum meld and the Settings gear. The changing instruction stays below the play buttons.

A draw chooser opens once at the start of a manual draw turn. Tap a stock in the center tray to reopen it. House Rules draws one card from each of two different nonempty piles where possible; Real Rules draws two from one stock. When discard pickup is legal, the chooser offers **View pile · N**. The inspection window requires a separate **Take pile** confirmation and automatically chooses the required matching naturals from your hand. Unrelated card selection does not prevent pickup. With preview off, only the public top discard is revealed.

**Settings → Interactions → Buttons** is the default for new players. An explicitly saved Tap preference is preserved. Select cards, then tap a highlighted legal book to add them. Both Tap and Buttons modes support that direct add; there is no separate Add-to-existing-book button. A short double-tap recognition window prevents the first tap of an expand/collapse gesture from playing cards. The turn, selection, target, connection, and legality are rechecked before sending.

For a new meld, Tap mode provides a **New meld** target in your book area. To discard in Tap mode, select one legal card and tap the discard pile. Buttons mode reserves a static action row below the hand for its explicit actions, including new meld and discard. Discarding a card that could be melded opens **Keep card / Discard anyway** confirmation in both modes.

Selection raises the individual card with a dark border; it does not resize books or shift surrounding rows. Newly received cards appear in a separate unlabelled row, ascending left to right. After landing, drawn cards lift and glow sky blue for four seconds, matching the meld cue duration; reduced motion uses a steady highlight. Sorting preserves the separation from the existing hand. **Sort** contains hand layout and card ordering. Scores open automatically once per completed round and remain available manually after dismissal.

## Auto, book display, and movement

**Auto** starts off. With four stocks, choose a fixed pair, the two largest, the two smallest, or Random. Random chooses distinct nonempty piles where possible. Auto pauses for a legal discard pickup, an unavailable configured pile, or an open dialog. The chooser explains the pause and lets you choose manually. One-stock play offers Auto On/Off. **Select matching ranks** inside Auto changes selection only; it never plays cards.

**Settings → Meld display** applies Cards/Tiles to both book shelves. Cards spreads unfinished melds by default; Tiles uses the compact stack renderer. **Finished books → Stacked / Spread** independently controls completed books. Double-tap a book to expand or collapse it. With a keyboard, Enter adds a legal selection; Shift+Enter changes display. Without a legal selection, Enter changes display. These are personal preferences, not table rules.

Completed natural book cards are fully red or black; melded jokers stay gold and deuces blue. Compact books show gold/blue wild edge trims, split when custom rules permit more wilds. Hand wilds keep cream faces with colored top and bottom bands. A meld one card short of completion has a sideways lead card. Counts sit beside books without repeated rank labels. Opponent melded points are in the expanded inspector and exclude book bonuses.

Card faces keep their dimensions when selecting cards or expanding books. Crowded book shelves can scroll rather than shrinking all cards. The interface accommodates short screens with bounded scrolling where necessary; device testing remains part of release acceptance.

Accepted Auto draws show their actual received cards in a 1.5-second reveal before settling into the hand. Manual draws go directly to the hand. Tap Continue, tap the reveal, or press Escape to dismiss early. **Settings → Card movement** and device Reduce Motion disable flights while retaining the brief readable Auto reveal. Chat and other open dialogs are not interrupted. Reconnects, undo, old history, and ambiguous replacements do not replay flights.

## Chat and personal settings

Chat opens a near-full-screen phone panel with player pills showing whose turn it is. Opening it does not focus the composer or summon a keyboard. Tap the composer for the larger in-app keyboard, use a physical keyboard, or explicitly choose **Device keyboard** for native input and dictation. Closing Chat retains an unsent draft. Incoming table updates do not replace the composer or steal its focus.

The server keeps the latest 100 chat messages in memory, with a 500-character limit and rate limiting. Reconnecting to the same running process restores that history; restarting the server clears it.

The shared dialog separates **Rules**, **Settings**, and **Appearance**. Rules shows the active configuration and host changes. Settings contains personal interaction, book-display, motion, and turn-notice preferences. Appearance contains card styles and table themes. Sort remains the home for hand layout and ordering.

## Configurable table rules

The current host controls rules. Valid waiting-lobby changes apply immediately. After dealing, changes are queued for the next round or rematch; everyone can see the active rules and pending configuration. Current hands, legal moves, and scores continue to use the active rules. Restoring all active values cancels pending changes.

The shared engine validates the whole configuration, including deal capacity and incompatible book settings. Unknown fields, invalid values, and insufficient decks are rejected atomically. The host editor queues all post-deal changes, including preview. The legacy host-only preview endpoint remains immediate for compatibility and also synchronizes any pending preview value.

| Adjustable rule | Accepted values |
|---|---|
| Decks | Automatic (players + 2), or 1–12 when the deal fits |
| Hand / foot size | 5–20 cards each |
| Stock arrangement | One stock or four piles |
| Red / black books required | 0–5 each |
| Total discard pickup | 1–20 including the top card; limited by actual pile size |
| Book completion size | 3–10 cards |
| Wilds per book | 0–4 |
| Minimum naturals | 2–3 generally; 2–4 when using wilds |
| Opening minimums | Four whole numbers, 0–500 each |
| Red-book / black-book / going-out bonuses | 0–2,000 each |
| Red-three points | −2,000 through 0 |
| Other switches | Locked completed books, final discard required, eights/nines worth 10, red-three layoff and bonuses, discard preview, one stock recycle |

Two-card draws, two matching naturals for discard pickup, no all-wild books, and individual scoring remain fixed. See [RULESETS.md](RULESETS.md) for both presets and the published baseline used for Real Rules.

House Rules defaults preserve the supplied game’s 11-card hand/foot, seven-card books, one red and one black book to go out, 500/300 book bonuses, 500 going-out bonus, and 50/90/120/150 opening minimums. The added default stock recycle occurs once per round: after a draw empties a stock pile, shuffle the remaining stocks and discard cards except the visible top into new stocks. The next exhaustion ends and scores the round. With recycling off, remaining stocks are used and the final successful draw receives its normal play/discard turn before scoring. Hands and melds are never mixed into recycled stock.

## Sessions and storage

The server owns all cards and legal moves. Human and bot views contain only the acting player's hand, public melds, and other players' card counts. Browser storage remembers the seat token for reconnecting while the table exists.

Game state is saved to `tables.json`, or the path in `SAVE_FILE`. Restoration requires that file to survive. Pending rules, packet choices, countdown, and the recycle counter are saved with the game. Older saves retain their cards, bot seats, and styles; tables larger than four players are not truncated. Missing new rule fields use defaults. Tables expire after 12 quiet hours.

Saves contain private cards and seat tokens. Exclude them from Git and shared archives. The custom save directory must exist and be writable. Saves are atomically replaced, with a short batched-write window and a shutdown flush; abrupt process loss can still lose the latest unsaved moves. An unwritable save path leaves games in memory only. Chat is not part of the save.

## Verification

`npm test` runs nine suites: startup, rules, server/WebSockets, bots, client UI, menu/setup, motion, presets, and chat. Run the full command after integrating or changing files. [VERIFICATION.md](VERIFICATION.md) records test and browser evidence; do not treat historical counts as results for a later edit.

The client suites use DOM doubles. They do not certify physical iPhone Safari, touch targets, the native keyboard, or hosted networking. No production deployment or Docker build is claimed by this README.

## Source map

| Files | Purpose |
|---|---|
| `engine.js`, `game.js` | Rules, configuration, authoritative turns, dealing, undo, recycling, and scoring |
| `server.js`, `bot.js` | HTTP/WebSockets, sessions, privacy, chat, persistence, and hidden computer styles |
| `index.html`, `app.js`, `startup.js` | Screen structure, interactions, and ordered browser startup |
| `menu.js`, `menu.css` | Cover, navigation, setup, and supporting dialog presentation |
| `style.css`, `enhancements.css` | Updated base styling and table controls |
| `play-feedback.css`, `interaction-feedback.css`, `interaction-mode.css`, `draw-feedback.css`, `chat-feedback.css` | Play, selection, draw, chat, and interaction presentation |
| `table-cosmetics.css`, `preferences.css`, `audit-refinements.css`, `deal-choice.css` | Table finish, preference screens, responsive refinements, and packet choice |
| `handfoot-cover.svg`, `handfoot-mark.svg`, `icons.js`, `manifest.webmanifest` | Cover art, favicon, generated app icons, and install metadata |
| `*.test.js` | Nine automated regression suites |
| `package.json`, `package-lock.json`, `Dockerfile` | Commands, locked dependency, and optional container recipe |


### Final v2 draw and undo update — October 10

The draw dialog gives one automatic invitation per turn. After closing it, choose stocks directly on the table. Buttons mode enables **Draw piles 1 & 3** (using the actual selections); its right-hand action is **View pile** during drawing, then Discard during play. Tap mode draws when the required valid stock selection is complete. Pile inspection still precedes any pickup.

Undo asks for confirmation when one selected card can legally be discarded, preventing a nearby mis-tap from resetting the turn. The warning explains that only this turn's melds/additions are reset, a normal draw stays, and a discard-pile pickup is reversed when applicable. Keep playing receives initial focus.

Undo also offers **Return [wild] from [rank]** for eligible jokers/twos added during the current turn. Returning one preserves all other plays. The authoritative server rejects earlier-turn cards, completed books, returns after a foot transition, invalid remaining melds (including fewer than three cards), and returns that would invalidate an opening committed by pickup. Full Undo remains available. This does not allow moving wilds out of books from earlier turns.
