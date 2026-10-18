# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WEPRO CRM — a real-estate lead/sales CRM. React 19 SPA (Vite), no backend of its own: it talks directly to Supabase over PostgREST with the anon key. The app lives in `leadmanager/` (this directory is the npm project root).

## Setup

Frontend `src/` is plain `.jsx`/`.js` — no TypeScript.

Requires a `.env` (copy `.env.example`): `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Without them cloud sync is disabled (the app logs a config error and runs on the local cache only).

Supabase schema changes live in `supabase/migrations/*.sql` (applied manually to the project). Edge Functions (WhatsApp relay and bots) are documented in `supabase/functions/CLAUDE.md`. Migration numbers are referenced by comments throughout `src/lib/` (e.g. "migration 0010 adds the `talked` flag") — when touching a feature gated on a column, check whether the code has a pre-migration fallback.

## First login

Seed data is intentionally empty (`src/lib/seed.js`). On a completely empty dataset (empty cache **and** empty cloud), `migrateTenancy()` mints a single built-in Master account — `master@wepro.com` / `1234` — to bootstrap the first company. Real data lives in Supabase.

## Architecture

### Data layer — the core to understand first

There is no ORM or Supabase client library. `src/lib/supabase.js` is hand-rolled REST against PostgREST (raw `fetch`, anon key, `snake_case ↔ camelCase` row converters named `rToX`/`xToR`). `src/lib/db.js` (~2400 lines) is the in-memory + localStorage store and every domain mutation.

- **Local-first, cloud-authoritative.** `getDB()` returns a singleton `_DB` hydrated from `localStorage` (key `propcrm_v2`). The UI renders synchronously from this cache on first paint; `hydrateFromCloud()` (in `App.jsx`) then fetches from Supabase underneath and reconciles via `mergeDB()`. Writes go to memory + localStorage immediately and push to the cloud in the background.
- **`mergeDB()` has subtle, deliberate rules** — read its comments before changing it. Leads: cloud is source of truth, local-only leads kept only within a 6h grace window. Users/teams: cloud-authoritative (no `updatedAt`, so a stale local copy must not win). Tombstones (`deletionLog`) prevent deleted rows resurrecting from another device. `r.leads === undefined` ("cloud not asked") is distinct from `[]` ("cloud has none").
- **`persistLocal()` degrades under quota.** localStorage is ~5MB; the full dataset can exceed it, so saves try progressively trimmed snapshots (drop activities, then property media, then bookings/notifs) rather than throwing. A trimmed cache only costs a reload round-trip because the cloud is authoritative. Use `saveDBDeferred()` (idle-callback write) on hot paths, `saveDB()` for synchronous needs.
- **Leads are NOT in the boot snapshot.** The leads and activities tables grow without bound, so `sbLoad()` deliberately omits them. Lists page through the server (`queryLeads`/`LeadsView`), KPI cards use count queries (`countLeads`), and views that aggregate over the whole book (pipeline, reports, calendar, agent performance) pull it on mount via `ensureLeadBook()` / the `useLeadBook` hook. `db.leads` is just a cache of what has been looked at.
- **Realtime:** `sbSubscribeAll()` opens a websocket across ~10 tables (deferred past first paint via `requestIdleCallback`); `applyRealtimeEvent()` folds changes into `_DB` and re-checks tenant scope client-side.

### Lead query translation — keep two files in step

`src/lib/leadQuery.js` builds PostgREST predicates (the SQL twin of `getLeads()` in `db.js`). The list page's query and the KPI card's count **must** compute the same set two ways — if `leadWhere()` and `getLeads()` drift, a page of results stops matching its own count. The `KPI` map has one entry per clickable dashboard card for exactly this reason. All predicates go through one `and=(...)` logic tree (PostgREST allows only one top-level `or=`).

### Multi-tenancy

Every team/user/lead/property carries a `companyId`. `sbLoad()` scopes reads by company (and by team for a Team Lead, by self for an agent). The cached snapshot holds **one company's** rows, so `OWNER_KEY` tracks which account it belongs to — handing it to a different account is a data leak, and `hydrateFromCloud()` clears the cache if `cacheBelongsTo()` is false. MASTER is the one unscoped role (sees all companies). `migrateTenancy()` backfills these fields on pre-tenancy data.

### Roles & access

`src/lib/constants.js` defines the model:

- Roles: `AGENT`, `TEAM_LEAD`, `MANAGEMENT`, `MASTER` (super-admin over all companies), `EXECUTIVE`. `AGENT` replaced `INITIAL_AGENT` + `MEETING_AGENT` (migration 0020); loaders pass roles through `normRole()` so pre-migration rows still read as `AGENT`.
- `canSee(user, key)` gates nav/features. A user's saved `allowedFeatures` array, when present, **fully overrides** role defaults (`NAV_SCOPES`). Profile is always visible.
- `EXECUTIVE` is a blank-canvas role (zero default access); `effectiveRole()` resolves it to `AGENT` (so it decides which dashboard renders) but never to a supervisory role — an Executive can't gain TL/MGMT powers by accident.
- `isNiHandler()` — an account flagged `ni_only` sees only `NOT_INTERESTED` leads; such leads auto-transfer to it.
- Lead lifecycle is the single `STATUS_FLOW` ladder; funnels and "reached stage X?" helpers (`reachedFrom`, `PAST_CONTACT`, etc.) all derive from it. Keep stage vocabulary in this one place.

### Lead status changes — always logged

A lead's status is only ever changed by the status writers in `db.js`: `changeStatus`, `setMeeting`, `schedVisit`, `doneVisit`, `closeDealFn`, `markLostFn` (`moveLead` and pipeline drag-and-drop go through `changeStatus` / `closeDealFn`). Each one writes an `activities` row: `STATUS_CHANGE`, or `DEAL` for won/lost. A new status path must go through one of these, or log the same row itself. Those rows are the only record of *when* and *by whom* a status moved, so a status write that skips them is invisible to the funnel and to the Home "Prospects contacted" card.

- Anything outside the app that changes `leads.status` (WhatsApp bots, n8n, imports, Edge Functions) must insert the same row: `type = 'STATUS_CHANGE'`, the acting person's `user_id` (rows with `user_id = 'system'` are ignored), and `company_id` set (the tracker is tenant-scoped by it).
- Don't rename the `STATUS_CHANGE` / `DEAL` / `FOLLOW_UP` activity types or the `NEW` status; the tracker matches them by name.
- **Prospects contacted** (Management Home, `dashboards/ContactTracker.jsx`) counts **updates**, not prospects: every `STATUS_CHANGE`, `DEAL` and `FOLLOW_UP` row a person wrote in the window adds 1 (two updates on one prospect add 2), except on prospects that are `NEW` now, which are left out entirely. `FOLLOW_UP` rows come from `setFollowUpFn`, `setFollowUpAt`, `clearFollowup`, `rescheduleMeeting` and `logNoAnswer`'s scheduled retry. "No Answer" is not a status: `logNoAnswer` leaves the lead `NEW`, so a New lead's unanswered calls are not counted. The default window is the exact last 24 hours. The rule (and the `COUNTED` type list) lives in `src/lib/contactPerf.js` alone; its data comes from `loadLeadUpdates` → `sbLoadLeadUpdates` (only the counted types and six columns, so the card never waits on the 60-day `ensureActWindow` load), merged with `db.activities` for live updates.

### WhatsApp chat

`src/lib/wa.js` mirrors supabase.js conventions (raw REST, row converters, own realtime socket). The client **never** holds the Wasender API token — outbound sends POST to a server-side relay (Supabase Edge Function `wa-send` or n8n) whose URL comes from the `wa_settings` row; the relay holds the credential. Chat access is granted by the `wa_settings` allow-list / an explicit `allowedFeatures` grant, **not** by role (`waCanChat()`), which is why `conversations: []` in `NAV_SCOPES` and the view is exempted from the role-based redirect in `App.jsx`.

### UI structure

- `src/App.jsx` — root. `PageHero`/`PageBody` switch on `view`; `PageBody` picks the dashboard by `effectiveRole()`. Boot logic (warm-cache vs cold-fetch paths) lives in the mount effect — read the `needsBootFetch` / `enterApp` / `hydrateFromCloud` comments before touching login/boot.
- `src/context/AppContext.jsx` — single global context (`useApp()`): current `user`, `view`, all filter state, modal routing (`openModal`/`modal`), `impersonate()` (admin account switch that never changes the stored session), and `dbVersion`/`refreshDB()` (bump a counter to force re-render after a mutation).
- `src/lib/` holds all domain logic (agent performance, funnels, deals, quotas, rollups, projects, push). Keep business logic here, not in components.

### Navigation & history

There is no router. The page on screen is AppContext state (`view`, `projTab`, the `agentFilter`/`teamFilter` drill-down). `src/hooks/useNavHistory.js` mirrors that state into `window.history` (URLs like `#/leads`, `#/properties/units`), so browser Back/Forward, reload and pasted links work.

- **Pages push, tabs replace.** Changing the page key (`pageKey()` in `src/lib/navHistory.js`) pushes a history entry. Tabs, filters, search and sort only update the current entry (debounced `replaceState`). Keep navigating through the existing setters (`nav()`, `setView`, …): the hook observes state, so callers need no history code.
- **Per-page state that should survive Back or a reload** uses `useNavState(key, init)` (`src/hooks/useNavState.js`) instead of `useState`. Keys are app-unique (`'leads.page'`), and values must be structured-cloneable. `PageBody` is keyed by the history entry id, so a page remounts per entry and reads its saved state on mount. Beware of reset-on-mount logic such as `useChanged(...) && setPage(0)`: it would wipe restored state. LeadsView keys its page reset on a stored query instead.
- **Overlays** (modal, lead panel, notifications, phone drawer) get a guard entry above their page. Browser Back closes the top one by dispatching Escape, so each form's discard guard (`useDiscardGuard`) still asks before dropping input.
- **Redirects** (a view the account may not see) go through `replaceView()`, which replaces the entry instead of pushing one. `homeView(user)` is the fallback home page.
- **The top header bar** holds the page's navigation. `<BackButton />` (round ←) returns to the previous entry in this tab; with none (direct link, fresh sign-in), it goes to the page above (`parentOf()`), and it is hidden on home. Next to it, `ui/bellows-crumb.jsx` shows the trail from `trailOf()` (Dashboard › Projects › Available Units) and fills the free length of the bar. An ancestor crumb opens that page as a new entry. When the trail outgrows its room (phones), ancestors fold into slivers that open on hover or focus. Page titles, Back labels and crumbs share `VIEW_TITLES`.
- The history store is module-level state in `useNavHistory.js` (one app, one history), so render code never reads refs, which react-hooks lint forbids.

### Conventions

- The header lead count is published by `LeadsView` into `leadCounts` context (not recomputed in the header) so the number always agrees with the table beneath it.
- Mutations: call a `db.js` function that mutates `_DB`, persists, and pushes to the cloud, then `refreshDB()` to re-render.
- `requestIdleCallback` is used to keep expensive work (localStorage writes, opening the realtime socket) off the first-paint path.
