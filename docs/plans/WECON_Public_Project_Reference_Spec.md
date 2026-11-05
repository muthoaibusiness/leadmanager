# WECON Public Project page: reference study and build spec

Status: exploration only, nothing built yet. Written 2026-11-02 on branch `feat/ai-trainer-mvp` (`c20cf45`).

Reference: <https://www.dhakaheights.com/project/dhaka-heights-mazumder-palace>, plus its list page <https://www.dhakaheights.com/projects>. Both were captured with headless Chromium at 1440 px and 390 px wide.

Screenshots:

- [project page, desktop](reference/dhakaheights/project-desktop.jpg)
- [project page, mobile](reference/dhakaheights/project-mobile.jpg)
- [projects list, desktop](reference/dhakaheights/projects-list-desktop.jpg)

## 1. Goal

Make our public project page (`#/p/<id>`) and portfolio (`#/p`) look and work like the reference. The page must carry the six things asked for:

1. Project images
2. Floor plan
3. Brochure
4. Available, booked and sold units
5. Interest form
6. Header and footer

The reference page itself shows only 1 and 5, plus header and footer. It has no floor plan, brochure or unit availability on screen. Its form says "request customized unit layouts or brochure", so those are handed out by request. We copy its look and layout, and add the floor plan, brochure and unit sections it lacks, using data the CRM already has.

## 2. What the reference page contains

Top to bottom on the project page (scroll height 2384 px at 1440 wide):

| # | Block | What is in it | Notes |
|---|---|---|---|
| 1 | Header | Logo + wordmark "DHAKA HEIGHTS / PROPERTIES LTD". Nav: Home, Concern ▾, Projects ▾, Media ▾, Career, About ▾, Contact ▾ | `position: fixed`, 80 px tall, dark navy. On mobile it becomes a right-side drawer with the same links grouped. |
| 2 | Hero band | Breadcrumb (Home > Projects > *name*), H1 project name, subtitle "Completed Prestige \| *address*", short gold rule | Navy background with a building photo faded in on the right. About 300 px tall. |
| 3 | Gallery (left, about 60%) | One large image (871×500) and 3 thumbnail buttons below it | Clicking a thumbnail swaps the large image. The first thumbnail repeats the cover image. |
| 4 | "At a Glance" card (right, about 40%) | Label/value rows with icons: Project Name, Status (green pill "COMPLETED"), Location, Project Type, Floors, Land Area, Height, Unit Sizes, Parking | A white card with a gold top border. Only rows with data are worth showing. |
| 5 | Project Overview (left) | 2 paragraphs of description | White card. |
| 6 | Request Callback (right) | Helper line, then Name *, Phone *, Email, Message, and a **SUBMIT INQUIRY** button | Has a hidden off-screen honeypot input for bots. Max lengths: name 120, phone 40, email 254, message 2000. The form has no `action`; it is submitted by JavaScript. |
| 7 | Footer | Logo + one-line tagline + 4 social icons. Columns: Properties (Ongoing / Completed / Upcoming / Features / Safety), Corporate Links, Corporate Office (address with map link, hotline `tel:`, email `mailto:`, web). Bottom bar: copyright + "Developed by" | Dark navy. |

On mobile (390 px), everything stacks in this order: header, hero, gallery, overview, At a Glance, form, footer.

The projects list page has the same header, hero ("Our Properties") and footer. Between them is a filter sidebar (Status, Category, Location, Size) and a 3-column grid of cards with pagination. Each card shows: photo, status pill (Ongoing / Upcoming / Completed), location in small gold caps, name, size in sft, and type.

Visual system:

| Token | Reference value |
|---|---|
| Header, hero and footer background | navy `#0B1B3D` (also its `theme-color`), dark band `#051026` |
| Accent | gold `rgb(197,168,128)` (`#C5A880`), used for rules, breadcrumb, button and card top borders |
| Page background | off-white with a faded skyline image behind the content |
| Headings | Playfair Display (serif) |
| Body | Manrope (sans) |
| Cards | white, small radius, soft shadow, 3 px gold top border |

Our app has its own theme tokens (`--bg`, `--accent`, ...). The public page should get a small token set of its own (navy, gold, serif) so it can carry the WECON brand without changing the CRM's look.

## 3. What our CRM already has

Read-only queries against live Supabase, 2026-11-02.

### 3.1 Where each piece of data lives

| Need | CRM source | Live coverage |
|---|---|---|
| Name, address, type, handover | `properties.name`, `address`, `purpose`, `handover` | 11 projects; 9 have an address |
| "At a Glance" facts | `properties.storeys`, `land_area`, `size_text`, `facing`, `total_units`, `handover` | **Almost empty.** Only SHAFIQ SAPPHIRE has storeys, land area and size. |
| Overview text | `properties.details` | **0 of 11** filled |
| Project images | `properties.media.images` (Catalog, first image = cover); legacy `properties.images` | **1 of 11** (WECON MOMTAZ MANOR) |
| Brochure | `properties.media.docs` | **0 of 11** |
| Floor plan with unit boxes | `properties.floor_plans` | 3 of 11 (CITIZEN AVENUE MALL 8 plans, JM HERITAGE MALL 15, SHAFIQ SAPPHIRE 1) |
| Units with status | `properties.variants[].units[]`, `status` = available / hold / sold, plus custom statuses in `unit_statuses` | **11 of 11** |
| Interest form target | `leads` table (source `WEBSITE` exists in `SRC_LABELS`) | No public path today. See 3.3. |

