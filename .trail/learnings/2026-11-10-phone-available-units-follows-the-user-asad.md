---
title: "Phone Available Units follows the user's reference layout, not the flat header"
author: Asad
date: 2026-11-10
branch: feat/ai-trainer-mvp
cost: { minutes: 60, tokens: 1236771 }
id: l-d7f8fa76
scope: repo
status: active
replaces: l-589a645b
src: agent
touches:
  - src/components/project/AvailableUnitsTab.css
  - src/components/project/FloorPlan.css
  - docs/mockups/available-units-reference.html
  - src/components/project/AvailableUnitsView.jsx
---

## Decided
- Phones (below 768px) follow the user's reference image: Back, title, grid/list switch; project picker with its free count; All / Available / On hold count cards; Status with the Manage icon; status chips; the floor as a dropdown row; a card for the picked unit; units 5 a row with the status as a label under the code; a fixed Reserve now button.
- Reserve now (not the tap on a tile) opens the Deal sheet on phones, so a picked unit shows its card first.
- The grid/list switch is real: list mode renders the same tile buttons as rows (code, size, status).
- Desktop is unchanged: everything sits behind the `phone` flag or in `@media (max-width: 767px)`.

## Tried and ruled out
- A flat header (underline tabs, no cards): the user called it odd and old-style and supplied a reference instead.
- Copying the reference's details as-is: its counts disagreed (49 vs 47), its unit card said "Not available to reserve" under an Available badge, and it carried an "Illustrative states" note. Real counts and real unit data replaced them.
- 6 tiles a row with a status word: the label does not fit; 5 a row does.
- A separate list component taking `select` as a prop: react-hooks lint (`refs`) rejects it because `select` touches a ref. The list reuses `tiles()` instead.

## Watch out
- The page keeps 68px of bottom padding while Reserve now shows, so the last row stays clear of it (measured: last row ends at 577px, button starts at 777px on a 412x915 screen).

In the code:
- `src/components/project/AvailableUnitsView.jsx`: `fpv-ph` header, `phList` state, `reserveBar`, `fpv-pick`, `select()` skips `setDealCode` on phones.
- `src/components/project/FloorPlan.css`: phone block under `@media (max-width: 767px)`, `.fpv-ph-*`, `.fpv-pick`, `.fps-st`, `.fps-list`, `.fpv-rsv`.
