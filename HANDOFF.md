# Original-design integration handoff

Updated October 9, 2026. This is the complete Hand & Foot 2.0 application source, prepared for integration into Vic’s existing game. It has not been pushed to GitHub or deployed to Render.

## Baseline and scope

This package contains the latest accepted version of the separate optimization copy. Use Vic’s current repository as the integration baseline, preserving any newer unrelated work. Keep the established table structure and meld presentation. The five dark themes have refreshed colors, and Ivory provides a light option. `style.css` remains byte-identical to the archive; `enhancements.css` adds support for the new controls and table features. The separate Emerald/casino redesign and its earlier handoff are not the design instructions for this package.

The engine includes validated rule configuration and two complete presets: House Rules (default) and Real Rules (Bicycle-based, adapted to individual scoring). See RULESETS.md for exact behavior, differences and app conventions. The original scoring and deal defaults are retained, with one explicit new default: when a stock pile first empties after a draw, recycle the remaining stocks and discard cards except the visible top card into four piles. This can happen once per round; the next exhaustion ends and scores the round. Never replace the new engine with the earlier archive’s engine while keeping these server/client changes.

This integration keeps the new Play/Friends/Computer setup, four-player cap, hidden randomized bot styles, live chat, reconnect and undo fixes, public opponent inspection, book colors, card-count and point summaries, selection controls, Auto, confirmed discard pickup, guarded double-tap adds, and once-per-round score presentation. The server still owns the cards and legal moves.

Latest interaction details: **Settings → Meld display** applies Cards/Tiles to both shelves (`hf_meld_style`, with legacy fallback). **Finished books → Stacked/Spread** stays available in both views and independently controls completed books. Individual book taps override their default, while legal selected-card targets retain Add/double-tap behavior. Both shelves use quiet side counts and a sideways lead card when one short. Completed naturals are red/black; public wilds gold/blue; collapsed books show wild edge trims. Your cards use stable dimensions and natural-width wrapping. The piles sit between opponents and one shared Your cards header with points/counts and Sort/Auto. The opening minimum stays beside Round; the lower activity line is hidden. See VERIFICATION.md for the current checks.

## Latest additions

- New scalable H/F red/black book logo on the cover; Play, Settings and Rules remain the home actions.
- Six themes, including Ivory; semantic card colors and table geometry remain consistent.
- Accepted own-card draw, meld, discard and pickup animations. Device Reduce Motion is respected; Settings has an Off option.
- Random Auto draws from two distinct nonempty piles and pauses for legal pickup. One-stock Real Rules uses Auto On/Off.
- Chat is immediately left of Sort during play and remains reachable in the waiting-room header.
- Named presets replace all values before a deal; later edits appear as Customized rules. Differences from House Rules are expandable, and supported gameplay capabilities are adjustable.

## Host rule configuration

Both **Start a game** and **Vs computer** show editable rules before creating the table or dealing: decks, required red/black books, and total discard pickup appear first, with **More rules** expanding the remaining controls inline. **Settings → Rules** provides the host’s later changes and exposes deck count, hand/foot sizes, red/black books required, total discard pickup, book size, natural/wild limits, opening minimums, scoring bonuses, red-three handling, preview, and stock recycling. See README for allowed ranges.

- Only the original host token can use the grouped `configureRules` action. Lobby changes apply immediately; post-deal structural/scoring changes remain in `game.pendingSettings` until a successful next-round deal or rematch.
- Each player receives current public `settings`, `pendingSettings` or null, `canConfigureRules`, `reshufflesUsed`, and `reshufflesRemaining`. Private cards and tokens are not added to those fields.
- The server uses the shared `engine.validateSettings` whitelist and validates capacity before accepting any patch. New `create`/`vsbot` messages can include a validated `rules` object. Arbitrary `settings` objects are still ignored.
- The new host editor queues all post-deal edits, including preview. The legacy seated-player `setRule` preview-only message remains immediate for compatibility and synchronizes its value into pending settings. A joining client cannot replace the table’s rules.
- Deploy client, server, engine, and turn logic together. Pending settings and recycle counters are part of the saved game and survive a restart when its save survives.

