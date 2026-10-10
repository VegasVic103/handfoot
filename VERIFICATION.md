# Duplicate verification record

## Final v2 r2 — direct draw, reset confirmation, selective wild return

All nine suites passed on the revised source: rules128, server278, bots100, UI, menu, motion34, presets17/96 games, chat15 and startup. New tests cover partial wild return, replay, turn authority, owner-only options, minimum-size/completed/older-turn restrictions, foot transitions and committed-opening legality. UI checks cover table-stock selection without reopening, selected stock labels, guarded reset, cancel, duplicate confirmation and stale context. Browser flow on isolated port3231: close invitation → select stocks1&3 → Draw piles1&3 increases hand16→18; meld joker into7s → Undo → Return Red joker restores18 cards and the original three-card7 meld; selecting a discardable jack then Undo opens the reset warning. The normal user game on3230 was not reset. Physical iPhone and Render deploy remain untested. Earlier frozen v2 and audit ZIPs remain unchanged; r2 supersedes them for delivery.


## Frozen v2 for Vic — October 10, 2026

Final order: hand → Draw/New meld and Discard → Sort/Auto/Scores/Chat/Clear/Undo → instruction. The two action buttons share y706 and44px height in the390×844 browser check. Utilities occupy758–804px. All nine existing suites passed on the final source using Node24.19.0 and the locally installed locked ws dependency via NODE_PATH. This is not a fresh npm-ci, Docker, Render or physical-iPhone verification. Claude consolidated audit patches and design proposals were NOT applied. Future work belongs to the separate v3 copy.


October 9, 2026. All 24 original files in `outputs/handfoot-vic` still match their SHA-256 baseline. Changes are in this separate duplicate only.

## October 10: crowded portrait fit and narrower hand — latest

- Working-copy revision AFTER the Claude audit ZIP: utility rail moved below the hand and above play buttons. The existing audit ZIP is deliberately unchanged. UI regressions passed. At390×844 dense: rail706–752px, buttons760–804px, footer812–838px; the observed hand content fits its viewport. No card or opponent sizes changed. Layout budgeting now includes the below-hand rail; spare vertical space remains above the hand. Screenshot: `../fit-fix-2026-10-10/toolbar-below-hand.png`.

- Latest header/toolbar revision supersedes the control placement below: Round/minimum/Settings restored in a45px bordered header (44px gear target); Scores remains in the lower continuous six-control rail. Clear/Undo remain disabled when unavailable, rather than leaving empty slots. Instruction-only footer is26px. UI and menu suites pass. Browser verified Settings opens and the390×844 dense hand has equal client/scroll height; action buttons remain760–804px and footer812–838px. Screenshot: `../fit-fix-2026-10-10/slim-top-bar.png`.

- Subsequent control relocation supersedes the earlier toolbar arrangement: Settings/Sort/Auto/Scores/Chat/Clear/Undo now share one44px row above the hand. Playing-table header removed; round, minimum meld and instructions occupy a44px footer below the play buttons. No gold Your turn bar or instruction pill remains. At390×844 dense, all16 hand cards fit (149px client/scroll), the meld shelf is145px client/scroll, action buttons are at742–786px and footer794–838px. Selection preserves those coordinates. A real local-fixture meld and Undo succeeded and restored all16 cards. Screenshot: `../fit-fix-2026-10-10/final-control-row.png`.
- The Just drawn caption is removed. Accepted draw arrivals receive sky-blue lift/glow only after landing, using the same4000ms duration as meld feedback. Reduced motion is steady; duplicate snapshots do not replay it; leaving the table cancels it. All34 motion checks and UI/menu suites passed after these changes.
- At320×700 dense, the footer and action buttons remain visible, while hand and meld shelves scroll internally. This remains a reachability fallback, not a no-scroll claim for very small screens.
- At390×844, the reported live game with three opponents, seven own melds and13 hand cards now fits without internal scrolling. Before narrowing the hand, own shelf client/scroll height was145/145px and hand147/147px; all seven melds were visible. Crowded public panels reclaimed48px from wrapper spacing without shrinking their card faces.
- Crowded portrait piles now use29×38px artwork in a48px tray with44px-high hit areas. This fixes the prior50px tray retaining46px artwork and clipping the discard stack shadow. Normal-room tray and popup dimensions remain unchanged.
- Spread-hand faces are34px wide instead of38.72px, with unchanged height and rank text. A typical390px phone fits nine per row. Transparent hit margins preserve the prior regular-card tap width; the browser confirmed a hit outside the painted face resolves to that card. Dense hands retain their existing ten-column limit.
- Browser selection retained identical shelf, hand and button-row geometry; selected cards still lift7px. UI regressions passed, including20 cards fitting a separate arrivals row plus two settled rows. All33 motion/draw-reveal checks passed after the latest sizing changes. Screenshot: `../fit-fix-2026-10-10/narrow-hand-preview.png`.
- Related pre-release work: Buttons is the fresh-install default, explicit saved Tap remains respected; the rule customizer has five direct groups; chat is near fullscreen with a larger keyboard and live turn pills; In foot uses a contrasting plum pill. Menu and15 chat checks passed after their respective edits.
- This is desktop browser verification, not physical iPhone testing. Extreme meld counts, large pickups, and short landscape can still require scrolling; the exact reported portrait state is verified, not a universal no-scroll guarantee. No ZIP or production deployment was created in this pass.

