# Duplicate verification record

October 9, 2026. All 24 original files in `outputs/handfoot-vic` still match their SHA-256 baseline. Changes are in this separate duplicate only.

## Latest automated checks

Release packaging check: the SVG favicon route was added to the public asset allowlist; the full server suite then passed 172 assertions, including SVG availability and content type.

- UI suite passed after flow layout, independent meld/finished-book preferences, and anchored dropdown changes.
- Menu suite passed after cover/setup/lobby work and automatic-deck label changes.
- UI regressions cover all four Cards/Tiles × Stacked/Spread combinations for own/opponent books, individual overrides, saved defaults, legal Add/discard actions, selection stability, and opening multiple real-card books without shrinking.
- Backend after rule presets: 117 rules checks / 1,200 simulated rounds; 172 server assertions; 100 bot checks / 620 complete four-round games; 17 preset checks including 96 additional full matches across both presets and four bot styles.
- All seven suites are included in `npm test`. Motion has 15 planner checks. Setup/UI tests now cover complete preset replacement, custom values, queued preset changes, one-stock draws, required final discards, variant scoring, and Random choosing all twelve ordered pairs without choosing an empty pile.
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
- A Real Rules practice table was created through setup, showed one stock and Auto On/Off, automatically drew two cards, and displayed a nine as ten points. A subsequent fresh setup restored Christine’s Rules.
- At 320 × 700 with three bots, Random stayed paused for an available legal discard pickup. On the next turn it drew two cards from distinct piles 2 and 4. Chat sat immediately before Sort with a 44px target and opened its dialog correctly; toolbar counts and buttons did not overlap.
- Midgame preset editor also retains Real Rules after the native input/change event sequence; one stock, three wilds and 100-point going-out bonus update together.
- New vector cover reviewed at 390 × 844 and 320 × 700, including Ivory. All three menu actions fit without scrolling; no horizontal overflow.
- Theme, title-screen and final table screenshots are in `outputs/review` outside the application package.

## Limits

The phone wrapper logged a no-source-URL MutationObserver error on reload. No matching invalid target was found in the application, and navigating directly to the app produced no new error. Its origin remains unconfirmed.

Not physical iPhone/iPad, VoiceOver, software-keyboard, production-networking or Render verification. Extreme tables use bounded meld scrolling instead of hiding the hand or shrinking faces. No ZIP, GitHub push or deployment performed. Use paired client/server because gameplay requests require turn IDs.
