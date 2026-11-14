---
title: "Phone Back icon jumped up 6px when pressed: two pressed rules, the wrong one won"
author: Asad
date: 2026-11-12
branch: feat/ai-trainer-mvp
cost: { minutes: 8, tokens: 32219 }
id: l-6bdefde7
scope: repo
status: active
src: agent
touches:
  - src/components/project/AvailableUnitsTab.css
  - src/index.css
  - src/components/BackButton.jsx
---

## Decided

On every phone page with the round Back (.fpv-ph-top .hd-back), pressing it made the icon jump up about 5px and come back on release. Cause: the icon rests 6px low (AvailableUnitsTab.css: .fpv-ph-top :is(.hd-back, .ppl-add, .fpv-vt) { transform: translateY(6px) }), and two rules set its pressed transform. index.css has :is(.pg-head.pg-head-sub, .fpv-ph-top) .hd-back:active { transform: scale(.96) }; AvailableUnitsTab.css had .fpv-ph-top .hd-back:active { transform: translateY(6px) scale(.96) }. Both have the same specificity, and index.css is imported after AvailableUnitsTab.css (App.jsx imports the component CSS, main.jsx then index.css), so the scale-only rule won and the 6px was dropped while pressed.

Fix: the pressed rule in AvailableUnitsTab.css is now .fpv-ph .fpv-ph-top button.hd-back:active, which outranks the index.css rule whatever the load order. index.css was not touched. Measured in the real app at phone size on AI Trainer, Prospects, Meta CAPI, Projects, Profile, Calendar and Accounts: the icon's centre moved 5.2px up on press before, 0px after; the pressed transform is matrix(0.96, 0, 0, 0.96, 0, 6).

## Tried and ruled out

- The tap-highlight change and the BackButton swap from the same day: neither sets a transform. The jump predates both; the old hard-coded Back buttons used the same classes.

## Watch out

- .ppl-add (the Projects + button) has the same shape of rule, .fpv-ph-top .ppl-add:active, but no competing rule in index.css, so it does not jump. Not changed.
- Anything else that rests on a transform and gets a pressed scale needs the rest transform repeated in the pressed rule, and that rule must win the cascade.
- To measure: read getBoundingClientRect at rest, then page.mouse.down() on it and read again while :active.
