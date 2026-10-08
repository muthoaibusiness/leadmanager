# Clickable Floor Plan: "Available Units" tab

**Status:** phases F0–F3 are implemented (uncommitted, branch `asad-dev`). Migration 0020 has **not** been applied to the live database yet, so Save stays switched off there until it is. F4 is not built. See §12 for what changed from this plan.
**Date:** 2026-10-08 · **Branch:** `asad-dev` · **App root:** `leadmanager/`
**Inputs reviewed:** the Projects page screenshot (the red mark sits just left of **Add Property**), the sample `5th-floor-plan.html` (a hand-built clickable shop plan), and the current code.

---

## 1. What we are building

Projects gets a new tab, **Available Units**, placed immediately left of **Add Property**. On that tab:

- Management uploads a floor plan (a photo or a PDF), draws a box around each shop or showroom, and gives each unit its details.
- Once saved, everyone who opens Available Units sees the same plan. Every unit on it is clickable and colored by availability.

### What the team can do

- Upload a floor plan image (PNG, JPG or WebP), or a page of a PDF.
- Draw a box around each shop or showroom.
- Move, resize or delete a box.
- Enter details for each unit: name (like `SHOP-07`), type, size and price.
- Undo a mistake, and redo it.
- Save, then reopen later to make changes.

### Naming

The tab is called **Available Units** (plural) everywhere: the button, the page title and any help text.

### Who can do what

| Role | Sees the tab | Views plans | Edits plans |
|---|---|---|---|
| Management | Yes | Yes | Yes (the same people who can use Add Property) |
| Team Lead, Initial Agent, Meeting Agent, and Executives granted Projects | Yes | Yes | No |
| Master | No (Master only sees the company overview) | No | No |

"Visitors" here means signed-in CRM users who can open Projects. A public page for customers who are not logged in is out of scope; see Open questions.

---

## 2. Audit: what exists today

### A. The Projects page

- The hero action buttons are built in `PageHero`, at `src/App.jsx:233-235`. **Add Property** shows for Management only. It opens an unsaved draft in the project console.
- The page subtitle ("7 projects · 40 units available") and the KPI strip are counted by `projectInventory()`, at `src/lib/projects.js:101-121`.
- The page body is `src/components/views/PropertiesView.jsx`.
- The project console is mounted once, at `src/App.jsx:637`, and opened with `openModal('project-console')`.

### B. The inventory model

- A project holds `variants` (unit types). Each variant holds `units` of the form `{ id, status: 'available' | 'hold' | 'sold', … }` (`src/lib/projects.js:1-8`).
- **A unit has no size or price of its own.** Size and ৳/sqft live on the variant. Three things depend on that:
  - The "Total Area" KPI multiplies variant size by unit count (`projects.js:109`).
  - The deal math uses `variant.size` (`src/lib/deal.js:5-13`).
  - The console unit grid shows only the unit code and its status.
- Commercial floors don't fit this model. In the sample plan, 14 shops have 14 different sizes, so each unit needs its own size and price.

### C. Persistence

- The app talks to PostgREST by hand. The row converters are `pToR` and `rToP`, at `src/lib/supabase.js:618-653`.
- `variants`, `addons` and `media` are jsonb columns on `properties`.
- **Schema drift.** No migration in `supabase/migrations/` creates `variants`, `addons`, `media`, `fast_close_pct`, `fast_close_days`, `listing` or `approval`, yet `pToR` writes all of them. Verify them in the live database before shipping (SQL in §6).

### D. A missing column fails silently (high risk for this feature)

- `sbUpdate` and `sbInsert` respond to an unknown column (`PGRST204`) by removing it, retrying, and returning `ok: true` with a `stripped` list (`supabase.js:223-248`).
- `updatePropertyChecked` only checks `ok` (`src/lib/db.js:1266-1277`).
- So if this feature ships before its migration runs, **Save reports success while the plan exists only in that browser.** It disappears on reload, and nobody else ever sees it.

