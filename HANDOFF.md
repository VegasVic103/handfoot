# Hand & Foot 2.0 — integration handoff

Prepared October 9, 2026 for Vic’s existing game. This is the current application source, building on Vic’s original table design and the subsequent owner-directed playability and visual changes. Both base and enhancement styles are intentionally updated. Earlier redesign packages and iteration notes are not implementation instructions for this version.

This handoff does not claim a GitHub push, Render deployment, Docker build, or physical-iPhone acceptance. Final test and browser evidence belongs in [VERIFICATION.md](VERIFICATION.md).

## Current product behavior

The approved illustrated cover leads through **Play** directly to **Create table**, **Join table**, and **Practice**. New tables have 2–4 total players; Practice uses 1–3 bots. Each bot receives a hidden randomized style, stable through the game and rerolled for a rematch. No difficulty/personality/speed setting is exposed.

Create and Practice retain independent drafts. Each shows a preset and summary of decks, required red/black books, and total discard pickup. **Customize rules** expands a single surface containing The deal, Melds & books, Draw & discard, Opening points, and Scoring & red threes. Controls use full-width rows; the four opening minimums form a 2 × 2 grid. Changed values are marked and counted. **Done** closes customization while keeping the draft. Reset to House Rules is explicit. Preserve the shared validation and payload behavior when integrating this presentation.

House Rules is the fresh-setup default. Real Rules is a complete alternative preset, adapted to individual scoring; later edits become Customized rules. See [RULESETS.md](RULESETS.md). The current host alone can configure rules. Changes before the deal apply immediately; changes after the deal remain pending for the next round or rematch.

Start, next round, and rematch deal two private face-down packets. Tap mode chooses the foot directly; Buttons selects a packet then confirms **Select foot**. The other packet becomes the hand. Unequal custom hand/foot sizes retain their assigned packets and use Continue. Bots choose randomly. After all choices, a server-controlled three-second countdown precedes play. Reduced motion skips decorative dealing, not the choice or countdown.

Opponents stay compact at the top with public melds and counts; tapping a player opens inspection. Unplayed opponent hands and feet remain private. In-foot state uses contrasting plum pills across all themes. Sort/Auto/Scores/Chat/Clear/Undo share one continuous toolbar below your hand and action buttons; unavailable Clear/Undo remain visible and disabled. Round and minimum meld occupy a slim bordered header with Settings on the right. Changing instructions remain below the play buttons; no Your turn bar is shown. Selection raises an individual card with a dark border without resizing surrounding cards or books. Newly received cards are sorted ascending within a separate unlabelled row and receive a four-second sky-blue landing cue; reduced motion uses a steady highlight.

Buttons is the default on a fresh device; explicitly saved Tap preferences remain unchanged. Both Tap and Buttons modes add selected cards by single-tapping a legal highlighted book. No Add-to-existing-book button remains. The double-tap recognition delay lets double-tap expand/collapse without playing the first tap. Tap mode uses an inline New meld target and the discard pile itself; Buttons keeps a static action row below the hand. Both retain the warning before discarding a card with a legal meld opportunity.

The manual draw chooser opens once per draw turn and can be reopened from a stock. A legal discard pickup is offered as **View pile · N**; inspection then requires **Take pile** confirmation. Matching naturals are selected automatically, independent of unrelated hand selection. Preview-off tables reveal only the public top discard. Auto draws pause for legal pickup, unavailable configured stocks, or open dialogs. Routine Auto skips the chooser and shows accepted cards briefly; manual draws go directly to the hand.

Cards/Tiles applies to both shelves. Tiles uses the compact stack renderer; expanded cards retain fans. Completed-book Stacked/Spread is independently configurable. Double-tap overrides an individual book. Completed naturals remain red/black, jokers gold, and deuces blue. Hand wilds have cream faces with colored edge bands. Near-complete melds use a sideways lead card, and compact books retain wild edge trims. Expanded opponent details show melded points separately from book bonuses.

Chat uses a near-full-screen phone panel, larger in-app keys, and player pills showing the current turn. Opening Chat does not focus the composer or open a keyboard. Tapping the composer opens the in-app keyboard; physical typing and an explicit Device keyboard option remain available. Updates preserve input focus and drafts. Chat has a 500-character limit, rate limiting, and the latest 100 messages in process memory only.

Personal Settings, Appearance, Sort, book presentation, and motion preferences do not change table rules. All six themes retain semantic card colors. Keep the current style order from `index.html`; multiple stylesheet layers intentionally work together.

