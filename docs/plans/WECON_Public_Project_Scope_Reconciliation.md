# WECON Public Project: scope reconciliation and minimal plan

Status: documentation only. No application code, database, migration or production data was changed. Nothing is committed.

Written 2026-11-02 against branch `feat/ai-trainer-mvp` (`c20cf45`). This reconciles [WECON_Public_Project_Reference_Spec.md](WECON_Public_Project_Reference_Spec.md) with the original scope.

A static HTML prototype of the result is in [demo/public-project/](demo/public-project/index.html). See section 6.

## 0. Scope, as fixed for this phase

In scope:

1. Public project portfolio
2. Individual project detail pages
3. Project images and other available media
4. Interactive unit status grid
5. Floor plans, when available
6. Brochure, when available

Out of scope for now: lead capture, inquiry or callback forms, agent assignment, analytics, payment.

## 1. Scope conflicts and required corrections

| # | Where in the reference spec | Conflict | Correction |
|---|---|---|---|
| C1 | §1 item 5, §2 row 6, §3.3, §4 "Interest form" row, §5 form row, §7 step 5 | The interest form is lead capture. | Remove the form, the `public-inquiry` Edge Function, de-duplication, rate limiting and the lead-assignment question from this phase. Keep §3.3 only as a parked note for a later phase. |
| C2 | §4 Units row: "I'm interested in this unit" button that fills the form | The button feeds lead capture. | Drop it. Selecting an available unit only shows its details. |
| C3 | §4 Header: "Call" `tel:` button; §4 Brochure empty state: "Ask for the brochure, pointing to the form" | A call button is fine as static contact text, but "ask for the brochure" points to the form. | Show plain contact details in the footer, with no call-to-action button in the header. The brochure empty state says "No brochure published yet." |
| C4 | §4 "Company details for header and footer": brand columns on `companies` or a `company_profile` row, edited in Admin | That adds a new admin feature and schema to a public-page task. | Use one static `PUBLIC_BRAND` constant (name, logo, office address) for this phase. Revisit only if a second company publishes. |
| C5 | §5 SEO row, §6 decision 5: path routes, prerendering, Open Graph per project | Not in scope, and needs hosting changes. | Keep the `#/p` and `#/p/<id>` hash routes already built. Park SEO. |
| C6 | §3.2 option B: `properties.wa_project_id` + server view | A schema change plus a live dependency on bot configuration. | Choose option A (one-time copy into the Catalog) or neither. See D2. |
| C7 | §4 Portfolio: status pill "Ready / Selling / Sold out" from unit counts | Fine, but must not invent a stage. The CRM has no project-stage field beyond `handover`. | Show the handover text as given ("Handover 2026", "Ready") and "Sold out" only when no unit is available. Never invent "Ongoing" or "Completed". |

New issues found while checking the live data and the built code. These are corrections to the **existing** build (`c20cf45`), not just to the spec:

| # | Issue | Correction |
|---|---|---|
| C8 | **Private data leak.** `loadPublicProject` calls `sbGetPropertyRow`, which runs `select *` with the public key. The browser receives every unit's hold metadata. Live: 5 units carry `clientName`, `clientId`, `heldBy`, `heldByName`, `holdUntil` or `note`, plus `floorRate`, `listRate` and `company_id`. The page doesn't display them, but anyone can read them in the network tab. | The public page must read a server-side projection with whitelisted columns only, never `select *`. See §3. |
| C9 | The detail page shows a **price** (`unitCard` derives it from `unit.price` or `listRate × size`). 2 of 22 variants have a list rate, 3 units have a price. | Showing prices publicly is a business decision (D3). Until it is made, hide price. The demo hides it. |
| C10 | The public gate `public_published` exists only in migration 0059, which is not applied. On live, every project currently reads as "not published", and the toggle fails. | Apply 0059 before any public launch (§3). |
| C11 | The pending lockdown (migration 0055) revokes **all** anon access to `properties` and `wa_projects`. After it, the current public pages stop working entirely: anon gets no rows. | The public read path must not depend on anon table access. See §3, item S2. |
| C12 | `media.images` holds photos for 1 of 11 projects; `media.docs` holds no brochures. The Catalog upload stores photos in browser memory only ("TODO: uploads held in-memory"). | Media must come from somewhere real before launch (D2). Empty states are required either way. |
| C13 | One bot photo set (JM HERITAGE MALL) is Google Drive "download" links with a session token. They return 200 to a plain request but don't render in Chromium. | Drive download links are not usable as public images. Re-host them in the `project-media` bucket. |