### E. File storage

- Catalog photos and PDFs are stored as base64 data URLs inside the `properties` row, with a 3 MB cap. A TODO in the code says so (`src/components/project/ProjectCatalog.jsx:56-83` and `:200`).
- Every property row is downloaded at boot (`supabase.js:919`), pushed over realtime, and cached in localStorage. Under quota pressure, the local cache drops property media first (`db.js:405-411`).
- A floor plan drawing (1–5 MB) stored the same way would slow boot and realtime for every user.
- The only Storage bucket is `wa-media`: public read, anonymous insert (`supabase/migrations/0007_whatsapp_chat.sql:167-185`). There is an upload helper to copy, `waUploadMedia` (`src/lib/wa.js:206-228`).

### F. No PDF renderer

Nothing in `package.json` can turn a PDF page into an image.

### G. Catalog editor behaviour that would break plan-linked units

1. **The "# of units" field deletes custom-named units. This is a pre-existing data-loss bug.**
   - `regenUnits` rebuilds a type's units as *prefix + 1…N*. Any unit whose code doesn't follow that pattern is replaced by a fresh "available" one (`ProjectCatalog.jsx:89-102`).
   - It runs on every blur of the field, even when the number is unchanged (`ProjectCatalog.jsx:226-229`).
   - So a unit named `SHOP-07` would vanish, and its box would lose its unit.
   - Legacy projects are hit today. Their units are named `U-01` or the old saleable codes, with an empty prefix, so focusing the field and leaving it resets them all to available, holds and sales included.
2. **The catalog's save overwrites newer statuses.**
   - It saves the whole copy that was taken when the editor opened, `variants` included (`ProjectCatalog.jsx:118-137`).
   - If an agent holds a unit while a manager has the catalog open, the manager's save reverts the hold.
   - The plan editor must not copy this pattern, and the catalog's save must not write `floor_plans`.
3. **Every property PATCH sends the whole row from the local cache** (`db.js:1266-1270`). A stale cached column can therefore overwrite newer cloud data.
4. **Removing a unit type also removes its units** (`ProjectCatalog.jsx:87`). Any box on those units would be left without a unit.

### H. Holds refer to units by type and code

Approving or rejecting a hold calls `setUnitStatus(propertyId, variantId, unitId, …)` (`src/components/views/RequestsView.jsx:17-18`, `src/components/project/ProjectConsole.jsx:208-212`). If a held unit is renamed or moved to another type, approval can no longer find it.

### I. Status colors already exist

The console unit grid uses `--green` for available, `--gold` for on hold and `--red` for sold, in both themes (`src/index.css:11414-11434`). The plan should reuse the same three.

### J. Access control

- A brand-new top-level view would trip the role redirect at `src/App.jsx:521-530`. It would also need a new `FEATURE_KEYS` entry, and users with a custom `allowedFeatures` list would be redirected away from it.
- A sub-tab inside the existing `properties` view avoids both problems.

### K. The sample `5th-floor-plan.html`

Worth reusing:

- An SVG with `viewBox` in image pixels, holding an `<image>` plus one shape per shop.
- Each shape is focusable (`role="button"`, `tabindex="0"`) and responds to Enter and Space.
- Hovering a list row highlights its shape on the plan.
- A selected-shop card with Prev and Next.
- A deep link (`#shop-501`).
- The layout stacks on phones, and motion is reduced when the user asks for it.

Gaps against this request:

- The shapes are typed into the code by hand; there is no editor.
- There is no availability and no price.
- The image is embedded as base64.
- It uses polygons; shops 504–506 are trapezoids.
- Its list is built with `innerHTML`, which must not be ported (see §6).

---

## 3. Design decisions

