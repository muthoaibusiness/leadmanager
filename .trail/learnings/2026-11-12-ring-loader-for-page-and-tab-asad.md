---
title: Ring loader for page and tab first loads; chained tab requests start together
author: Asad
date: 2026-11-12
branch: feat/ai-trainer-mvp
cost: { minutes: 1, tokens: 1910 }
id: l-a8528059
scope: repo
status: active
src: agent
touches:
  - src/components/ui/loader.jsx
  - src/components/ui/loader.css
  - src/components/aitrainer/BehaviourTab.jsx
  - src/components/aitrainer/ModelTab.jsx
  - src/components/aitrainer/DocumentsPanel.jsx
  - src/components/views/FbLeadsView.jsx
  - src/components/LeadTable.jsx
  - src/components/Spinner.jsx
---

## Decided

Asad chose the black-and-white ring loader (ui/loader.jsx) for a whole page or tab waiting on its first data, over plain Loading text and the green spinner, because it is the loader Inventory, Available Units and Meta CAPI already used. A small spot inside a card, a KPI sheet, the lead panel or a dashboard section uses the small Spinner / LoadingBlock (Spinner.jsx). Why: the ring is at least 80px, so inside a card it makes the layout jump. The global boot loader (LoadingRadar, #ld in App.jsx) and GlobalLoadingBar are out of scope by his instruction. A page-height ring takes the .ldr-page class in loader.css.

Why some tabs were slow: an early-return Loading branch keeps the next component unmounted, so its request only starts after the first one answers. The cure is to mount that component from the start. BehaviourTab mounts TrainingManager inside a hidden div; ModelTab renders EmbeddingModel in the same child slot in its loading branch and its loaded branch, so it is not remounted. Measured on Behaviour against a fake backend answering in 1.2s: the second group of requests moved from about 1390ms to about 140ms, and the tab settled at 1371ms instead of 2050ms.

## Tried and ruled out

- An artificial delay as the cause of slow tabs: none exists on these load paths. The only timers are GlobalLoadingBar's show delay and Playground history's 250ms debounce. The waits were requests chained by an early-return Loading branch that kept the next component unmounted.

## Watch out

- The ring uses motion. happy-dom's Animation.cancel rejects when it unmounts, which crashes a vite-node UI test with "DOMException [AbortError]: The animation was canceled". Any test that mounts a component showing the ring needs the Element.prototype.animate stub (added to the docs, prompt, botcontrol, flow and knowledge-load tests; pillnav and metacapi already had it).
- To keep a child mounted across a loading branch and a loaded branch, it must be the same element type at the same position in both; otherwise React remounts it and it fetches twice.
- Not converted, still plain text: TestNumbersTab, the Playground history and conversation, the WA Relay training list, the chat thread, lead sources, the public project pages. They are inside a card or outside the CRM shell.
- items.list is still requested twice on Knowledge (useItems and DocumentsPanel's project names).