The existing live URL supplied for the project is [handfoot.onrender.com](https://handfoot.onrender.com/). Confirm the actual repository, branch, and Render service before applying the source. Remote contents and deployment access were not verified during this packaging task.

## Integrate with GitHub

1. Start from the owner’s current repository and compare this package with any newer work. Preserve production configuration and unrelated changes.
2. Copy the application files into the repository’s application root, alongside `package.json` and `server.js`. If that is the repository root, there is no nested root directory to configure.
3. Include the JavaScript, HTML, CSS, manifest, icons source, tests, lockfile, and documentation. Keep `.gitignore`.
4. Exclude `node_modules`, `.env` files, private saves, test-state files, logs, and prior archives. Do not overwrite or commit a production `tables.json` or custom `SAVE_FILE`.
5. Run `npm ci` and `npm test`, then review the diff before pushing the intended branch. Updating a branch already linked to Render may trigger an automatic deployment.

There is no `public/` directory in this application. The server serves an explicit allowlist from the same folder. The earlier Blackjack deployment guide is useful for general dashboard navigation only: its file layout, framework, and log messages do not describe this game.

## Render configuration

Use the existing **Node Web Service** where possible. This is a running HTTP/WebSocket app, so a Static Site cannot host it. Render supports WebSockets and takes its build/start settings from the selected service and deployment branch. [Render Web Services](https://render.com/docs/web-services)

| Field | Value for this source |
|---|---|
| Runtime | Node |
| Root Directory | Empty when the application files are at repository root |
| Build Command | `npm ci` |
| Start Command | `node server.js` |
| Health Check Path | `/health` |
| Environment | `NODE_ENV=production` |
| Port | Use Render’s supplied `PORT`; this server already reads it |
| Instance count | One; table state belongs to one server process |
| Node version | 24 was tested; verify any different runtime with the same test suite |

The included original Dockerfile is optional and was not built here. Select the native Node runtime for the commands above. If retaining an existing Docker-based service, review its Docker configuration separately instead of assuming the native settings apply. Its default `/app/tables.json` is ephemeral; a volume mounted at `/data` also requires `SAVE_FILE=/data/tables.json`, regardless of the older Dockerfile comment.

Expected startup log:

```text
Hand and Foot server listening on <port>
```

`/health` returns JSON containing `"ok": true` and the number of loaded tables. The local fallback port is 3000; no hardcoded production port is required.

## Save-file continuity

The default save path is `tables.json` beside `server.js`. A save can restore a table only if its file remains available. The app does not use a database or shared room store.

Render’s ordinary filesystem is ephemeral: redeploys, restarts, and Free-service spin-downs can remove locally written saves. Free services cannot attach persistent disks. Do not promise game continuity merely because the server writes JSON. [Render Free limitations](https://render.com/docs/free)

Preserve an existing durable mount and its `SAVE_FILE` setting. If the owner chooses a paid persistent disk mounted at `/var/data`, set:

```text
SAVE_FILE=/var/data/tables.json
```

Only files beneath the disk mount persist; the directory must exist and be writable. Attaching a disk is a separate hosting change, not something this package performs. [Render persistent disks](https://render.com/docs/disks)

Back up the current save privately before a deployment if active games matter. Keep its original contents, tokens, and cards intact. Older bot saves and tables with more than four seats are compatible; only new setup is capped. Missing new settings use the defaults, and an absent recycle counter starts at zero. Queued rule changes remain queued when an active round reloads. The save writer batches changes, so an abrupt termination can lose recently unsaved moves. Chat is deliberately memory-only and clears on restart even when game saves persist.

## Verification and remaining release checks

Run `npm test` on the final integrated source. The reference runtime is Node **v24.19.0**. The seven suites cover rules and game simulations, real WebSocket/server behavior, computer styles, client assertions, pre-game setup controls/payloads, card motion, and rule presets. New coverage includes rule validation, host authorization, atomic rejection, pending-rule persistence and next-round application, first/second stock exhaustion, and stable book layout while selecting cards. Existing privacy, chat, reconnect, original-theme, and saved-table cases remain. The client suite uses a DOM test double; final browser validation belongs with the final integrated files.

Final backend verification:

| Suite | Result |
|---|---|
| Rules | 117 checks passed, 0 failed; 1,200 simulated rounds |
| Server/WebSocket integration | 172 assertions passed, 0 failed |
| Bots | 100 checks passed, 0 failed; 620 complete four-round games |
| Rule presets | 17 checks passed; 96 additional complete matches |
| Card motion | 15 checks passed |

The bot total comprises 300 baseline games, 160 style-specific games, and 160 custom-rule games. These results do not replace running the complete suite after any further integration changes.

Before calling the hosted integration ready:

- Run all seven suites from the final application root.
- Check a normal four-player game on desktop and mobile, then a separate 30-card/13-meld stress case. Confirm every card remains accessible and no controls obscure the hand.
- On physical iPhone Safari, verify single/double taps, selection, Auto, modal dismissal, the software keyboard with Chat, and reconnect behavior. Desktop viewport checks do not certify physical iOS behavior.
- Confirm that taking a pile requires modal confirmation, uses only the required naturals, and never reveals hidden discard cards when the preview rule is off.
- Confirm that a dismissed score sheet stays closed for the same completed round, while the next round can open it once.
- Change rules as host in the lobby and during play. Confirm non-host rejection, shared pending-state visibility, current-round stability, saved pending choices, and application on the next deal.
- Empty a stock pile twice in one round: the first recycle keeps the top discard and all private hands/melds intact; the second ends and scores the round. A new round restores its one available recycle.
- After an authorized deployment, check `/health` and play from two independent browser sessions or devices; verify joining, chat, drawing, melding, scoring, and resuming.

No production deployment, physical-device acceptance, or Docker validation is claimed by this handoff. Keep newer owner feedback and the original-design baseline as the source of truth for further visual changes.


## Isolated optimization preview

This source was developed separately from `outputs/handfoot-vic`; that main copy was not modified. Local review servers and disposable fixtures are excluded from this release. Use `npm start` from this package’s application folder for a normal local launch on port 3000. Do not copy local test saves into a deployment.

Deploy this client and server together: views now carry a persisted `turnId`, and gameplay actions require that ID. Explicit lobby `leave` releases a reservation and transfers host ownership; ordinary disconnection retains a resumable seat. Saves are atomically replaced and flushed on orderly shutdown, but abrupt process/host loss can still lose the short debounced write window. Heartbeats expire missing peers and the client reconnects without replaying uncertain actions.

Audit corrections cover final no-recycle turns, red-three replacement/undo/exhaustion, impossible book settings, legal winning pickup planning, bounded bot candidates, stable hand/book nodes, fresh-highlight expiry, focus, raw rules drafts, native join-code case handling, and pointer-specific popup dismissal. Short screens that would clip the hand use a scroll fallback in the existing board.

Latest visual decisions: cream hand wilds have strong gold/blue bands on both edges; meld wilds are fully colored. Own completed books use one colored stack and short rank/count captions, retaining wild edge counts and existing Add/double-tap behavior. Unfinished melds keep their fan.


## October 9 display refinement (supersedes earlier visual descriptions)

Meld display is shared across both shelves. Cards/Tiles is personal, with independent Stacked/Spread completed-book defaults in both views; per-book taps expand/collapse, except a legal selected-card destination retains Add/double-tap precedence. Own card size no longer adapts to shelf height or how many books are expanded. The shelf scrolls when needed. Compact opponent rows show counts beside names, and melded points only in the expanded player inspector. One-away opponent melds use a sideways lead card, not a colored count circle. Rules and Settings have a reorganized scrollable dialog. See VERIFICATION.md for detailed checks and remaining limitations.


Latest cover/menu pass: inline SVG H/F card mark (portable source in `handfoot-mark.svg`), a primary Play button, quiet Settings/Rules links, compact secondary-page branding, visible setup rules and grouped advanced rules. Friends hosting/joining and practice keep the existing payloads. Waiting rooms show an invite and numbered seats without empty game panels. Local-only review wrappers and saves remain under `work/` and are not distributable assets.