## Backend and compatibility contracts

Deploy the client, server, engine, game logic, and styles together. This is not a client-only skin that can safely run against the old server.

- The server validates every move and redacts each player's view. Bots plan from restricted views rather than private opponent hands. Do not move authoritative rule enforcement into the client.
- Views carry a persisted `turnId`; gameplay actions must carry the matching context. Stale, duplicate, unseated, and other-seat requests are rejected. Reconnect does not replay uncertain actions.
- `create` and `vsbot` accept a `rules` object validated with `E.validateSettings`. Arbitrary `settings` objects are ignored. Validation covers field types/ranges, capacity for all reserved seats, and incompatible book requirements. Rejections do not partially mutate the table.
- Host `configureRules` validates against pending/current settings. Lobby updates are immediate; later updates store a complete validated `game.pendingSettings` snapshot. `startRound` applies it only after a successful new deal. Returning all values to active settings clears the pending change.
- Public rule fields include `settings`, `pendingSettings`, `canConfigureRules`, `reshufflesUsed`, and `reshufflesRemaining`. Current host ownership is stored separately and transfers when the host explicitly leaves the lobby.
- The legacy `setRule` endpoint permits only the current host's preview toggle. It remains immediate for older clients and synchronizes the value into pending settings. Guests cannot change or cancel rules through either endpoint.
- `handChoice` is exposed only in the choosing phase. `chooseHand` carries the complementary hand packet, the acting player's own seat, and current turn ID. Unchosen packet contents remain hidden. Choices persist through reconnect/restart. Existing saves already playing do not acquire a new packet-choice phase.
- `roundBeginsAt` and `serverNow` synchronize the countdown; the server blocks gameplay and bots until it ends. The countdown bypass is test-only and requires both the test environment and its explicit override.
- The House Rules one-time recycle shuffles remaining stocks and discard cards except the visible top after a draw empties a stock pile. It never mixes hands or melds into stock. A later exhaustion ends the round; each new round resets the counter. With recycling off, the final successful stock draw receives its normal play/discard turn before scoring.
- Explicit lobby leave releases a reservation; ordinary disconnect preserves a resumable seat. Heartbeats expire dead sockets. Saved older bot tables and tables with more than four seats remain supported; only new-table setup is capped at four.
- Saves are atomically replaced and flushed on orderly shutdown. A short debounced write window remains vulnerable to abrupt process/host loss. Chat is deliberately not persisted.

The engine also retains fixes for hostile JSON coercion, rejected-action rollback, red-three replacement/undo/exhaustion, impossible rule combinations, legal winning pickup planning, and bounded bot candidates. Client guards cover legal targets, duplicate submissions, stale modal actions, focus/drafts, score-sheet reopening, and movement replay. Preserve the regression tests with their corresponding fixes.

## Files to integrate

Start from Vic’s current repository and compare this source with any newer owner work. Preserve unrelated changes and deployment configuration. Copy application files into the same directory as `package.json` and `server.js`; there is no `public/` or generated build directory.

Include:

- All application JavaScript: `server.js`, `engine.js`, `game.js`, `bot.js`, `icons.js`, `app.js`, `menu.js`, and `startup.js`.
- `index.html`, `manifest.webmanifest`, `handfoot-cover.svg`, and `handfoot-mark.svg`.
- Every stylesheet referenced by `index.html`: `style.css`, `enhancements.css`, `menu.css`, `play-feedback.css`, `interaction-feedback.css`, `interaction-mode.css`, `draw-feedback.css`, `chat-feedback.css`, `table-cosmetics.css`, `preferences.css`, `audit-refinements.css`, and `deal-choice.css`.
- All nine `*.test.js` files, `package.json`, `package-lock.json`, `.gitignore`, the optional `Dockerfile`, and the documentation.

App PNG icons are generated by `icons.js`; separate PNG files are not missing assets. The server serves an explicit public allowlist and adapts `engine.js` for the browser. `startup.js` loads engine → app → menu in order. If adding a browser asset later, update both the markup and server allowlist.

Exclude dependencies, `.env` files, private saves, test-state files, logs, local preview wrappers, screenshots, old archives, and operating-system metadata. Never overwrite or commit a production `tables.json` or custom `SAVE_FILE`. Local fixtures and the earlier approval checkpoint are not application assets.