| # | Decision | Why |
|---|---|---|
| D1 | **A box points to an inventory unit.** The unit stays the single source of truth for status and details. | Plan colors must agree with the Projects KPIs, the console grid, holds and deals. If boxes kept their own status, the two inventories would drift apart. |
| D2 | **Type = unit type (variant). Name = unit code (unit `id`).** Size and price become optional per-unit fields (`size`, `price`). When a unit has none, its type's size and list rate × size apply. | Fits the existing model. Shops with different sizes can share one type such as "Shop". |
| D3 | **Plans live in a new jsonb column, `properties.floor_plans`** (migration 0020). | Not inside `media`: `toProject()` rebuilds `media` with only images, docs and links (`projects.js:55`), so any extra key is lost on the next catalog save. The cache trimmer also blanks `media`. |
| D4 | **Images go to Supabase Storage** (new public bucket `project-media`); the row stores only the URL. A PDF page is rendered to an image in the browser with pdf.js (loaded only inside the editor), then uploaded. | Keeps rows small and boot fast. The viewer only ever deals with an image. |
| D5 | **Box coordinates are fractions of the image width and height** (0–1, 4 decimals). | Independent of resolution, and survives swapping in a sharper scan of the same drawing. |
| D6 | **Rectangles only**, axis-aligned. | Matches "draw a box". Polygons for angled shops can come later. |
| D7 | **Available Units is a sub-tab of Projects.** The view stays `properties`, and the tab state lives in `AppContext`. | No redirect or feature-key changes (J). |
| D8 | **Save writes only `floor_plans` and the unit-detail changes.** They are merged onto a fresh copy of the row, fetched from the cloud just before writing. Unit status is never written from the editor's copy. | Avoids G2 and G3, and a hold placed while the editor was open survives. |

---

## 4. Data shape

```js
// properties.floor_plans (jsonb) ↔ project.floorPlans
[{
  id: 'fp_k3j9x2',
  name: '5th Floor',                 // floor tab label
  order: 5,                          // tab order
  image: {
    url: 'https://…/project-media/…/fp_k3j9x2-1728380000.webp',
    width: 3000, height: 2194,       // natural pixels of the stored image
    mime: 'image/webp', fileName: '5th-floor.pdf',
    source: 'image' | 'pdf', pdfPage: 1, pdfUrl: null,
  },
  boxes: [
    { id: 'bx_a1', unitId: 'SHOP-07', x: 0.3632, y: 0.7553, w: 0.0593, h: 0.1380 },
  ],
  updatedAt: '2026-10-08T10:00:00Z', updatedBy: 'u_123',
}]

// variants[].units[] gains two optional fields
{ id: 'SHOP-07', status: 'available', size: 178, price: 2670000 /* ৳ total */, … }
```

Rules:

- Unit codes are unique across the whole project, not just within a type. `setUnitStatus` mirrors units into a map keyed by code across all types (`projects.js:187-193`).
- A unit can sit in at most one box across all of the project's plans.
- A box whose `unitId` is no longer found is shown as **unlinked**: grey and dashed in the viewer, flagged in the editor. It never crashes.
- New helpers in `projects.js`: `findUnit(project, unitId)` returns `{ variant, unit }`; also `unitSize(u, v)`, `unitPrice(u, v)` and `isUnitLocked(u)` (true when the unit is on hold or sold).

---

## 5. Screens

### 5.1 The tab button

- Add an **Available Units** button (icon `map`) to the hero actions, immediately before **Add Property**. Show it to anyone who can see Projects.
- While the tab is active:
  - The button is pressed (`aria-pressed="true"`).
  - The hero reads "Catalog / Available Units / *n* units available · *m* floor plans".
  - The existing `hero-back` link shows **All Projects**.
  - For Management, **Add Property** gives way to **Add floor plan**.
- On phones, the label shortens to "Units", using the existing `.pc-act-tx` pattern.

### 5.2 Viewer (everyone)

- **Top bar**
  - A project picker. Projects with a plan are listed first; the rest are marked "no plan yet".
  - Floor tabs.
  - Status chips: All · Available *n* · On hold *n* · Sold *n*.
  - A unit-code search.
