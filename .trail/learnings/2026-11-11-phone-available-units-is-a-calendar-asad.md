---
title: "Phone Available Units is a calendar page: floor row with arrows, 7 seats a row, picked unit docked at the bottom, Customers under Manage"
author: Asad
date: 2026-11-11
branch: feat/ai-trainer-mvp
cost: { minutes: 70, tokens: 853244 }
id: l-7d52ff41
scope: repo
status: active
replaces: l-c6fdac3c
src: agent
touches:
  - src/components/project/AvailableUnitsTab.css
  - src/components/project/FloorPlan.css
  - src/components/project/AvailableUnitsView.jsx
  - ".gate-harness/units.html.jsx"
  - ".gate-harness/vite.units.mjs"
---

## Decided
- On phones (below 768px) Available Units follows the user's subscription-calendar reference: Back, title and the grid/list switch; the project name in uppercase with its dropdown chevron and the round Manage (tune) icon on the same row; the status chips; then a floor row like a calendar's month row: the floor name, "N of M free · floor i of n", and two round arrows that step one floor down or up. No floor dropdown, no count cards, no Status heading.
- Units are 7 a row, like days of a week (47 units fill 7 rows). The seat look from the earlier learning stays: only free seats green with an outline, taken seats a soft status-coloured code plus a dot, a ring on the picked seat.
- The picked unit no longer gets a card above the grid: it docks in a fixed bar at the bottom (code as on its tile, size · status) with Reserve now on the right when it is free, like the calendar's "monthly total" bar. Reserve now still opens the Deal sheet.
- The desktop's right panel (Deal overview / Customers tabs) does not render on phones. Customers lives in the Manage menu as its own item and opens a bottom sheet with the same three counts and the reservation requests list.
- Desktop (768px and up) is unchanged: every rule is inside the phone media block or behind the `phone` flag.

## Tried and ruled out
- Count cards (All / Available / On hold) and a Status row with Manage: dropped with the calendar reference; the chips carry the counts.
- The floor as a dropdown: replaced by the month-row arrows, which the user asked for.
- 6 a row: the reference's week grid is 7, and 7 keeps 47 units on one screen on a Pixel 7 (142px spare above the bar) and a Galaxy S23 (53px).

## Watch out
- The floor arrows step through the floor plans in their saved order (bottom floor first) and then "Other units"; "All floors" (old links only) has no position, so Floor above goes to the first plan.
- The dock sits at `bottom: var(--bnav)`; `--bnav` is set in AvailableUnitsTab.css to 12px plus the iOS safe area while `.fpv-ph` is on the page, since the bottom bar is hidden there. Moving that rule moves the dock.
- The Customers count query runs when the sheet opens on phones (`peopleOpen`), when the tab opens on desktop.

In the code:
- `src/components/project/AvailableUnitsView.jsx`: `fpv-fh` floor row with `pos` / `chips`, `dock` (`.fpv-rsv`), `peoplePanel()` shared by the desktop tab and the phone `peopleSheet` (`.fps-sheet.fpv-people`), `peopleOpen` state with `usePageOverlay`, the Manage menu's `Customers` item on phones.
- `src/components/project/FloorPlan.css` phone block: `.fpv-fh`, `.fpv-fh-btn`, `.is-phone .fps-tiles` 7 columns, `.fpv-rsv` flex bar, `.fpv-ph .fpv-manage` round icon.
- Measured with Playwright through `.gate-harness/vite.units.mjs` on Pixel 7 (412x820), iPhone 14 and a 360x680 phone in both themes.