## 2. Minimal implementation plan

Reuse what `c20cf45` built: `#/p` (`PublicPortfolio.jsx`), `#/p/<id>` (`PublicProjectView.jsx`), `publicProjects.js` (status normalisation, `planBoxes`, `unitCard`), `FloorPlanCanvas`, and Admin > Public Project with its publish toggle and preview.

Steps, in order:

1. **Safe public read (security first).** Add the server-side projection in §3 (S1/S2). Point `loadPublicPortfolio` and `loadPublicProject` at it, replacing `sbGetPropertyRow`'s `select *`. The client receives only public fields.
2. **Hide price** in `unitCard` / the detail panel until D3 is decided.
3. **Unit status grid that works without a floor plan.** Group the grid by variant: code, size, status as text and colour, filter chips (All / Available / Booked / Sold) with counts. Booked and sold units are `aria-disabled` and never open details. All 11 projects have units, but only 3 have a CRM floor plan, so this is the main "interactive" element.
4. **Detail layout and shared chrome** in the reference style: one static `PUBLIC_BRAND` header, hero band (breadcrumb, name, handover and address), gallery, an "At a Glance" card that shows only rows with data, and the footer (portfolio links, office address).
5. **Media sections:**
   - Gallery from `media.images`; branded placeholder when empty.
   - Floor plan: `FloorPlanCanvas` when `floor_plans` exists, otherwise "No floor plan published yet".
   - Brochure: `media.docs`, with View and Download.
6. **Portfolio cards:** cover image or placeholder, address, name, availability bar, "n of N units available", type, size range.
7. **Media backfill (only after D2):** a one-off, reviewed script copies bot photos, brochure and plan images into `media.*` for the matched projects, re-hosting Drive links (C13). This is a production data write, so it needs explicit approval at the time.

Out of this plan: the form, an Edge Function for leads, SEO, brand-settings UI, Catalog upload rework (unless D2 picks it).

## 3. Required migrations and security dependencies

| ID | Item | Why | Status |
|---|---|---|---|
| M1 | Apply `0059_public_project_publish.sql` | Adds `public_published` and its publish guard trigger. Without it nothing can be published. | Written, tested in PGlite (7/7). **Not applied to live.** |
| S1 | New migration: a read-only public projection, e.g. `public.public_projects` view or `security definer` RPC `public_project(id)` + `public_projects()` | Returns only published rows and only whitelisted fields: id, name, purpose, address, handover, storeys, land_area, size_text, facing, `media.images`, `media.docs`, floor plans **without** `updatedBy`, and units reduced to `{id, size, status}` with custom statuses resolved to available / booked / sold. No client, holder, note, rate or price fields. Fixes C8. | Not written |
| S2 | Grant `execute` (RPC) or `select` (view) on S1 to `anon`, and nothing else | 0055 revokes anon from `properties` (C11). S1 must be the only anon-readable path to project data. A `security definer` function owned by a role that can read `properties` keeps working after 0055. | Not written |
| S3 | Order of applying | Apply M1 and S1/S2, switch the client to S1, verify, then apply 0054/0055. Applying 0055 before S1 breaks the public pages. | Plan |
| S4 | Storage bucket `project-media` | Already public-read (migration 0021). Images and brochures served from it need no extra grant. Confirm anon cannot list or overwrite files: 0021 says anon insert only, unique paths. | Exists; confirm |
| S5 | Image and link hygiene | Render only `https://` URLs. Brochure and map links open with `rel="noopener"`. No `javascript:` or `data:` URLs. Escape all CRM text. | Built into the demo; carry over |

No migration is needed for the grid, gallery, plans or brochure themselves; they use existing columns.

## 4. Acceptance tests

Each is exact and checkable. "Signed out" means a fresh browser profile with no session.

Portfolio (`#/p`):

1. Signed out, `#/p` loads with no login prompt and no CRM shell.
2. With exactly projects A and B published, the page shows exactly 2 cards, A and B, and the count line says 2.
3. With no project published, the page shows the empty state, not an error.
4. Each card links to `#/p/<its id>`; clicking it opens that project's page with the matching H1.
5. A project with no photo shows the branded placeholder; no broken-image icon anywhere on the page.
6. At 390 px and 1440 px wide: no horizontal scroll (`scrollWidth <= innerWidth`).

Detail (`#/p/<id>`):

