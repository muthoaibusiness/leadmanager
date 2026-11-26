---
title: "Phone seat map shows status by number colour, free seats keep a soft green box"
author: Asad
date: 2026-11-10
branch: feat/ai-trainer-mvp
cost: { minutes: 49, tokens: 565819 }
id: l-fd99f916
scope: repo
status: active
src: agent
touches:
  - docs/mockups/available-units-android.html
  - src/components/project/AvailableUnitsView.jsx
  - src/lib/floorPlan.js
  - scripts/floor-tag.test.mjs
  - src/components/project/FloorPlan.css
  - src/components/project/AvailableUnitsTab.css
  - src/App.jsx
---

## Decided
- On phones (below 768px) the Available Units grid is a bus/train-style seat map: 5 equal seats a row.
- A free seat keeps a soft green box (12% green fill, faint green edge) with a plain number. The user rejected free seats without the box.
- On hold, Sold and the project's custom statuses (Landowner, Reserved) sit in a plain neutral box. Only the unit code takes the status colour, mixed toward the theme text colour so it reads light on dark and deep on light.
- The picked seat stays solid blue. The floor rail shows each floor's free count under its tag; "Semi Basement" tags as SB.
- Desktop (768px and up) is unchanged: every rule is inside `@media (max-width: 767px)` or behind the `phone` flag.

## Tried and ruled out
- Full solid fills per status (the old phone look): the eye went to stock you cannot sell.
- Tinting the whole box per status: the user wanted only the text marked.
- Colouring every status's number including free: the user wanted free numbers plain, only the four taken statuses coloured.
- Status text mixed toward white: unreadable in light theme (pale on pale). Mixing toward `--t1` fixes both themes; hold needs 55% (5.1:1 on light) since 62% gave 4.3:1.

## Watch out
- Custom status colours come from Admin (`unitStatuses`), so their text contrast depends on that colour; the mix toward `--t1` keeps the common ones above 4.5:1.
- `scripts/floor-tag.test.mjs` imports `floorPlan.js`, which imports `supabase.js` (reads `import.meta.env`): run it with `npx vite-node`, not plain `node --test`.

In the code:
- `src/components/project/FloorPlan.css` phone block `@media (max-width: 767px)`, `.is-phone .fps-tile`, `--st-tx`.
- `src/components/project/AvailableUnitsView.jsx` rail button: `floorTag(f.name)` plus `f.free`.
- `src/lib/floorPlan.js` `floorTag` (SB rule); `src/components/project/AvailableUnitsTab.css` phone Manage outline and hidden subtitle.