## October 9 evening: deal choice, countdown and table controls

This section supersedes earlier interaction, color and layout descriptions below.

- All nine suites passed together: startup; rules122; server278; bots100; UI; menu; motion33; presets17 including96 complete four-round matches; chat12. The full log is outside the app at `../cosmetic-refresh-2026-10-09/final-suite-results.txt`. UI also passed after the final View pile wording check.
- Round start now offers two face-down packets. Tap chooses the foot immediately; Buttons requires Select foot. Server tests cover private unchosen cards, seat authorization, stale/duplicate choices, reconnect/save recovery, bots and unequal custom packet sizes. A production-mode test checks the real three-second server gate after everyone chooses; test-only shortcuts require both test environment and an explicit override.
- Browser checks exercised both interaction modes, persisted waiting choices, the complementary hand/foot choice and the 3–2–1 countdown in the existing own-meld shelf. Draw controls resume after the countdown. An actual Practice game with three bots reaches the chooser. Screenshots include `choose-foot-final-390.png` and `round-countdown-390.png` in the evidence folder above.
- The status/Undo/Clear/Chat/Sort/Auto toolbar is above the hand. Buttons mode keeps a static action row below it. Selected cards rise7px with dark trim and no checkmark. At390×844 dense, toolbar y583.92/h49, hand y636.92/h149.08 and buttons y794/h44 remain unchanged on selection. At320×700 stress, all30 hand cards fit the167px hand region; the visible60.25px own-meld shelf scrolls its197px content.
- Landscape verification caught and fixed an overlap introduced by the relocated49px toolbar. The short-landscape own section now reserves its added height: hand bottom381.34, action row top385.34,50px visible own shelf and77px scrollable hand with187px content. The board scrolls33px. This deliberately preserves reachable cards rather than claiming a no-scroll landscape layout.
- The draw popup shows blue **View pile · N** only when pickup is legal. It opens the discard preview without sending a pickup action; **Take pile** remains the final confirmation there. The UI regression covers this distinction. Screenshot `view-pile-blue.png` records the final blue styling.
- Simplified Play/Create/Practice/Join flows were checked at390×844 and320×568. The short-screen form scrolls while its submission button stays visible. Actual Create, waiting lobby and Leave were exercised. Programmatic heading focus does not add a decorative outline.
- The local3228 backend was restarted after preserving its saved tables; all12 preexisting games compared unchanged after restore. The backup JSON is local evidence only and must not be packaged for delivery.
- The approved checkpoint and delivery ZIPs were not edited. No new ZIP, hosted deployment, clean dependency installation or physical-iPhone verification is claimed. Small card touch targets remain a known tradeoff. Evidence lives outside the distributable app.

## October 9 follow-up: compact opponents and evergreen/slate