- **The plan**
  - An SVG with `viewBox="0 0 W H"`, holding the `<image>` and one `<rect>` per box.
  - Each box is filled with a light tint of its status color and has a solid outline. Sold units are also hatched, so color is never the only signal.
  - The unit code is printed inside a box when it is big enough to read.
  - Zoom with − / + / Fit and Ctrl+wheel; pinch to zoom on touch screens. Drag to pan when zoomed in.
- **Right-hand panel** (320 px)
  - The selected unit's card:
    - code, type and a status badge
    - size in sqft and m², and price as a ৳ total and ৳/sqft
    - floor
    - client and holder lines, with the same visibility as the console grid's tooltip
    - Prev and Next
  - The card never shows the floor price to agents; the existing `canSeeFloor` rule applies.
  - Below the card, a unit list grouped by type, with counts. Hovering a row highlights its box, as in the sample.
- **Legend:** the three colors, each with a text label.
- **Live updates:** when an agent holds or sells a unit, every open viewer recolors it without a reload. The existing realtime `refreshDB` already handles this.
- **Phones (≤ 860 px):** the panel stacks under the plan, and tapping a box scrolls its card into view. The page itself never scrolls sideways; the plan pans inside its frame.
- **Empty state:** "No floor plans yet". Management also sees an **Add floor plan** button.
- **Accessibility:** each box has `role="button"`, `tabIndex={0}` and an `aria-label` such as "SHOP-07, Shop, 178 sqft, available". Enter and Space select it.

### 5.3 Editor (Management)

- The editor is a full-screen modal, `floorplan-editor`, loaded on demand with `React.lazy`.
- Its header holds the plan name, **Undo**, **Redo**, **Discard** and **Save**.
- Closing with unsaved changes asks "Exit without saving?", the same way the project catalog does (`useDiscardGuard` / goey-toast confirm).

1. **Open:** choose a project, then **New floor plan** or an existing plan.
2. **Upload**
   - The upload area accepts drag-and-drop or a file picker.
   - Accepted: `image/png`, `image/jpeg`, `image/webp` and `application/pdf`. SVG and HEIC are refused with a clear message.
   - Limits: images up to 15 MB, PDFs up to 25 MB.
   - **Images** are scaled down so the long side is at most 3000 px (`createImageBitmap` with `imageOrientation: 'from-image'`), then exported as WebP at 0.85 quality, or JPEG if WebP isn't available.
   - **PDFs:** pdf.js loads on demand. If the PDF has more than one page, the manager picks a page from thumbnails. That page is rendered at a 3000 px long side.
   - The upload is previewed from a local object URL. Nothing is uploaded until Save, so a discarded draft leaves no file behind.
3. **Replace image:** keeps the boxes, and warns when the new image's aspect ratio differs by more than 2%.
4. **Tools**
   - **Draw box** (key `B`): drag on an empty area. A drag smaller than 8 × 8 screen px is ignored, so a stray click doesn't make a box.
   - **Select** (key `V`).
   - When a box is finished, the details panel opens with the cursor in Name.