Unit counts per project (variants × units):

| Project | Units | Available | Hold (= Booked) | Sold |
|---|---|---|---|---|
| CHAIRMAN PALACE | 48 | 27 | 2 | 19 |
| CITIZEN AVENUE MALL | 270 | 270 | 0 | 0 |
| JM HERITAGE MALL | 146 | 113 | 0 | 33 |
| SHAFIQ SAPPHIRE | 16 | 16 | 0 | 0 |
| WECON AHMED NORTHDALE | 8 | 7 | 0 | 1 |
| WECON DAKSHINAYAN | 8 | 4 | 1 | 3 |
| WECON JAFAR MANOR | 13 | 8 | 5 | 0 |
| WECON MOMTAZ MANOR | 13 | 7 | 4 | 2 |
| Wecon Nuznan | 8 | 4 | 4 | 0 |
| WECON OSMAN BELLEVUE | 8 | 4 | 4 | 0 |
| WECON SOUTHDALE | 9 | 5 | 1 | 3 |

Unit availability is the strongest data we have. Every project can show it today. Only 3 projects can show it on a floor plan, so the page needs a unit grid that works without a plan.

### 3.2 The media gap, and where the media actually is

The WhatsApp bot's `wa_projects` table already holds most of the marketing media:

| | wa_projects (12 rows) |
|---|---|
| Brochure URL | 11 |
| Photos | 11 |
| Floor-plan images | 7 |
| Google Map URL | 11 |
| Video | 3 |

Only **4** `wa_projects` names exactly match a `properties` name: Shafiq Sapphire, Wecon Dakshinayan, Wecon Nuznan, Wecon Osman Bellevue. Others are the same project under a different name, such as "Wecon South Dale" vs "WECON SOUTHDALE", or "Wecon JM Heritage Mall" vs "JM HERITAGE MALL". Some exist on one side only.

`wa_projects` is bot configuration. Migration 0055 (not yet applied) revokes anon access to it, so the public page must not read it directly. Two ways to close the gap:

- **A. Copy once into the Catalog (recommended).** For each project, copy the bot's photos and brochure URL into `properties.media.images` / `media.docs`, using a reviewed name mapping. The Catalog stays the single source the public page reads. Admins edit media in one place.
- **B. Link the tables.** Add `properties.wa_project_id` and have a server-side view expose only public media columns. This keeps a live link, but adds a join and a second place to edit.

Both need a human to confirm the name mapping. The Catalog's photo upload is also unfinished (`ProjectCatalog.jsx`: "TODO: uploads held in-memory — wire to real file storage"). That must be wired to the `project-media` bucket before admins can add images themselves.

### 3.3 The interest form has no safe public path yet

The reference posts a form with name, phone, email and message. Our app has no public write path for leads:

- Today the `leads` table is open to anon only because RLS is off. Migration 0055 revokes anon from `leads`, as it should. A public page must **not** write `leads` with the anon key. That would let anyone insert, read or overwrite leads.
- `src/components/landing/DemoForm.jsx` has no backend. It only shows a success message.
- No Edge Function creates a lead from the web. Bots write leads with the service role key.

So the form needs a new Edge Function, for example `public-inquiry`, holding the service role key server-side. It must:

1. Accept only `{ projectId, name, phone, email?, message?, honeypot }`. Validate lengths as the reference does (120/40/254/2000) and normalise the phone with `src/lib/phone.js` rules.
2. Drop the request quietly when the honeypot is filled, and rate-limit by IP and by phone.
3. Look up the project by id. Only a project with `public_published = true` may receive an inquiry, and its `company_id` is copied onto the lead.
4. De-duplicate by phone within the company: if the lead exists, log a NOTE activity on it instead of creating a second lead.
5. Insert the lead with `source = 'WEBSITE'`, `status = 'NEW'`, `property_interest = <project name>`, plus a `CREATED` activity row. That matches `addLeadFn`.
6. Return only `{ ok: true }`. Never echo lead data back to the browser.

Lead assignment is a business choice we have not made. Options: unassigned for a manager to pick up, round-robin, or a fixed account. The first brief also ruled out "lead capture" and "agent assignment". This form is lead capture, so it needs the product owner's go-ahead.

## 4. Proposed page, mapped to our data

Same block order as the reference, with three added sections (marked **new**).