- Room retains its table cloth and card colors. Cooler evergreen opponent panels replace the rejected muted green, and slate replaces the rejected sand tray. Selection/focus cues use pale gold, pickup cues use pale mint, and surface rims are a quieter cool neutral. Other themes are unchanged.
- Roomy portrait opponent panels now hug their actual content instead of reserving88px or filling flexible rows: the normal panel is72px (18% shorter). Additional meld rows grow naturally; the dense nine-meld opponent measures113px with no internal clipping. Own card sizes and the197px maximum four-row shelf remain unchanged. Spare space stays between own books and the bottom-aligned hand.
- Browser390×844: normal15-card hand retains its prior y685.28–786 coordinates and100px visible content. Stress30-card hand185px/content185px and own shelf197px/content197px fit. Buttons mode lifts the hand exactly52px with unchanged hand height and unchanged opponent/pile coordinates. Dense16-card hand149px/content149px fits. This pass changes CSS only; browser layout verification was appropriate and no gameplay suite rerun is claimed.
- CSS backups and screenshot `final-evergreen-compact-390.png` are in `../cosmetic-refresh-2026-10-09/`.

## October 9 follow-up: opponent disclosure and sand tray

- The Room table cloth keeps its existing green. Opponent panels now use muted lighter green; the shared pile tray is sand, with darker selected-pile and available-pickup cues. Card colors and dimensions are unchanged. The opponent disclosure uses the same panel material, sans-serif heading, quieter book frames and a sticky 44px Close control. Ivory retains its pale disclosure styling.
- The disclosure hit area is anchored to the visible name row. Opening focuses Close; live updates do not move focus. Close/Escape restore focus to the player name. In cramped space the panel can open above its opponent or within the visible viewport instead of becoming a 32px strip. Switching opponents resets its scroll; updates to the same opponent retain it.
- The roomy portrait layout no longer stretches empty opponent panels when the hand loses a row. Normal panels stay at 88px, dense book content can grow naturally, and constrained tracks can be shorter. Existing four-row own shelf, card faces and Buttons-mode lift remain in place.
- UI regression suite passed, including name-trigger structure, focus, ordinary/above/viewport placement and cross-opponent scroll reset. Browser checks: Room390×844, Ivory320×700, dense disclosure scroll with Close visible, Escape focus return. In the 30-card/13-meld390×844 fixture, hand185px/content185px and shelf197px/content197px both fit; normal15-card state has three88px opponent panels and a fully visible100px hand region.
- Before the separately requested panel-growth adjustment, measured table geometry was identical across the dropdown-only change. Evidence and CSS backups are in `../cosmetic-refresh-2026-10-09/`, including `dropdown-geometry.json`. No voice chat or new discard-confirmation behavior was implemented; those were discussed only. No hosted deployment, physical-iPhone verification or new delivery ZIP is claimed.

## October 9 follow-up: table materials, direct taps and four-row shelf

- Table-only materials use restrained felt lighting and static grain, charcoal opponent panels and a matching charcoal pile tray. Ivory uses warm pale surfaces. Cover/menu layout, card color meanings and the Approved 10/9/26 checkpoint remain unchanged.
- Buttons mode keeps its Add alternative, but selecting a card and single-tapping a legal own meld now adds it directly. Double-tap only expands/collapses. The existing 320ms double-tap discrimination and all stale-selection, turn, pending-action, confirmation and legality guards remain. New UI regressions reproduce the old select-only defect and verify both direct tap and the button alternative; UI suite passed.
- Own meld faces and fan exposure grew 7% (21×29 → 22.47×31.03px; exposure13 →13.91px). Stacks, tiles and the permanently reserved New meld target scale with them. Hand cards and opponent cards keep their sizes.
- On roomy portrait phones (width≤600, height≥760), the own shelf reserves at most four expanded fan rows (197.12px); tiles reserve three complete rows within that budget. Reclaimed space is distributed through the opponent area. Existing crowded-phone and short-landscape fallbacks remain; landscape's tile minimum increased to62px to fit the larger tile plus shelf padding.
- Browser390×844 normal16: shelf197.12px, whole hand150.08px and fully visible. Selecting a six reveals the44px action strip and lifts the hand52px; opponents, piles and own header remain at exactly the same coordinates. Own faces remain22.47×31.03. Shelf and strip height transitions share180ms timing; reduced motion disables them.
- Browser390×844 stress30/13: all13 expanded melds occupy exactly four rows, all30 hand cards fit without hand overflow. At320×700 all30 cards remain visible; the105.75px shelf scrolls its197px content. Tile settings retain all melds. At844×400 the62px tile shelf and81px hand remain scrollable, with no vanished region.
- Browser direct-play check in an isolated fixture: one click on sixes changed hand16→15 and book6→7. Double-click then expanded the book while hand stayed15. Tests use local-only port3228 so the user's3227 game need not be restarted.
- Screenshots and previous CSS are in `../cosmetic-refresh-2026-10-09/`. No physical iPhone or hosted deployment was tested. Previous nine-suite results below are historical; this follow-up reran the relevant UI regression suite.

