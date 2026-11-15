---
title: "Phone Projects nav opens the project list, not Available units; desktop keeps opening Available units"
author: Asad
date: 2026-11-11
branch: feat/ai-trainer-mvp
cost: { minutes: 59, tokens: 290581 }
id: l-ca39283d
scope: repo
status: active
replaces: l-7ac7914f
src: agent
touches:
  - src/components/project/AvailableUnitsView.jsx
  - src/components/project/FloorPlan.css
  - src/components/project/ProjectConsole.jsx
  - src/index.css
  - src/components/project/AvailableUnitsTab.css
  - src/context/AppContext.jsx
  - scripts/projects-default-tab.test.mjs
---

## Decided
- Tapping Projects in the sidebar or bottom bar on a phone (below 768px) opens the project list; tapping a project's card opens its Available units. On desktop the same nav entry still opens Available units (unchanged), with the list a tab away.
- Deep links and the phone Home's project cards go straight to a project's units on every screen size, as before.
- The phone list is glass cards: a faint white tint and blur over the page (not a solid grey), a hairline edge, a chevron at the end, inset 6px each side; they settle in once on mount, never loop, and reduced motion turns the animation off.
- The rest of the phone Projects layout stays as the earlier learning says: pinned header, only the list or unit grid scrolls, "Available units" title in sentence case, calendar-style floor row, 6 seats a row, picked unit docked at the bottom.

## Tried and ruled out
- A solid card surface for the rows: the user wanted glass, not grey.
- Deciding the default tab in CSS or in the page: it has to be in `nav()` so the history entry and the hash (`#/properties` vs `#/properties/units`) are right from the first paint.

## Watch out
- The phone/desktop split in `nav()` reads the viewport at tap time (`window.matchMedia(PHONE_MQ)`), so a tablet rotated below 768px behaves as a phone from then on.
- Project rows keep the same button and `openUnits` handler; only CSS changed, so search, tap and scrolling are untouched.

In the code: `src/context/AppContext.jsx` `nav()` (`PHONE_MQ` from `hooks/useIsPhone.js`), `scripts/projects-default-tab.test.mjs` (the rule's self-check), `src/index.css` phone block `.ppl button` (`--ppl-glass`, `--ppl-edge`, `ppl-in`), `src/components/project/AvailableUnitsTab.css` (`.ppl-wrap`, search-to-cards gap).
