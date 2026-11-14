---
title: "Section tabs are glass pills, one shared .pill-tabs class"
author: Asad
date: 2026-11-12
branch: feat/ai-trainer-mvp
cost: { minutes: 4, tokens: 29369 }
id: l-50fdb6a8
scope: repo
status: active
src: agent
touches:
  - src/components/finance/finance.css
  - src/components/views/InventoryView.jsx
  - src/components/views/AccountsView.jsx
---

## Decided

Asad gave a reference image (three separate rounded pills, the selected one dark) and asked for the Inventory tabs to match it in warm black glass. He then asked for the same style, gaps and colour on the Users & Accounts tabs (Users, Access), the Facebook Leads tabs (Setup, Forms, Received) and the Performance role tabs (Agent, Team Lead), with the Performance search box kept on the same row as its two pills.

In the code: one class, .pill-tabs, in index.css, used by InventoryView, AccountsView, FbLeadsView and AgentPerformanceView. The old per-page tab rules (.fin-tabs in finance.css, .fbl-tabs in fbleads.css) are deleted, and AccountsView no longer imports finance.css. `.mip-bar .pill-tabs` is nowrap so the Performance search stays beside the pills. Measured in the real app at 360, 390 and 1280px: 36px tall on phones, 34px on desktop, 8px gap, one line on every page, no sideways scroll.

## Tried and ruled out

- First pass: scoping the pill rules to .fin .fin-tabs so Users & Accounts kept its green segmented bar. Dropped when he asked for the pills there too; a shared class replaced it.
- Copying the pill rules into each page's CSS: four copies of the same colours to keep in step.

## Watch out

- The warm black has no token: the values are the --pill-* variables on .pill-tabs, with a light-theme set under :root[data-theme=light].
- In the dark theme the page is black, so the selected pill differs by its warm tint, a brighter edge and white text, not by a large change in fill.
- Not converted: the small Best / Worst / A-Z sort control on Performance (.mip-seg.sm) and the AI Trainer tab bar (.ait-pills). He did not ask for those.
- Icons inside a pill hide on phones.