## Round-3 fixes and audit follow-through

- Preservation: Approved 10/9/26 contains all 38 pre-edit files, verified against its manifest. Original `handfoot-vic` remains 24/24 unchanged. The old delivery ZIP and approval ZIP were not replaced.
- Automated: all nine suites passed on Node24.19.0: rules117, server229, bots100, motion32, presets17 plus96 complete matches, chat12, and startup/UI/menu. The first full run used locally available ws8.22.0. Then the lockfile's ws8.21.3 tarball was downloaded to an isolated test directory, its SHA-512 verified before extraction, and startup/server229/chat12 all passed with that exact dependency. No install scripts or production dependency changes. UI/menu were rerun after the final editor focus/disclosure corrections.
- Negative controls: the saved original server crashes on the hostile unseated join test. Restoring unsafe rank coercion while retaining the local catch produces three failed regression assertions; a broad exception guard cannot conceal the defect from the new test.
- Browser: host390×844 shows name/count, preset/four-fact summary, Customize, and Create. A customized red-book value survived Back/re-entry and reached a disposable lobby. Practice320×568 keeps Start visible while the form scrolls. The lobby's direct editor successfully saved first-deal rules. The post-deal editor acknowledged queued changes, retained expanded sections, and keeps Save visible. Settings shows personal scope, play/display groups and actual book samples.
- Buttons390×844: hand moves from y635.9 to583.9 with unchanged149px inner height; this intentional lift is preserved. Discard remains at x253.7–378 while Add destinations scroll in the adjacent233.7px region. Clear, Chat, Sort, Auto have44×44px targets. Dense320×700 with Buttons: own meld window48px, hand95px with128px content; footer ends694px. Scrolling reveals the remaining melds and switches the cue upward.
- Stress390×844: all30 hand cards render in a185px inner hand region with no hand overflow; all13 own melds fit the210px shelf. The reserved normal shelf is not treated as wasted space.
- Landscape844×390: supplied patch initially reduced own melds to6px. The corrected landscape-only rules retain a50px meld window and78px hand window; scrolling reaches all settled cards. Board scrolling42px brings the footer fully into view. Very short landscape screens deliberately use scrolling rather than clipping actionable cards.
- Evidence/logs are outside the app at `../audit-fixes-2026-10-09/` and workspace `work/claude-round3/`. Browser checks use an isolated local preview on3227, leaving the prior3225 server running. No physical iPhone, clean npm-ci/Docker build, or hosted deployment is claimed. Existing small hand-card target sizes remain a design tradeoff, not a resolved44px conformance claim.

Earlier entries below are historical and contain superseded counts and descriptions.

## Audit package — October 9, 2026

All nine test commands from `package.json` passed against the staged application source on Node v24.19.0. This environment has Node but no npm executable, so each command was run directly with Node, in package order, using the installed locked ws dependency through NODE_PATH. No clean `npm ci`, Docker build, hosted deployment, or physical iPhone check is claimed. Full output is included in this audit package at `../review/test-results.txt`.

Current results: startup, UI and menu suites passed; rules 117 checks (1,200 simulated rounds); server 180 assertions; bots 100 checks (620 full games); motion 32 checks; presets 17 checks (96 full matches); chat 12 checks. Older sections below are a chronological record and may contain superseded counts or local-only proof links. The root `START-HERE-CLAUDE.md` identifies the current scope and bundled review images.

## Waiting-room return navigation — October 9, 2026

- Added Back to menu at the left of the waiting-room header. It uses existing Leave table cleanup, appears only before the first deal, and ignores stale phase/table clicks.
- Browser: created an isolated local waiting room, confirmed the visible button, used it to return to home, and confirmed focus on Play. User setup fields remain in place. UI and menu regressions pass, including stale/repeated clicks and departure cleanup.
- Proof: `../review/waiting-back-to-menu.png`. Cosmetic table proof: `../review/table-cosmetics-room.png`.

## Cosmetic table pass — October 9, 2026

