---
title: "AI Trainer Knowledge tab loaded in two steps, so cards showed and then moved"
author: Asad
date: 2026-11-12
branch: feat/ai-trainer-mvp
cost: { minutes: 18, tokens: 124914 }
id: l-48aa970e
scope: repo
status: active
src: agent
touches:
  - src/components/aitrainer/KnowledgeTab.jsx
  - src/components/aitrainer/DocumentsPanel.jsx
  - scripts/aitrainer-ui/knowledge-load.flow.test.mjs
---

## Decided

On a reload (or a tab open) the Knowledge tab showed Projects, Facts and Business rules first, and about one request later the Knowledge documents card appeared above them and pushed them down. Cause: KnowledgeTab returned its Loading line until items.list answered, so DocumentsPanel did not mount, and docs.list only started after that. Two requests in a row, two paints.

Fix: KnowledgeTab always mounts DocumentsPanel, so docs.list goes out beside items.list. DocumentsPanel calls onSettled(true) when its first load answers or fails, and KnowledgeTab holds the sections until then. A failed docs.list still releases the sections.

## Tried and ruled out

- The history hook, the lazy page chunk and the tab state (useNavState 'aitrainer.tab'): a reload restores the right tab and the right panel in one paint. Measured, not the cause.
- The card entry animation (ait-in): it only fades cards in; it does not reorder them.

## Watch out

- Reproduce with a slow fake backend, not by reading: boot the real app in Playwright, route every non-localhost request, and log the panel's cards every 40ms. With fast responses the two paints merge and the bug hides.
- items.list is still requested twice per open (useItems in KnowledgeTab and the project names in DocumentsPanel). Left as is.

Check: vite-node scripts/aitrainer-ui/knowledge-load.flow.test.mjs.
