---
title: "Phone Available Units is a calendar page: floor row with arrows, 6 seats a row, picked unit docked at the bottom, Customers under Manage"
author: Asad
date: 2026-11-11
branch: feat/ai-trainer-mvp
cost: { minutes: 27, tokens: 317205 }
id: l-01260064
scope: repo
status: active
replaces: l-64632fe1
src: agent
touches:
  - src/components/project/AvailableUnitsView.jsx
  - src/components/project/FloorPlan.css
  - index.html
  - scripts/icon-font.mjs
  - ".gate-harness/vite.units.mjs"
  - src/lib/iconFont.js
---

## Decided
- Phones (below 768px) follow the user's subscription-calendar reference: Back, title, grid/list switch; the project in uppercase with its chevron and a round Manage icon, set a little lower; the status chips; a floor row like a calendar's month row (floor name, "N of M free · floor i of n", round arrows stepping one floor); the units 6 a row; the picked unit docked in a fixed bottom bar (code, size · status, Reserve now when free).
- The desktop's Deal overview / Customers panel does not render on phones; Customers is a Manage menu item that opens a bottom sheet with the same counts and request list.
- Desktop (768px and up) is unchanged: every rule sits in the phone media block or behind the `phone` flag.

## Tried and ruled out
- Count cards, a Status heading and the floor dropdown: dropped with the calendar reference.
- 7 a row (the reference's week grid): the user found it cluttered and asked for 6, with more air between chips, floor row and grid.

## Watch out
- 6 a row no longer fits a 47-49 unit floor on one screen; picking a tile under the dock scrolls it clear (scroll-margin-bottom on the tiles, scrollIntoView on pick).
- The arrows step the floor plans in saved order, then "Other units". "All floors" (old links only) is on no step: both arrows are disabled there.
- The dock sits at `bottom: var(--bnav)`, set in AvailableUnitsTab.css while `.fpv-ph` is on the page.
- A tablet turned to phone width clears `dealCode`, so a cart opened on the wide layout never pops up as the phone sheet.

In the code: `src/components/project/AvailableUnitsView.jsx` (`fpv-fh`, `pos`, `dock`, `peoplePanel()`, `peopleSheet`), `src/components/project/FloorPlan.css` phone block (`.fpv-fh`, `.fpv-rsv`, 6 columns, `scroll-margin-bottom`). Measured with Playwright via `.gate-harness/vite.units.mjs` on Pixel 7, iPhone 14 and 360x680.
