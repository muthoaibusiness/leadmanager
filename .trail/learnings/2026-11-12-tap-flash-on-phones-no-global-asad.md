---
title: "Tap flash on phones is off app-wide, by one inherited rule on html"
author: Asad
date: 2026-11-12
branch: feat/ai-trainer-mvp
cost: { minutes: 8, tokens: 33166 }
id: l-be7a2e19
scope: repo
status: active
src: agent
touches:
  - src/components/aitrainer/aitrainer.css
  - src/index.css
---

## Decided

Asad, 2026-11-13: no tap flash on any control, on every page, including the round Back icon. Done with one inherited declaration, -webkit-tap-highlight-color: transparent, on the html rule in index.css. No component, hover, focus or function was changed. Measured in the real app at phone size on Dashboard, AI Trainer, Prospects, Projects, Meta CAPI and Profile: 72 to 125 tappable elements per page flashed before, 0 after.

The flash was the browser's default tap highlight, rgba(51, 181, 229, 0.4), a cyan that reads as green or blue. Before this there was no global rule; only a handful of controls set it themselves.

History: the first fix, the same day, was scoped to the AI Trainer tab row (.ait-bar in aitrainer.css) because Asad had asked not to touch other production code. He then asked for it app-wide. The .ait-bar declaration is still there and is now redundant.

## Tried and ruled out

- The focus ring as the cause. After a touch tap, :focus is true but :focus-visible is false and no outline is drawn. The accent :focus-visible rings are keyboard-only and still draw on a keyboard Tab (checked: solid 2px on .ait-imp).

## Watch out

- A new control needs no tap-highlight rule of its own; the per-control ones in index.css and AvailableUnitsTab.css are redundant now.
- A tap still leaves :hover stuck on the tapped control until the next tap elsewhere. Not changed; fixing it means touching hover rules across the app.
- To measure: getComputedStyle(el).webkitTapHighlightColor, in a Playwright context with hasTouch and isMobile.