- Added `table-cosmetics.css`, loaded last and served by the existing static allowlist. Active-table and visible-game dialog selectors exclude the approved cover, setup, and waiting lobby. No gameplay JavaScript, rules engine, sizing algorithm, or interaction behavior changed.
- Quieted outer own-book frames while preserving their border footprint, red/black card faces, wild trims and sideways six-card cues. Count text is 10px; narrow book pills have a 9px floor. Suit pips use full contrast.
- Felt, fine diamond card backs, common control finishes, understated Auto-on marking, and dialog typography use existing theme tokens. Meld destination rings remain clear; warning text keeps its warning color.
- Normal 390 × 844 table: all 34 measured header/opponent/tray/meld/hand/footer/card rectangles are identical before and after the stylesheet.
- Stress 320 × 700: 30 hand cards, final card bottom y=643, footer top y=650, document width=320 with no horizontal overflow. Extra melds retain their existing internally scrolling shelf.
- Browser checked Cards/Tiles, Stacked/Spread, red and black completed books, selected card and legal button destinations, Room/Ivory, and draw chooser. Spread renders seven actual cards per completed QA book. Original geometry and color semantics retained.
- UI and menu suites pass; server suite passes 180 assertions, including the new stylesheet route. No physical iPhone check, package, push, or deployment in this pass.

## Current pass: title, Interactions, and settings sections

- Startup guard, menu/setup and UI suites passed. UI includes Tap/Buttons persistence, legal new/add/discard actions, stale and duplicate guards, discard warnings, focus retention, three settings sections, and a regression for action-strip animation incorrectly compressing opponents.
- Motion (32), chat (12), and rule presets (17 plus 96 full matches) passed during this pass. Server suite passed 179 assertions, including startup.js, interaction-mode.css and handfoot-cover.svg content types.
- Browser: Play, Settings and Rules all open from HTTP. Appearance contains card/table styles; Settings contains Interactions, meld/finished-book preferences, movement and turn notices. Duplicate layout/sort preferences are removed.
- Cover verified in green and Ivory at 390 × 844, and all title controls fit 320 × 568 without scrolling. Source file opening is verified through the startup unit harness; the browser tool disallows file URLs.
- Buttons at 390 × 844: own meld shelf stays at y=384; hand moves from y=635.9 to y=583.9; bottom toolbar stays at y=794. Book dimensions stay 46 × 39. Add 1 to 6s commits 16→15 hand cards; Undo restores 16. Discard 6 opens the existing warning; Keep preserves all cards.
- Stress 320 × 700: all 30 hand faces remain above the buttons (last card y=594, actions y=601–645, toolbar y=650). All 13 melds remain available in a 57px internally scrolling shelf; they are not all simultaneously visible.
- Outside-game styling: Rules, Settings, Appearance, Friends, host setup, Join, Computer setup and the waiting lobby use the approved cover’s paper/felt typography and controls. Selectors exclude the active playing table. The revised Play choices use two illustrated paper cards; both paths were exercised in the browser, with no horizontal or vertical overflow at 320 × 568 (content bottom y=450). Waiting lobby verified at 390 × 844 using a disposable local room, then left.
- New visual proof: `../review/play-card-room.png`, `../review/settings-card-room.png`, `../review/rules-card-room.png`, `../review/appearance-card-room.png`, and `../review/waiting-card-room.png`.
- Proof images outside the app: `../review/cover-ivory.png`, `../review/buttons-interaction.png`, `../review/buttons-stress-320.png`. Physical iPhone Safari has not been verified in this pass.

## Latest automated checks

Release packaging check: the SVG favicon route was added to the public asset allowlist; the full server suite then passed 172 assertions, including SVG availability and content type.

- UI suite passed after flow layout, independent meld/finished-book preferences, and anchored dropdown changes.
- Menu suite passed after cover/setup/lobby work and automatic-deck label changes.
- UI regressions cover all four Cards/Tiles × Stacked/Spread combinations for own/opponent books, individual overrides, saved defaults, legal Add/discard actions, selection stability, and opening multiple real-card books without shrinking.
- Backend after rule presets: 117 rules checks / 1,200 simulated rounds; 172 server assertions; 100 bot checks / 620 complete four-round games; 17 preset checks including 96 additional full matches across both presets and four bot styles.
- All eight suites are included in `npm test`. Motion has 27 planner/reveal checks and chat has 12 keyboard/draft checks. Setup/UI tests now cover complete preset replacement, custom values, queued preset changes, one-stock draws, required final discards, variant scoring, and Random choosing all twelve ordered pairs without choosing an empty pile.
- Browser testing caught native select `input` firing before `change` and resetting the preset prematurely. Both setup and midgame editors now ignore that intermediate event; regression checks cover this ordering.