Run `npm ci` and `npm test`, review the complete integrated diff, and then push the intended branch when authorized. A branch already linked to Render may deploy automatically. The existing supplied live URL is [handfoot.onrender.com](https://handfoot.onrender.com/); confirm the actual repository, branch, and service rather than inferring them from the URL.

## Runtime and Render settings

This is an HTTP/WebSocket **Node Web Service**, not a static site. Prefer the existing native Node service configuration. See [Render Web Services](https://render.com/docs/web-services).

| Setting | Value for this application |
|---|---|
| Runtime | Node |
| Root Directory | Empty when application files are at repository root; otherwise that application directory |
| Build Command | `npm ci` |
| Start Command | `node server.js` or `npm start` |
| Health Check Path | `/health` |
| Environment | `NODE_ENV=production` |
| Port | Use the supplied `PORT`; fallback is 3000 |
| Process/instance count | One; room state belongs to one in-memory server process |
| Node version | 24 is the reference test runtime; verify any other supported version with the same suite |

Expected startup log:

```text
Hand and Foot server listening on <port>
```

`/health` returns JSON containing `"ok": true` and the number of loaded tables. The server listens without a loopback-only host binding, and browser WebSockets use the current origin with `wss` under HTTPS.

The included Dockerfile is optional and has not been built as part of this handoff. Native Node settings above do not configure a Docker service. Review an existing Docker deployment separately. Build only from clean application source; there is no `.dockerignore` to exclude accidental local dependencies or private files. Its default `/app/tables.json` is ephemeral unless backed by durable storage. A volume at `/data` requires `SAVE_FILE=/data/tables.json`.

## Save-file continuity

The default save path is `tables.json` beside `server.js`. The app has no database or shared room store. Preserve an existing durable mount and its `SAVE_FILE` setting. For a durable directory mounted at `/var/data`, use:

```text
SAVE_FILE=/var/data/tables.json
```

The parent directory must already exist and be writable. Only the durable path protects saves across replacement instances; writing JSON to an ordinary ephemeral filesystem does not. See [Render persistent disks](https://render.com/docs/disks) and [Free-service limitations](https://render.com/docs/free) when checking the owner's service configuration. This package does not change the hosting plan or attach storage.

Back up the current save privately before deployment if active games matter. Keep tokens and cards intact. Missing new settings receive defaults; absent recycle counters begin at zero. Pending rules, packet choices, and countdown remain part of the saved game. Tables expire after 12 quiet hours. Restarting the server clears chat even when game saves survive.

## Validation and release limits

Run all nine suites from the final integrated application directory: startup, rules, server, bots, UI, menu, motion, presets, and chat. The reference runtime is Node v24.19.0. Use the exact lockfile dependency via `npm ci`. [VERIFICATION.md](VERIFICATION.md) is the evidence record; final release checks must reflect the files actually packaged.

Review the final browser build after the last layout edit. Check normal and crowded portrait hands, the 30-card/13-meld case, short landscape, both interaction modes, rule customization, packet choice/countdown, and the enlarged chat with its keyboard. Every hand card must remain reachable and controls must not cover it. Current portrait overflow work must be verified rather than assumed complete from an earlier screenshot.

Also check confirmed discard pickup and preview-off privacy; score-sheet dismissal across repeated snapshots; host/guest rule permissions and next-round application; first and later stock exhaustion; reconnect and saved-game recovery. After an authorized deployment, check `/health` and play from two independent sessions or devices.

DOM tests and desktop mobile viewports do not certify physical iPhone Safari, its native keyboard, touch accuracy, or production networking. Small card targets remain a known design tradeoff. No clean-install, Docker, device, or hosted-deployment result should be inferred unless the final evidence explicitly records it.


### Final v2 draw and undo update — October 10

The draw dialog gives one automatic invitation per turn. After closing it, choose stocks directly on the table. Buttons mode enables **Draw piles 1 & 3** (using the actual selections); its right-hand action is **View pile** during drawing, then Discard during play. Tap mode draws when the required valid stock selection is complete. Pile inspection still precedes any pickup.

Undo asks for confirmation when one selected card can legally be discarded, preventing a nearby mis-tap from resetting the turn. The warning explains that only this turn's melds/additions are reset, a normal draw stays, and a discard-pile pickup is reversed when applicable. Keep playing receives initial focus.

Undo also offers **Return [wild] from [rank]** for eligible jokers/twos added during the current turn. Returning one preserves all other plays. The authoritative server rejects earlier-turn cards, completed books, returns after a foot transition, invalid remaining melds (including fewer than three cards), and returns that would invalidate an opening committed by pickup. Full Undo remains available. This does not allow moving wilds out of books from earlier turns.
