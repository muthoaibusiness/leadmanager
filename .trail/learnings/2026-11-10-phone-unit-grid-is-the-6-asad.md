---
title: "Phone unit grid is the 6-a-row seat map: only free units are green and outlined"
author: Asad
date: 2026-11-10
branch: feat/ai-trainer-mvp
cost: { minutes: 31, tokens: 1171791 }
id: l-c6fdac3c
scope: repo
status: active
replaces: l-d7f8fa76
src: agent
touches:
  - src/components/project/FloorPlan.css
  - src/components/project/AvailableUnitsView.jsx
---

## Decided
- On phones the unit grid is a bus/train seat map, per the user's target image: 6 square seats a row, the code over its size, no status word.
- Only a free unit is soft green with a thin green outline. Held, sold and custom-status units have no outline: a faint neutral fill, the code in a soft tone of the status colour (55% mixed toward the text colour, so warm, not deep), and a small dot in the status colour at the top right, matching the chip dots.
- The picked unit gets a 2px ring in the text colour.
- The rest of the reference layout from the earlier learning stays: Back, title, grid/list switch, project line, count cards, Status chips, floor row, picked-unit card, Reserve now bar.

## Tried and ruled out
- 5 a row with the status as a word under the code: the user wanted the seat map back, "without an extra box".
- Solid status fills or deep status colours on taken units: the user asked for warm, not deep, colours.

## Watch out
- Light theme held text (#E3A322 at 55% over the text colour) reads 5.1:1 on the tile. Going above about 60% drops it under 4.5:1.
- The desktop grid is untouched; every rule is inside the phone media block.

In the code: `src/components/project/FloorPlan.css` phone block (`.is-phone .fps-tiles`, `.is-phone .fps-tile.*`); `src/components/project/AvailableUnitsView.jsx` `tiles()` renders `.fps-sz` on phone and desktop alike.