## Browser verification

Desktop in-app browser with local disposable fixtures, rendered at phone sizes:

- 390 × 844, three opponents and a 16-card hand (later 15 as the user played): piles between opponents and personal cards; one personal header; natural-width books; round + opening minimum together; lower activity line removed.
- Own faces are 21 × 29; sideways near-book face 29 × 21. Opponent faces are 22 × 30; sideways 30 × 22. Normal roomy-phone opponent panels are 72px high with a thin whole-panel turn outline.
- Sort and Auto have actual 44 × 44 minimum targets. Dropdowns remain inside the viewport; Auto scrolls internally when necessary.
- Selecting a playable hand card preserved every book's position and dimensions. Expanded books retain actual card faces.
- Cards/Tiles plus Stacked/Spread verified through live settings. Finished books remains visible in Tiles, and Spread opens completed books at both seats.
- 390 × 844 with 30 hand cards and 13 melds: hand above action bar; extra own meld rows scroll without shrinking card faces.
- 320 × 700 crowded-opponent fixture: fixed an outer-scroll fallback that hid the player's hand behind actions. Two own meld rows now fit (96px shelf), all 16 hand cards end at y=598 above actions at y=604. Extra opponent meld rows scroll within their panel, keeping all names visible.
- 320 × 700 with 30 hand cards and 13 melds: all 30 hand cards end at y=596, actions begin y=604; own shelf retains a 48px readable scrolling floor.
- 1200 × 800: no horizontal overflow; hand ends y=753 above actions y=761; own faces remain 21 × 29.
- Cover logo, Play/Friends, host/practice setup, expanded advanced rules, Join, and waiting lobby checked at 390 × 844. Fields fit, advanced rules scroll, and empty gameplay panels stay hidden in waiting rooms.
- Cover, setup, waiting-lobby and table proof images are in the sibling `outputs/review` folder. Local wrappers and test saves are under `work/` only.

## Latest browser checks — themes, movement, presets and cover

- Card room, Midnight and Ivory inspected on real rendered tables. Midnight/Ivory measured identical board, opponent, pile, meld, hand and action rectangles. Ivory meld-count, discard-caption and switch contrast exceptions corrected.
- Real UI actions produced two stock-to-hand flights, one hand-to-meld flight, one hand-to-discard flight, and a bounded eight-flight pickup. Layers ignore pointer events, disappear afterward, and log no runtime errors. Device Reduce Motion and the Off preference are guarded in code; physical device motion settings were not exercised.
- A Real Rules practice table was created through setup, showed one stock and Auto On/Off, automatically drew two cards, and displayed a nine as ten points. A subsequent fresh setup restored House Rules.
- At 320 × 700 with three bots, Random stayed paused for an available legal discard pickup. On the next turn it drew two cards from distinct piles 2 and 4. Chat sat immediately before Sort with a 44px target and opened its dialog correctly; toolbar counts and buttons did not overlap.
- Midgame preset editor also retains Real Rules after the native input/change event sequence; one stock, three wilds and 100-point going-out bonus update together.
- New vector cover reviewed at 390 × 844 and 320 × 700, including Ivory. All three menu actions fit without scrolling; no horizontal overflow.
- Theme, title-screen and final table screenshots are in `outputs/review` outside the application package.

## Limits

The phone wrapper logged a no-source-URL MutationObserver error on reload. No matching invalid target was found in the application, and navigating directly to the app produced no new error. Its origin remains unconfirmed.

Not physical iPhone/iPad, VoiceOver, software-keyboard, production-networking or Render verification. Extreme tables use bounded meld scrolling instead of hiding the hand or shrinking faces. No ZIP, GitHub push or deployment performed. Use paired client/server because gameplay requests require turn IDs.

## Playtest feedback follow-up

