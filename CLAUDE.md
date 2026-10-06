# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WEPRO CRM — a real-estate lead/sales CRM. React 19 SPA (Vite), no backend of its own: it talks directly to Supabase over PostgREST with the anon key. The app lives in `leadmanager/` (this directory is the npm project root).

## Commands

```bash
npm run dev       # Vite dev server (HMR)
npm run build     # production build → dist/
npm run preview   # serve the production build
npm run lint      # eslint (flat config, eslint.config.js)
```

There is **no test suite** and no TypeScript — plain `.jsx`/`.js`. Lint is the only automated check.

Requires a `.env` (copy `.env.example`): `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Without them cloud sync is disabled (the app logs a config error and runs on the local cache only). Deploy target is Netlify (`netlify.toml`, SPA redirect to `/index.html`, Node 22).

Supabase schema changes live in `supabase/migrations/*.sql` (applied manually to the project). Edge Functions in `supabase/functions/` handle the WhatsApp relay (`wa-send`, `wa-webhook`). Migration numbers are referenced by comments throughout `src/lib/` (e.g. "migration 0010 adds the `talked` flag") — when touching a feature gated on a column, check whether the code has a pre-migration fallback.

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

- Roles: `INITIAL_AGENT`, `MEETING_AGENT`, `TEAM_LEAD`, `MANAGEMENT`, `MASTER` (super-admin over all companies), `EXECUTIVE`.
- `canSee(user, key)` gates nav/features. A user's saved `allowedFeatures` array, when present, **fully overrides** role defaults (`NAV_SCOPES`). Profile is always visible.
- `EXECUTIVE` is a blank-canvas role (zero default access); `effectiveRole()` resolves it to the agent role its granted features imply (so it decides which dashboard renders) but never to a supervisory role — an Executive can't gain TL/MGMT powers by accident.
- `isNiHandler()` — an account flagged `ni_only` sees only `NOT_INTERESTED` leads; such leads auto-transfer to it.
- Lead lifecycle is the single `STATUS_FLOW` ladder; funnels and "reached stage X?" helpers (`reachedFrom`, `PAST_CONTACT`, etc.) all derive from it. Keep stage vocabulary in this one place.

### WhatsApp chat

`src/lib/wa.js` mirrors supabase.js conventions (raw REST, row converters, own realtime socket). The client **never** holds the Wasender API token — outbound sends POST to a server-side relay (Supabase Edge Function `wa-send` or n8n) whose URL comes from the `wa_settings` row; the relay holds the credential. Chat access is granted by the `wa_settings` allow-list / an explicit `allowedFeatures` grant, **not** by role (`waCanChat()`), which is why `conversations: []` in `NAV_SCOPES` and the view is exempted from the role-based redirect in `App.jsx`.

### UI structure

- `src/App.jsx` — root. `PageHero`/`PageBody` switch on `view`; `PageBody` picks the dashboard by `effectiveRole()`. Boot logic (warm-cache vs cold-fetch paths) lives in the mount effect — read the `needsBootFetch` / `enterApp` / `hydrateFromCloud` comments before touching login/boot.
- `src/context/AppContext.jsx` — single global context (`useApp()`): current `user`, `view`, all filter state, modal routing (`openModal`/`modal`), `impersonate()` (admin account switch that never changes the stored session), and `dbVersion`/`refreshDB()` (bump a counter to force re-render after a mutation).
- `src/components/` — `views/` (one per nav section), `dashboards/` (one per role), `modals/` (opened by name via `openModal`), `chat/`, `project/`, `charts/`, and `ui/` (generic primitives).
- `src/lib/` holds all domain logic (agent performance, funnels, deals, quotas, rollups, projects, push). Keep business logic here, not in components.

### Conventions

- The header lead count is published by `LeadsView` into `leadCounts` context (not recomputed in the header) so the number always agrees with the table beneath it.
- Mutations: call a `db.js` function that mutates `_DB`, persists, and pushes to the cloud, then `refreshDB()` to re-render.
- `requestIdleCallback` is used to keep expensive work (localStorage writes, opening the realtime socket) off the first-paint path.
