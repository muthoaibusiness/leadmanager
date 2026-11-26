---
title: "Phone Available Units: floors in a dropdown, 6 seats a row, outline only on free seats"
author: Asad
date: 2026-11-10
branch: feat/ai-trainer-mvp
cost: { minutes: 14, tokens: 309242 }
id: l-589a645b
scope: repo
status: active
replaces: l-fd99f916
src: agent
touches:
  - src/components/project/AvailableUnitsView.jsx
  - src/components/project/FloorPlan.css
---

## Decided
- On phones (below 768px) the floors are a dropdown (the app's `Select`, each floor with its free count), beside a compact unit search. The vertical floor rail is gone on phones, so the seats take the full width.
- Seats: 6 equal seats a row. Only a free seat has an outline (soft green box). Taken seats (On hold, Sold, custom statuses like Landowner and Reserved) have no outline: the code in the status colour mixed toward the text colour, plus a dot in the status colour (the same colour as its chip). Picked seat is solid blue.
- Desktop is unchanged: phone changes sit behind the `phone` flag or in `@media (max-width: 767px)`.

## Tried and ruled out
- A slim vertical rail of floor numbers (with free counts) on phones: the user wanted the floors as a dropdown so the seats get the full width.
- 5 seats a row: the user asked for 6.
- An outline on every seat: only free seats should have one.
- Status text mixed toward white: unreadable in light theme. Mixing toward `--t1` works in both; hold needs 55% for 5.1:1 on light.

## Watch out
- `.fpv-grid.is-rail` rules at 860px and below also match phones: phone overrides need `.fpv-grid.is-rail.is-phone` to win.
- Custom status colours come from Admin (`unitStatuses`); their text contrast depends on that colour.

In the code:
- `src/components/project/AvailableUnitsView.jsx`: `fpv-phbar` (floor `Select` + search) when `phone`; rail `nav.fpr` and the top-row search render only when `!phone`.
- `src/components/project/FloorPlan.css`: phone block `@media (max-width: 767px)`, `.is-phone .fps-tile`, `--st-tx`, `--st-dot`, `::after` dot.
- `floorTag` (the rail's short floor label) was deleted with its test once the rail left phones.