- UI, menu, 27 motion/reveal and 12 chat interaction checks passed after the new gestures and confirmations. Discard opportunities are checked against active rules; regression cases use the authoritative game engine as a witness.
- Browser: single tap added one selected six exactly once; double-tap collapsed its display without playing it. Keep card left a playable six selected after the warning.
- Browser: Random Auto paused for a legal queen pickup; the pile showed Take pile and Auto paused. A subsequent stock draw displayed the actual queen and three in the reveal and restored visible hand cards afterward.
- Browser: opening Chat focused Close, with the readonly composer and keyboard hidden. Tapping the composer showed the app keyboard; clicking H and I entered an unsent draft.
- Chat at 390×844 retained 252px of visible history with the keyboard; at 320×700 it retained 258px. Both dialogs and keyboard stayed inside the viewport. Physical iOS keyboard behavior remains unverified on a device.
- Original main copy and the previously delivered ZIP remain separate from this follow-up preview.

- Follow-up server/WebSocket suite: 176 assertions passed, including all four feedback stylesheet routes and the SVG logo.

## Compact tray + draw chooser follow-up

- The selected hybrid keeps a 66px center tray between opponents and personal cards. Stock totals and the discard count are printed inside the cards. The matching chooser uses larger card faces and a separate Draw/Take action row.
- UI regressions cover once-per-turn opening and dismissal, manual reopening, chat/settings/opponent-detail deferral, room/round/turn changes, disconnects, Auto bypass, legal-pickup pauses, unavailable chosen stocks, single-stock rules, last-stock fallback, stale selections, duplicate requests, and rejected-send retries. UI and menu suites passed; 27 motion/reveal and 12 chat checks also passed.
- Browser at 390×844: selected two stocks, pressed Draw 2, observed the chooser close and the actual queen/three draw reveal open. Card counts updated afterward. Saved compact tray and selected-popup screenshots in `outputs/review`.
- Browser at 320×700: Auto paused for a legal queen pickup and opened the chooser with the explanation. Popup occupied x=10–310 and y=203–476; stock targets measured 52×74px. No horizontal overflow; the hand remained visible below it. Take pile opened existing inspection/confirmation without submitting a pickup. Dismissing it did not reopen the chooser repeatedly.
- No gameplay engine, server, original main copy, or delivered ZIP changes in this follow-up. All 24 original files still match the recorded baseline. Physical iPhone verification remains outstanding.

## Auto-only reveal and arrival outline

- The 1.5-second You drew reveal now requires a matching accepted Auto request. Merely enabling Auto does not cause a reveal for a manually chosen draw. Request origins are cleared after errors, disconnects, context changes and expiry. Manual draws retain direct stock-to-hand movement.
- Browser: a real automatic draw showed 7♠ and 2♣, then returned to the hand. A manual draw while Auto was paused increased the hand from 16 to 18 with zero open reveal dialogs immediately after acceptance.
- Arrival markers use a 3px saturated turquoise outline on dark tables, with a dark separating edge; Ivory retains its deep green marker. Selected cards stay gold with a narrow arrival underline. Card geometry and wild-card bands are unchanged. Dark and Ivory appearances were inspected in the phone preview; the earlier white outline on dark felt was replaced following owner feedback.
- UI suite and 32 motion/reveal checks passed, including manual/Auto distinction, rejected sends, stale state, pending requests and replay prevention.

## Metallic gold arrival trim

- Owner replaced the turquoise arrival marker with shiny gold. New cards now carry a static metallic gradient ring in every theme; selected cards keep their existing lift. The outer ring preserves face dimensions and wild-card bands. A plain-gold fallback covers browsers without mask compositing; both standard and WebKit mask syntax are supplied.
- Inspected the actual phone render, including computed mask composition and the final card faces. No game logic or Auto-only reveal behavior changed in this visual follow-up.

## Separate arrivals, wild trim, smaller stock tray

- Owner replaced arrival outlines with a separate first group above the existing hand. Both Spread and Layered keep picked-card order, sort settled cards independently, retain stable selection nodes, and scroll to arrivals after a draw. Row budgeting includes both groups.
- Private jokers now use metallic gold trim, deuces metallic blue. Public meld wilds retain their solid-color faces. Normal newly drawn cards have no outline.
- Compact tray reduced 66→60px (9.1%); card backs/faces reduced 36×50→33×46. Touch controls remain 50px high. The chooser dimensions are unchanged.
- Browser 390×844, 18 cards (2 fresh +16 existing): arrival group47px, existing group99px, both above the actions; own meld shelf129px with no clipped rows. Eight columns are chosen from the largest group, avoiding an unnecessary settled-card row.
- Browser320×700, 30cards+13melds: all30card nodes present, arrival group first and visible, hand scrolls within its bounded area above actions (hand bottom596, actions top604). This extreme case needs internal hand scrolling to preserve face size; no cards sit behind the footer.
- UI regression suite passed for grouped hand rendering, sorting, selection, removal, all-fresh/empty hands, viewport column selection and30-card row budgets. The32 motion checks also pass.