7. Signed out, a published project loads. An unpublished or unknown id shows "not found / not published" with a link back to `#/p` and shows no project data.
8. "At a Glance" lists only rows whose source field is non-empty; there are no blank values and no "N/A".
9. The unit grid shows every unit of the project. The counts on the All / Available / Booked / Sold chips equal the database counts for that project, after custom statuses resolve to their base.
10. Clicking an available unit opens a panel showing its code, type and size. Clicking a booked or sold unit, including a forced click, leaves the panel unchanged.
11. Booked and sold units carry `aria-disabled="true"`. Every unit shows its status as text, so it does not rely on colour alone.
12. The "Sold" filter hides every available and booked unit; "All" restores them.
13. A project with CRM floor plans renders `FloorPlanCanvas` with a tab per plan; available boxes are focusable and Enter or Space selects them; booked and sold boxes are not focusable.
14. A project with no floor plan shows "No floor plan published yet".
15. A project with a brochure shows View (opens in a new tab) and Download; with none it shows "No brochure published yet".
16. No price appears anywhere until D3 is decided.

Security:

17. For a published project, the network responses received signed out contain none of these strings: `clientName`, `clientId`, `heldBy`, `heldByName`, `holdUntil`, `note`, `floorRate`, `listRate`, `price`, `company_id`, `updatedBy`.
18. Signed out, requesting an unpublished project's id through the public read path returns nothing.
19. After 0054/0055 are applied, `GET /rest/v1/properties` with the anon key returns no rows or 401/403, and the public pages still work.
20. As a non-admin signed-in user, setting `public_published` fails with "only an admin can publish or unpublish a project". As an admin it succeeds. Already covered by `scripts/test-0059.mjs` in PGlite; must also pass on live after M1.
21. The page contains no form, no lead endpoint call, no analytics script and no payment link.

Regression:

22. CI (`ci-asad-dev.yml`) stays green; `node --test src/lib/publicProjects.test.js` and `node scripts/test-0059.mjs` pass.

## 5. Decisions that genuinely block implementation

Only these block work. Everything else has a default above.

| ID | Decision | Blocks | Default if not answered |
|---|---|---|---|
| D1 | Approve the server-side public read (S1/S2) and the order: M1 + S1/S2 before the 0055 lockdown. | Launch. The current page leaks hold metadata (C8) and dies after 0055 (C11). | None: this must be decided. |
| D2 | Media source: (a) one-time copy of bot media into the Catalog, re-hosting Drive links, (b) admins upload through the Catalog (needs the upload wired to Storage), or (c) launch with only what the Catalog has today: 1 project with photos, 0 brochures. | Images and brochures having real content | (c), with empty states |
| D3 | Show unit prices publicly? | Price display only | Hidden |
| D4 | Brand content for the static header and footer: logo file, display name, office address(es). The bot data has one office: "687 Mehedibag, Chattogram 4203". | Header and footer content | Text wordmark "WECON Properties" + that office address |

Not blocking, parked for later: inquiry form and lead assignment, SEO and path routes, per-company brand settings, hotline, email and social links.

## 6. Static demo

[demo/public-project/index.html](demo/public-project/index.html) is a single static HTML file and [demo/public-project/data.js](demo/public-project/data.js) is a read-only snapshot taken 2026-11-02. Nothing in it is wired to the app or the database.

- The snapshot was built with a whitelist: the generator refuses to write if any of `clientName`, `heldBy`, `holdUntil`, `note`, `floorRate`, `listRate`, `price`, `company_id`, `updatedBy` appears. The demo shows no prices.
- It shows **all 11** projects (no publish flag on live yet) and labels media taken from `wa_projects` as **from bot**: 8 of 11 projects matched by name; CHAIRMAN PALACE, WECON AHMED NORTHDALE and WECON JAFAR MANOR did not.
- Run it: `cd docs/plans/demo/public-project && python3 -m http.server 8090`, then open <http://localhost:8090/#/p>.
- Checked with headless Chromium at 1440 px and 390 px: 19 of 19 checks passed. They cover:
  - 11 cards and no horizontal scroll at either width;
  - available units open details, while sold and booked units (even with forced clicks) do not;
  - status as text, and booked units `aria-disabled`;
  - the Sold filter;
  - floor plan boxes render, and the brochure section is present;
  - no private field names in the rendered page, and no page errors.
- Known limits: it is a snapshot, not live data. Bot media is shown so the layout can be judged with real photos; it is not in the CRM yet (C12). The floor-plan view is a simplified SVG, not `FloorPlanCanvas`.
