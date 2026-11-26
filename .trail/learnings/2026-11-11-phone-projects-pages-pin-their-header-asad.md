---
title: "Phone Projects pages pin their header: only the list or the unit grid scrolls, and the title is sentence case"
author: Asad
date: 2026-11-11
branch: feat/ai-trainer-mvp
cost: { minutes: 79, tokens: 1851790 }
id: l-7ac7914f
scope: repo
status: active
replaces: l-01260064
src: agent
touches:
  - scripts/icon-font.mjs
  - src/components/project/AvailableUnitsView.jsx
  - src/components/project/FloorPlan.css
  - ".gate-harness/units.html.jsx"
  - index.html
  - src/components/views/PropertiesView.jsx
  - src/components/project/AvailableUnitsTab.css
  - src/App.jsx
  - src/components/BottomNav.jsx
  - ".gate-harness/vite.units.mjs"
---

## Decided
- On phones (below 768px) both Projects pages are one column the height of the screen. The header block (round Back home, centred title, grid/list switch; then the search + Manage icon on the list, the project + Manage, status chips and floor row on units) sits 14px from the top and never moves. Only the projects list, or the units grid, scrolls underneath.
- The page title is sentence case: "Available units", not "Available Units" (the user's call).
- The header bar, hero and bottom bar do not mount on phones for these pages (React state, not CSS on a lazily mounted class), so the old chrome can never flash while the page chunk loads.
- The rest of the calendar layout stays as the earlier learning says: floor row with arrows, 6 seats a row, picked unit docked at the bottom, Customers under Manage.

## Tried and ruled out
- Renaming the page to "Units": offered, the user kept "Available units".
- Hiding the old chrome with `:has(.fpv-ph)` CSS: the lazy chunk mounts late, so the header, hero and bottom bar painted first. Replaced by early returns keyed on the view.
- Letting the page body scroll with a sticky header: the body scroller padding fought the dock. The inner list/grid is the scroller instead; the body never scrolls here.

## Watch out
- The dock sits at `bottom: var(--bnav)`, set while `#app.is-projects` (App.jsx, from the view state). The grid scroller ends above the dock, so no unit is ever under it.
- The shared header CSS lives in the file loaded with the shell, not the lazily loaded floor-plan CSS, so the list page gets it even before Available units was ever opened.

In the code: `src/App.jsx` (`is-projects`, PageHeader / PageHero return null on phones for `view === 'properties'`), `src/components/BottomNav.jsx` (same), `src/components/project/AvailableUnitsTab.css` (`.fpv-ph*`, `.fpv-vt`, `.fpv-ph .fpv-manage`, `.ppl-wrap`, the `.pg-body` column rules), `src/components/project/FloorPlan.css` (`.fpv:has(> .fpv-grid.is-phone)` column, `.fpv-grid.is-phone` scroller), `src/components/views/PropertiesView.jsx` phone branch. Measured with Playwright via `.gate-harness/vite.units.mjs` (`?view=list&many=9`, `?floor=<planId>`).