## Latest owner revision: original wilds, smaller hand

- Restored original joker/deuce gold/blue bands, replacing the experimental metallic rims. New cards still occupy a separate first group above the settled hand, with no arrival outline.
- Hand faces reduced about12% (regular desktop44×62→38.72×54.56, phone44×47→38.72×41.36; short-phone dense height39→34.32). Layered dimensions/type/overlap scale together. Only hand cards change; public melds retain their existing size.
- Standard columns now budget43px including gap, capped at10; the existing dense-hand10-column rule and layered6-card rows remain. Selection does not affect the sizing inputs.
- Browser390×844 with18cards: arrival row41.36px; settled16cards span87.72px; hand149px with no internal overflow. Original wild-band backgrounds verified. UI suite and32motion tests passed after the new column sizing.


## October 9: direct table play and compact controls

Changes verified in the separate optimized copy; original copy unchanged (24 baseline hashes).

- Legal new melds use a 67 × 39 px destination, matching a three-card fan; the tile view uses its own 38 × 52 px footprint. The slot remains reserved so card selection does not repack existing books.
- A first meld appears at the normal shelf origin. The old oversized centered empty panel is now quiet text, hidden while the legal destination is present.
- Discard acts through the central pile for exactly one legal selected card, including an empty discard pile. A stationary pulse and Tap to discard label communicate the action. Reduced motion keeps the static cue. A playable queen correctly opened the existing warning with Keep card focused.
- New meld commit and toolbar Undo were exercised with a local WebSocket fixture. Hand counts changed 18 → 15 → 18. A fresh opening of three fives changed 13 → 10 and recorded 15 laid points; undo restored 13.
- No playing action buttons remain in the status panel. Start, Next round, and Rematch remain available; Undo, Clear, Chat, Sort and Auto remain reachable below the hand.
- Chat, Sort and Auto share 44 × 40 px dimensions and the same baseline. The table header is 44 px tall. Hand/foot counts sit beside Your cards; the extra points/toolbar row above the shelf is removed.
- At 390 × 844, Sort and Auto opened above their bottom anchors within the viewport.
- At 320 × 700 with 30 hand cards and 13 own melds, all 30 hand faces fit in a 168 px hand region ending at y=645, before the 44 px bottom strip. The book shelf remains internally scrollable (106 px visible / 189 px content). There is no horizontal page overflow.
- UI regression suite, menu suite, chat suite, and 32 motion checks passed. New UI coverage includes legal/invalid/stale destinations, empty-pile discard, confirmation, pending actions, Undo, and lifecycle controls.

Proof images: `../review/direct-table-first-meld.png`, `../review/direct-table-stress-320.png`. Local disposable fixtures run on 3224 without resetting the user's 3223 game. No production deploy or physical-iPhone acceptance is claimed.

Final owner follow-up: all legally addable own melds now have a static gold destination outline. A selected six highlighted its six-card meld and the discard pile simultaneously; both retained their positions. Completed-book eligibility remains governed by the active lock/wild/going-out rules. Screenshot: `../review/direct-table-meld-and-discard.png`.
# October 9: Buttons-mode cosmetic follow-up

- Paint-only change in `table-cosmetics.css`: champagne meld/draw buttons and wine Discard, with inset edges, hover/pressed finishes and contrasting keyboard focus. Colors remain independent of the table theme.
- Browser checked Card room and Ivory at 390 × 844 with an active Add/Discard row. All 43 measured panel/control/card rectangles exactly matched the pre-change state after deal animations settled. Rules, dimensions, template and hand lift were unchanged.
- Keyboard focus verified on both actions. Text contrast at gradient endpoints: champagne 8.78–11.42:1; wine 7.42–9.66:1. No physical-device test is claimed.
- Before/after screenshots, geometry and the pre-change stylesheet are in `../cosmetic-refresh-2026-10-09/`. The Approved 10/9/26 checkpoint remains untouched. Earlier suite results below precede this CSS-only update; suites were not rerun for a paint change.