5. **Edit boxes**
   - Click a box to select it, drag its body to move it, and drag any of its 8 handles to resize it.
   - Delete or Backspace (or the panel's button) removes it.
   - The arrow keys nudge a box by 1 px, or 10 px with Shift. Esc deselects.
   - Boxes stay inside the image.
6. **Details panel**
   - **Unit:** "New unit", or "Existing unit" chosen from the project's units that are not on a plan yet.
   - **Name:** required and unique in the project, trimmed and upper-cased. It suggests the next code (after `SHOP-07` comes `SHOP-08`).
   - **Type:** the project's unit types, plus "New type…".
   - **Size (sqft):** greater than 0. The placeholder shows the type's size.
   - **Price (৳ total):** 0 or more. ৳/sqft is shown beside it, and the placeholder shows the type's list rate × size.
   - **Status:** read-only. Status changes still go through holds, deals and the catalog.
   - **Locked units:** when a unit is on hold or sold, Name and Type are read-only (H), with the hint "On hold — release it first to rename or change its type". Size and price stay editable.
7. **"Not on this plan" list:** the project's units that have no box. Pick one, then draw its box.
8. **Undo and redo**
   - The editor keeps a history of snapshots, up to 100.
   - A step is recorded when a box is created, when a move or resize ends (on pointer-up, not on every move), when a box is deleted, when a detail is committed (blur or Enter), and when the image is replaced.
   - Shortcuts: Ctrl/Cmd+Z to undo; Ctrl/Cmd+Shift+Z or Ctrl+Y to redo. The buttons are disabled when there is nothing to undo or redo.
   - While the cursor is in a text field, the browser's own undo applies instead.
9. **Save**
   1. **Check:**
      - every box is linked to a named unit
      - no unit code appears twice
      - no unit has two boxes
      - the plan has a name and an image
   2. **Upload** the new image (and the PDF, if kept) to Storage. The Save button shows progress.
   3. **Fetch** the project row fresh from the cloud, then merge onto it:
      - Replace this plan within `floor_plans`, matched by `id`.
      - Add any new types and new units. New units start as available.
      - Apply name, type, size and price edits.
      - If a unit was held or sold since the editor opened, skip its rename or type change, and say so in the result toast.
   4. **PATCH only `floor_plans` and `variants`.** If the response lists `floor_plans` as stripped, treat the save as failed: "Floor plans need database update 0020."
   5. **On success:** update the local store, call `refreshDB()`, and show "Floor plan saved". **On failure:** keep the editor open with everything as drawn, the same as the catalog does.
10. **Reopen:** loads the boxes and details, starts with an empty undo history, and sets the baseline for the unsaved-changes check.
11. **Delete plan:** asks for confirmation, then removes the plan from `floor_plans`. Its units stay in the inventory. The image file stays in Storage, because anonymous users can't delete files.

**Pointer handling:**

- Convert pointer positions to SVG units with `svg.getScreenCTM().inverse()`, so zoom and pan need no extra math.
- Call `setPointerCapture` at the start of a drag, so it continues even when the pointer leaves the box.
- Set `touch-action: none` on the drawing area in edit mode, so mouse, pen and touch all work.

---

## 6. Database, storage and security

### Migration `supabase/migrations/0020_floor_plans.sql`

Applied manually, like every other migration.

```sql
-- Floor plans for the Available Units tab
alter table public.properties
  add column if not exists floor_plans jsonb not null default '[]'::jsonb;

-- Columns the app already writes but no migration created (no-ops where present)
alter table public.properties add column if not exists variants        jsonb   default '[]'::jsonb;
alter table public.properties add column if not exists addons          jsonb   default '[]'::jsonb;
alter table public.properties add column if not exists media           jsonb   default '{}'::jsonb;
alter table public.properties add column if not exists fast_close_pct  numeric default 0;
alter table public.properties add column if not exists fast_close_days integer default 0;
alter table public.properties add column if not exists listing         text;
alter table public.properties add column if not exists approval        text;

-- Storage for plan images and PDFs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-media', 'project-media', true, 26214400,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Public read; anonymous insert into this bucket only (same posture as wa-media).
-- No update or delete policies.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'project_media_public_read') then
    create policy project_media_public_read on storage.objects for select using (bucket_id = 'project-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'project_media_anon_upload') then
    create policy project_media_anon_upload on storage.objects for insert with check (bucket_id = 'project-media');
  end if;
end $$;
```

**File path:** `{companyId}/{projectId}/plans/{planId}-{timestamp}.{webp|jpg|pdf}`. Every upload gets a new name, so a cache can never serve an old image.

**Pre-flight check** (read-only; run in the Supabase SQL editor before building):

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'properties' order by 1;

select id, public, file_size_limit, allowed_mime_types from storage.buckets;
```

### Code gate

- When the tab opens, probe `hasColumn('properties', 'floor_plans')`.
- If the column is missing:
  - Management sees a banner, "Floor plans need database update 0020", and Save is disabled.
  - Viewers see "No floor plans yet".

### Security notes

- **Anyone can upload to this bucket.** The anon key ships in the app bundle, so anyone who extracts it can upload files to `project-media`. This is the same exposure `wa-media` has today. The bucket's size and type limits bound the abuse.
- **Plan URLs are hard to guess but not secret.** If floor plans are confidential, they need a private bucket with signed URLs. That requires authentication work, which is out of scope: production authentication must not change.
- **SVG uploads are refused.** An SVG served from a public URL can carry script.
- **Unit codes and plan names are rendered as React text, never through `innerHTML`.** The sample's `innerHTML` list must not be ported.

---

## 7. Implementation map

| File | Change |
|---|---|
| `supabase/migrations/0020_floor_plans.sql` | **New.** Adds the column, the drift columns, and the bucket with its policies (§6). |
| `src/lib/supabase.js` | Map `floor_plans` ↔ `floorPlans` in `pToR` and `rToP`. Add a one-row fetch for a fresh property. Add `uploadProjectMedia(file, path)`, modeled on `waUploadMedia`. |
| `src/lib/db.js` | Add `patchPropertyChecked(id, cols)`. It PATCHes only the given columns, treats a stripped column as failure, and updates the local store only after the cloud accepts. |
| `src/lib/projects.js` | Default `floorPlans: []` in `toProject`. Add `findUnit`, `unitSize`, `unitPrice` and `isUnitLocked`. Make `projectInventory` count area with `unitSize`. Add `saveFloorPlan(projectId, plan, unitOps)` (fetch, merge, patch) and `deleteFloorPlan`. |
| `src/lib/deal.js` | `computeDeal` uses the unit's own size and price when the unit has them; the default offer rate becomes price ÷ size. |
| `src/lib/floorPlan.js` | **New, pure functions:** geometry (clamp, normalize, hit-test), the undo/redo stack, validation, next-code suggestion, image downscale, and PDF page rendering (dynamic `import('pdfjs-dist')`). |
| `src/components/project/ProjectCatalog.jsx` | Fix `regenUnits`: keep units whose codes don't follow *prefix + N*. Changing the count only adds or removes available units that follow the pattern. Warn before removing a type or unit that has a box on a plan. Exclude `floorPlans` from the catalog's save. |
| `src/context/AppContext.jsx` | Add `projTab` (`'list'` or `'units'`) and `planSel` (`{ projectId, planId }`). |
| `src/App.jsx` | Add the Available Units button before Add Property, the hero text and back link for the tab, and the Add/Edit floor plan button for Management. Mount the lazy `FloorPlanEditor`. |
| `src/components/views/PropertiesView.jsx` | Render `<AvailableUnitsView />` when `projTab === 'units'`. |
| `src/components/project/FloorPlanCanvas.jsx` | **New.** The shared SVG plan, with view and edit modes. |
| `src/components/project/AvailableUnitsView.jsx` and `.css` | **New.** The viewer. |
| `src/components/project/FloorPlanEditor.jsx` and `.css` | **New.** The editor modal. |
| `src/components/project/ProjectConsole.jsx` | Phase F4 only: accept a preselected unit for the "Make an offer" button. |
| `package.json` | Add `pdfjs-dist`, loaded only inside the editor. |

**CSS:** new class names use an `fp-` prefix and existing tokens only (`--green`, `--gold`, `--red`, `--surf`, `--bd2` and so on). Check both themes. No `!important`; the P1 clean-up removed most of them.

---

## 8. Phases

Each phase ends with:

- `npm run lint`
- `npm run build`
- a check in a browser against a mock Supabase (no real key) at 390 px and 1440 px
- a review before the next phase starts

| Phase | Scope | Visible result |
|---|---|---|
| **F0 · Foundations** | Write migration 0020 (the user applies it); converters; narrow patch with the stripped-column check; unit size and price helpers; inventory and deal math; the `regenUnits` fix. | None. Legacy units stop being reset by the catalog. |
| **F1 · Viewer** | The Available Units button and tab, and the read-only viewer. | Plans display, colored live by status. |
| **F2 · Editor** | Image upload; draw, move, resize and delete boxes; unit details; undo and redo; save and reopen. | Management can build and edit plans. |
| **F3 · PDF and housekeeping** | PDF page upload, replace image, the "Not on this plan" list, delete plan. | Full feature set from §1. |
| **F4 · Polish (optional)** | "Make an offer" from a unit into the project console; a floor-plan section inside the console; deep links; polygon shapes; copy a plan to another floor. | Faster sales flow. |

---

## 9. Acceptance checks

- [ ] The **Available Units** button sits immediately left of **Add Property**. Other roles see it on its own.
- [ ] Uploading a PNG, a JPG, a WebP and a PDF (choosing a page) each shows the plan.
- [ ] Draw a box; move it; resize it from every handle; delete it with the key and with the button.
- [ ] Name `SHOP-07`, type Shop, size 178 and a price are saved on the unit. A duplicate name is refused.
- [ ] Every action above can be undone and redone. Undo inside a text field still behaves normally.
- [ ] After Save and a page reload, the plan and its boxes are identical, and a second browser sees the same.
- [ ] Reopening, changing and saving again works.
- [ ] When all of a project's units are placed, the plan's Available, On hold and Sold counts equal that project's KPI strip.
- [ ] An agent holds a unit in the console, and its box turns gold for other viewers without a reload.
- [ ] Leaving the catalog's "# of units" field does not remove `SHOP-07`, or the units of a legacy project.
- [ ] A held unit's name and type are locked in the editor, and approving its hold still works.
- [ ] Without migration 0020, Save is disabled with a clear message. Nothing is ever saved only in the browser.
- [ ] Closing with unsaved changes asks first.
- [ ] Keyboard only: select boxes, open details, nudge, delete.
- [ ] At 390 px the page never scrolls sideways, and the plan pans inside its frame.
- [ ] The main JS chunk grows by only a few KB, because the editor and pdf.js load on demand.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Two managers edit the same project at once (last write wins) | Merging at save shrinks the window. A server-side jsonb merge function would close it; that is later work. |
| The catalog's save still overwrites unit statuses (G2) | Out of this feature's scope, but recommended as a separate fix. |
| Replaced or deleted plan images stay in Storage | Anonymous users can't delete files. Accept it for now, and clean up periodically later. |
| Very large drawings on low-end phones | Images are capped at a 3000 px long side. |
| The `properties` row grows | Small: the row holds only box coordinates and an image URL. |

---

## 11. Open questions (defaults assumed above)

1. **Public link:** should customers who are not logged in see plans? *Default: no.*
2. **Who edits:** can Team Leads edit plans? *Default: Management only, like Add Property.*
3. **Price entry:** total ৳, or ৳/sqft? *Default: total ৳, with ৳/sqft shown beside it.*
4. **Status in the editor:** should the editor change a unit's status? *Default: no. Holds, deals and the catalog own status.*
5. **Shape:** should angled shops get polygon outlines, like 504–506 in the sample? *Default: rectangles first, polygons in F4.*

---

## 12. Implementation notes (2026-10-08)

F0–F3 are built as planned, with these differences.

**What differs from the plan**

- **The Draw and Select tools split the work.**
  - In Draw (`B`), a press always starts a new box, even on top of an existing one. Neighbouring shops share walls, so a new box usually starts on the edge of the last one. Grabbing that box's resize handle instead would be wrong.
  - A click in Draw without dragging selects the box under the pointer.
  - Moving, resizing and the resize handles belong to Select (`V`).
- **Unit fields save as you type.** Name, size, price and the plan name don't wait for blur or Enter. Typing in one field counts as a single undo step until something else changes. The commit-on-blur design lost text when a user clicked another box before leaving the field.
- **New boxes take the type used last.** The first box in a project with no types creates "Shop" (or "Apartment" for a residential project).
- **`deal.js` is unchanged.** The console prices a deal from `pricedVariant(variant, unitId)` in `projects.js`, which applies the unit's own size and price. The offer boxes, cart and invoice all use it.
- **The tab is switched in `App.jsx` `PageBody`, not `PropertiesView`.** Both views are lazy pages, and the editor is a lazy overlay.
- **Inserts and ordinary updates of a property leave out `floor_plans`.** Only `patchPropertyChecked` writes it. This avoids a stale cached copy overwriting a newer plan, and avoids a retry on every insert before migration 0020.
- **The original PDF isn't stored.** Only the rendered page is uploaded as WebP (or JPEG where WebP can't be encoded). The plan keeps the file name and page number.
- **Files outside `src/` changed:**
  - `index.html`: seven new icon names in the font subset.
  - `netlify.toml`: serves `/assets/*.mjs` (the pdf.js worker) as JavaScript.
  - `package.json`: adds `pdfjs-dist` 6.4.

**Catalog fix (G1)**

- The `# of units` field now only adds or removes available units named *prefix + number*.
- It never removes units with other names, units on hold or sold, or units on a floor plan.
- Leaving the field unchanged, or empty, does nothing.
- Changing the prefix renames the available units that follow the old *prefix + number* pattern.

**Verified locally**

- Headless Edge ran against a mock Supabase. No real key was used and nothing reached production.
- Lint reports 0 problems, and the build passes.
- Upload: a 40-page brochure PDF (page picker, 3000 px render) and a PNG.
- Drawing: draw, move, resize, arrow-key nudge (one undo step), delete, undo and redo.
- Units: linking existing units (on hold and sold among them), adding a new type, and blocking duplicate names.
- Save: the image lands in Storage, only `floor_plans` and `variants` are written, and the plan comes back after a reload.
- Live updates: a hold placed elsewhere recolors its box.
- Catalog: a catalog save leaves the plans alone.
- Without migration 0020: Save is switched off and the data layer refuses to report success.
- Roles and layout: agents can view but not edit; the 390 px phone layout works, including drawing with a finger; the light theme works.

**Fixes from the independent review**

- `setUnitStatus` (holds, releases, sales, and hold approvals or rejections) now keeps a unit's own size and price. Before the fix, a hold reverted the unit to its type's size and rate. It also finds the unit by its code when the unit has moved to another type since the hold was requested.
- Saving a plan no longer re-normalizes codes nobody edited, so a catalog code such as `a3` stays `a3`. Codes are checked in the form they will be saved (`saveCode`), so `-` and `SHOP-1-` are caught before Save. Renames are applied in two passes, so a swap (A↔B) or a chain (A→B plus a new A) saves correctly.
- A unit with a price but no size, where its type has no size either, is refused. Without a size the console would price the deal at ৳0.
- `patchPropertyChecked` writes strictly (`sbUpdate(..., { strict: true })`). If a column is missing, nothing is written. Before the fix, the unit changes were written while the plan was not.
- Replacing the image adds to the current editor state, so edits made while the image was loading are kept.
- `mergeDB` always takes `floorPlans` from the cloud row, so a tab can't keep stale plans when its row ties the cloud's `updated_at`.

**Still open**

- Apply `supabase/migrations/0020_floor_plans.sql` in the Supabase SQL editor, then reload the app.
- **Whole-row writes of `variants`.** The catalog's Save (G2) and `setUnitStatus` still write their cached copy of all of a project's units.
  - Example: a stale tab places a hold after another manager's plan save has added or renamed units. That hold can undo those changes.
  - The boxes then show as "Not linked", and the editor can add those units back. Realtime normally keeps caches fresh, so this needs a tab that is out of date.
  - Fix: fetch the row, merge, and write only `variants`, as `saveFloorPlan` does.
- F4 is not built.