| Block | Content and data | Shows when |
|---|---|---|
| Header | WECON logo + wordmark. Links: Projects (`#/p`), the company website, Contact (scrolls to the form), "Call" button (`tel:` hotline). Sticky. Drawer on mobile. | Always |
| Hero band | Breadcrumb Projects > *name*. H1 name. Subtitle "*handover* \| *address*". Status pill from unit counts: "Ready", "Selling", or "Sold out" when no units are available. | Always |
| Gallery | Large image + thumbnails from `media.images`. Tap or arrow keys to swap; swipe on mobile. | `media.images` not empty. Otherwise a branded placeholder, never a stock photo. |
| At a Glance | Rows from `purpose`, `address`, `handover`, `storeys`, `land_area`, `size_text` / variant size range, `total_units`, `facing` | Each row only when its field has data |
| Overview | `properties.details` | Only when filled |
| **Units (new)** | Counts: Available n, Booked n, Sold n. Filter chips. A grid of unit tiles grouped by variant, each showing code, size and status as text **and** colour. Booked and sold tiles are disabled. Tapping an available tile opens its details (type, size, price if set) with an "I'm interested in this unit" button that fills the form. | Always (all 11 projects have units) |
| **Floor plan (new)** | The existing `FloorPlanCanvas` with floor tabs. Same selection rules as the unit grid. | `floor_plans` not empty (3 projects today) |
| **Brochure (new)** | PDF card with View (new tab) and Download | `media.docs` not empty. Otherwise "Ask for the brochure" pointing to the form. |
| Interest form | Name *, Phone *, Email, Message; prefilled "Interested in unit X" when chosen from the grid; honeypot; consent line; SUBMIT. Success and error states. | Only once the `public-inquiry` function exists (see 3.3) |
| Footer | Logo + tagline, Projects column (links to `#/p` and each published project), contact column (office address with map link, hotline, email, website), copyright | Always |

Portfolio page (`#/p`): same header, hero ("Our Projects") and footer. Grid of cards: cover, status pill, location, name, unit sizes, "Available: n units". Filters are only worth adding for fields we fill reliably. Today that is just `purpose`, so start with none.

### Company details for header and footer

The reference hard-codes its company contacts. We have no CRM table for company branding: `companies` has only `id, name, plan, is_active`. The logo, hotline, email, office address and social links must come from somewhere. Two ways:

- A static `PUBLIC_BRAND` object in one module. Fastest; a code change to edit.
- Brand columns on `companies`, or a `company_profile` row, edited in Admin > Public Project. Needed if more than one company will publish.

`wa_projects.office_address` and the bot settings may already hold the office address and hotline. Confirm before typing them in again.

## 5. What exists already, and the gaps

Built on `c20cf45`: `#/p` portfolio grid, `#/p/<id>` page (header facts, brochure list, `FloorPlanCanvas` unit map, unit detail panel), Admin > Public Project tab (publish toggle, preview), the `public_published` gate with its server-side trigger (migration 0059, **not applied to live**).

| Gap | Size | Blocked by |
|---|---|---|
| WECON site chrome: header, hero band, footer, brand tokens, serif font | M | Company contacts (section 4) |
| Gallery from `media.images` | S | Photos in the Catalog (3.2) |
| At a Glance card with conditional rows | S | Fields mostly empty. Works, but sparse until filled. |
| Unit grid without a floor plan, with filters | M | none |
| "Interested in this unit" handoff to the form | S | Form |
| Interest form + `public-inquiry` Edge Function | L | Scope sign-off, assignment rule, rate limiting (3.3) |
| Catalog photo/brochure upload to Storage | M | none |
| One-time media copy from `wa_projects` | S | Reviewed name mapping |
| SEO: `<title>`, description, Open Graph image per project | S | The SPA renders on the client. Social previews need prerendering or an Edge Function serving meta tags. Hash URLs (`#/p/...`) are not indexed. |
| Apply migrations 0059 and the 0054/0055 lockdown | ops | Owner |

## 6. Decisions needed before building

1. **Interest form: in scope?** It is lead capture, which the first brief excluded. If yes, who gets the new lead?
2. **Media source:** copy `wa_projects` media into the Catalog once (A), or link the tables (B)?
3. **Brand details:** logo file, hotline, email, office address, social links, website URL. And are they fixed (static) or per company?
4. **Prices on the public page:** `unitCard` shows a price when the unit or variant has one. Should the public see prices, or only on request?
5. **URLs:** keep hash routes (`#/p/<id>`), or move to path routes (`/projects/<slug>`) for search engines and link previews? Netlify already rewrites `/*` to `index.html`, so path routes are possible.

## 7. Suggested build order

1. Brand tokens, header, hero band and footer, shared by `#/p` and `#/p/<id>`.
2. At a Glance card, unit summary counts and the unit grid (works for all 11 projects now).
3. Gallery and brochure sections, with good empty states.
4. Catalog upload to Storage, then the media copy from `wa_projects`.
5. Interest form + `public-inquiry` Edge Function, after decision 1.
6. Apply migration 0059. Publish one project, then test signed out at 390 px and 1440 px.
