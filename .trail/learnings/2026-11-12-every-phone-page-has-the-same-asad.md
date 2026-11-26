---
title: Every phone page has the same 20px gap under the Back button
author: Asad
date: 2026-11-12
branch: feat/ai-trainer-mvp
cost: { minutes: 61, tokens: 703936 }
id: l-9872439a
scope: repo
status: active
src: agent
touches:
  - src/components/project/AvailableUnitsTab.css
  - src/components/project/FloorPlan.css
  - src/components/aitrainer/aitrainer.css
  - src/components/finance/finance.css
  - src/components/fbleads/fbleads.css
  - src/components/views/FbLeadsView.jsx
---

## Decided

Asad chose one gap for every phone page that has a Back button: the first row under the Back button starts 20px below it, the gap AI Trainer and Inventory had. Before, most pages had 2px or 4px, Prospects 14px, Projects 28px and Facebook Leads 42px.

On Facebook Leads, the Receiving / Off switch moved from its own line above the tabs to the end of the tab row (Setup, Forms, Received, then the switch). He picked that over putting the switch under the tabs or leaving Facebook Leads with a larger gap.

In the code:
- Pages the shell gives a header (every phone page but Prospects, Meta CAPI, Projects and Available Units): `.page:has(> .lv-ph) { --body-top: 24px; }` in AvailableUnitsTab.css. Going through --body-top, not a padding override, keeps full-height views right: .wa-wrap subtracts var(--body-top) from 100dvh, so Conversations still ends above the bottom bar.
- Prospects and Meta CAPI (their header is inside .pg-body): `.pg-body .fpv-ph.lv-ph { margin-bottom: 24px; }`.
- Projects and Available Units: the row inside the header, .fpv-ph-row and .fpv-ph-pj, margin-top 10px (the header's own gap is 14px).
- The per-page 18px margins on .ait-bar and .fin .fin-bar are gone; the shell gives the gap now.
- Why 24 for 20: the Back button sits 4px below its header box (translateY(6px) on a 40px button in a 44px row).

## Tried and ruled out

- A margin on each page's first row: one rule per page, and every new page would need one.

## Watch out

- Meta CAPI and Public Project measure larger from the Back button to the first visible text, because their first box has its own top padding. The box itself starts at 20px.
- Desktop is untouched: --body-top stays 6px there.
- Pipeline already scrolled its page body on phones before this change; the extra 18px adds to that.
- To measure: Back button bottom to the first visible element under it, Playwright at 360 and 390px.
