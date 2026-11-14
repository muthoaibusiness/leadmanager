---
title: "Phone tab pages: Projects-style 16px inset, locked header, Projects tab font"
author: Asad
date: 2026-11-12
branch: feat/ai-trainer-mvp
cost: { minutes: 28, tokens: 107511 }
id: l-84195add
scope: repo
status: active
src: agent
touches:
  - src/index.css
  - src/components/project/AvailableUnitsTab.css
  - src/components/finance/finance.css
  - src/components/fbleads/fbleads.css
  - src/App.jsx
  - src/components/BottomNav.jsx
  - src/components/views/InventoryView.jsx
  - src/components/finance/Budgets.jsx
  - src/components/views/AccountsView.jsx
  - src/components/views/FbLeadsView.jsx
  - src/components/views/AgentPerformanceView.jsx
---

## Decided

Asad's rules for phone pages that have a Back button and section tabs (Inventory, Users & Accounts, Facebook Leads, Performance), AI Trainer excluded:
- The tab row and the search / filter rows sit 16px in from the content edge on both sides, the same as the Projects search box (29px from the screen edge at 360 to 412px).
- The header (tabs, search, filters) stays put and only the content under it scrolls, as on Inventory > Statements. Phones only, his choice.
- Every tab label uses the Projects tab font: 12.5px bold UPPERCASE, letter-spacing .04em, the desktop "PROJECTS | AVAILABLE UNITS" tabs.
- The Projects list shows the bottom bar; Available Units still does not. The list's search-to-first-card gap went from 30px to 20px.

In the code:
- index.css, after .pill-tabs: one phone block sets --tab-inset: 16px on .fin / .acc / .fbl / .mip, insets their header rows, and turns .pg-body into a column whose one scroller is the page's `.tab-scroll` wrapper. Statements keeps its own scroller, .fin-stmt.
- `.tab-scroll` wrappers were added in InventoryView (Overview), Budgets.jsx, AccountsView (both tabs), FbLeadsView and AgentPerformanceView.
- Bottom bar: BottomNav hides only when projTab is 'units'; App.jsx adds `is-units`, and the short --bnav moved from #app.is-projects to #app.is-units, so the Projects list pads by the real bar height.
- The old 8px Inventory inset (--fin-inset in finance.css) is gone: it stacked with the 16px.

## Tried and ruled out

- 13px semibold normal-case tab labels, which most pages had. He chose the Projects tab style instead.
- Locking the header on desktop too: phones only.

## Watch out

- Uppercase and wider letter-spacing made three tabs wrap at 360px. On phones .pill-tabs is nowrap and each pill shrinks its padding and letter-spacing with the screen (clamp), so Inventory's three tabs and Facebook Leads' three tabs plus the switch fit one line at 360px without clipping text.
- The Performance search dropped to its own line at 360px once the pills got wider. On phones .mip-bar is nowrap and the search is flex 1 1 0, so it shrinks to 116px instead.
- Back and a reload restore .pg-body's scroll only (useNavHistory.js restoreScroll), so a locked page reopens at the top of its content.
- On Users & Accounts the KPI cards and the roster stay at the content edge; only the tabs and the toolbar are inset.
