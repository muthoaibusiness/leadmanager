---
title: "Phone Available Units is a calendar page: floor row with arrows, 7 seats a row, picked unit docked at the bottom, Customers under Manage"
author: Asad
date: 2026-11-11
branch: feat/ai-trainer-mvp
cost: { minutes: 4, tokens: 42348 }
id: l-64632fe1
scope: repo
status: active
replaces: l-7d52ff41
src: agent
touches:
  - src/components/project/AvailableUnitsView.jsx
  - src/components/project/FloorPlan.css
  - ".gate-harness/vite.units.mjs"
---

## Decided
- Phones (below 768px) follow the user's subscription-calendar reference: Back, title, grid/list switch; the project in uppercase with its chevron and a round Manage icon on one row; the status chips; a floor row like a calendar's month row (floor name, "N of M free · floor i of n", round arrows stepping one floor down or up); the units 7 a row like days; the picked unit docked in a fixed bottom bar (code, size · status, Reserve now when free).
- The desktop's Deal overview / Customers panel does not render on phones; Customers is a Manage menu item that opens a bottom sheet with the same counts and request list.
- Desktop (768px and up) is unchanged: every rule sits in the phone media block or behind the `phone` flag.

## Tried and ruled out
- Count cards, a Status heading and the floor dropdown: dropped with the calendar reference; the chips carry the counts, the arrows pick the floor.
- 6 a row: the reference's week grid is 7, and 7 keeps 47 units on one screen (Pixel 7: 142px spare above the bar; 360x680: 53px).

## Watch out
- The arrows step the floor plans in saved order, then "Other units". "All floors" (old links only) is on no step: both arrows are disabled there.
- The dock sits at `bottom: var(--bnav)`, which AvailableUnitsTab.css sets to 12px plus the iOS safe area while `.fpv-ph` is on the page. Moving that rule moves the dock.
- A tablet turned to phone width clears `dealCode`, so a cart opened on the wide layout never pops up as the phone sheet.

In the code: `src/components/project/AvailableUnitsView.jsx` (`fpv-fh`, `pos`, `dock`, `peoplePanel()`, `peopleSheet`, `peopleOpen`), `src/components/project/FloorPlan.css` phone block (`.fpv-fh`, `.fpv-fh-btn`, `.fpv-rsv`, 7 columns). Measured with Playwright via `.gate-harness/vite.units.mjs` on Pixel 7, iPhone 14 and 360x680, both themes.
