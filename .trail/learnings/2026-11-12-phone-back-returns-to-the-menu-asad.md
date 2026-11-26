---
title: "Phone Back returns to the menu drawer or the previous page, not home"
author: Asad
date: 2026-11-12
branch: feat/ai-trainer-mvp
cost: { minutes: 1, tokens: 1415 }
id: l-525f226a
scope: repo
status: active
src: agent
touches:
  - src/hooks/useNavHistory.js
  - src/components/BackButton.jsx
  - src/context/AppContext.jsx
  - src/App.jsx
  - src/components/views/LeadsView.jsx
  - src/components/views/MetaCapiView.jsx
  - src/components/views/PropertiesView.jsx
  - src/components/project/AvailableUnitsView.jsx
---

## Decided

Asad, 2026-11-13: the round Back on every phone page goes where the user came from. On a page opened from the menu drawer, Back reopens the drawer over that same page; the page does not change. On a page opened any other way (bottom bar, a card, a link on Home), Back goes to the previous page. This replaces the earlier rule that the phone headers go straight home; the five headers that hard-coded nav(homeView(user)) (App.jsx PageHeader, LeadsView, MetaCapiView, PropertiesView, AvailableUnitsView) now render the shared BackButton.

How: pageEntry() in useNavHistory.js stamps prev.menu on a pushed entry when the drawer was open in the last committed render (nav.live.overlays.sidebarOpen). For such an entry the hook's back.go calls openMenu() and nothing else. openMenu (AppContext) only acts under DRAWER_MQ and returns whether it opened; when it returns false (desktop, docked sidebar) back.go falls back to window.history.back().

## Tried and ruled out

- Stepping history back one entry and then reopening the drawer (in onPop). The drawer opened, but over the page before, so the user saw Home behind the menu. Asad rejected it: the page must stay.
- Reading sidebarOpen from the render that pushes the entry. It is already false there, because nav() closes the drawer in the same update.

## Watch out

- The browser's own Back (gesture, hardware key) is still a plain step to the previous page; only the header's Back opens the menu.
- prev.menu is stored in the history entry, so a restored page keeps its menu Back.
- BackButton renders nothing on the account's home page, so .fpv-ph-top > h1:first-child keeps the title in the middle grid column (AvailableUnitsTab.css).

Check: vite-node scripts/nav-back-menu.test.mjs.
