---
title: "Inventory Statements: header locked, card scrolls, 10 rows a page on phones"
author: Asad
date: 2026-11-12
branch: feat/ai-trainer-mvp
cost: { minutes: 8, tokens: 48254 }
id: l-6b7c9c79
scope: repo
status: active
src: agent
touches:
  - src/components/finance/Statements.jsx
  - src/components/finance/finance.css
  - src/lib/finance.js
---

## Decided

On the Inventory Statements tab the tabs, the search and filters and the selection bar stay put, and only the statements card scrolls under them. Asad asked for the AI Trainer behaviour, and chose to lock the search and filters too, not only the tab row. On phones the list shows 10 statements a page with the app's Pagination; desktop keeps the whole list, also his choice.

How: the card carries .fin-stmt. In finance.css, .pg-body:has(.fin-stmt) stops scrolling and becomes a column, .fin fills it, and .fin > .fin-stmt is the one scroller, with a bottom margin that clears the phone bottom bar. The page slice is pageOf(rows, page, size) in lib/finance.js; size 0 means not paged. The page number is kept with useNavState('inventory.stmt.page'). The card is keyed by the page, so a new page opens at its top.

## Tried and ruled out

- Locking the tab row only, as AI Trainer does, with the search and filters scrolling away with the table. Offered to Asad and dropped: he wanted the search, filters and New statement to stay in reach while scrolling.
- 10 rows a page on every screen size. Offered and dropped: he asked for Android and iOS, and desktop has room for the whole list.
- Resetting the page to 0 when a filter changes. PageBody remounts per history entry, so reset-on-mount logic would wipe the restored page (CLAUDE.md warns about this). pageOf clamps a page past the end to the last page, which needs no reset.
- pageOf inside Statements.jsx: eslint's react-refresh/only-export-components rejects a non-component export from a component file, so it lives in lib/finance.js.

## Watch out

- useSelection still gets every filtered row, not the page, so Select all selects across pages and the selection bar counts rows that are not on screen.
- Back and a reload restore .pg-body's scroll only (useNavHistory.js restoreScroll), so the card reopens at its top.
- The statement document (.inv-ov) is position: fixed over the page, so the locked layout does not affect it.
- The table is wider than a phone, so the card also scrolls sideways there; that was already so.

Check: vite-node scripts/finance-page.test.mjs.

## Filter row size on phones

Asad asked for the status chips (All, Draft, Final) and the Any payment box to be a bit bigger. In the phone block of finance.css, --row-h went from 36px to 40px, and the chips and the payment box now take `flex: 1 0 auto`, so they share whatever width the row has left instead of leaving it empty before New statement. Caps (228px for the chip group, 150px for the box) stop them stretching on wide phones. Measured at 390px: chips 34/45/45px wide (were 30/41/41), box 101px (was 97), all 40px tall; the row does not scroll sideways at 360, 390, 412, 600 or 767px.

Watch out: the font size is still clamp(10px, 2.7vw, 12px). Raising it makes the row overflow at 360px, where only 8px was free before this change.

## Side inset on phones

Asad asked for the filter row, the search box and the category box to sit a little in from the left and right, and the three tabs to move in on the left only. finance.css sets --fin-inset on .fin in the phone block: .fin > .fin-tools gets it as padding on both sides, .fin > .fin-bar on the left. At 390px the rows start at 21px and end at 369px, inside the card's 13px to 377px. The Budgets tab uses the same .fin-tools block, so it moved in too.

Tried and ruled out: a flat 8px inset. At 360px the filter row had only 4px free after the chips and the payment box grew, so 16px less width made New statement overflow and the row scroll sideways. The inset is clamp(0px, 20vw - 70px, 8px): 8px from 390px up, 2px at 360px, none below 350px.

Watch out: anything that widens the filter row (bigger text, another control) has to re-check 360px, the tightest width.

## New statement and the category swapped on phones

Asad asked for New statement and the category box to trade places on phones, with New statement where the Budgets tab has New budget. In Statements.jsx the category select, the custom-name select and the button are consts; on phones the button follows the search in .fin-tools and the category is the last item of .fin-tools-row, with the custom-name select (Others) on a line under the row. Wide screens keep the old single line.

The filter row no longer holds a button, so its two boxes take `flex: 1 1 auto` and shrink when the row is tight. That removed the 360px overflow, so --fin-inset is a flat 8px again and the clamp() is gone.

Watch out: on a phone the Budgets tab's New budget is not beside the search. The search's flex-basis (220px) plus the spacer and the button do not fit 364px, so the button wraps to its own line, left-aligned, under the search. New statement matches that: both buttons start at 21px and sit at the same height (measured at 360, 390 and 412px). At 767px and on desktop both are at the right end of the search line.
