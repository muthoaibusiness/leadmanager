# WEPRO CRM mobile app (React Native, Expo)

The Android and iOS app. Plain JavaScript (no TypeScript), Expo SDK 58, React Navigation 7. It lives in `mobile/` with its own `package.json`; the web app in the repo root is untouched by it. Read the root `CLAUDE.md` first: the data rules there (local-first cache, `mergeDB`, lead query twin, status writers, tenancy) apply here unchanged.

## The one rule: logic is shared, screens are new

The app does **not** copy the CRM's logic. It imports the web app's own modules from `../src/lib/*.js` (and the access rules in `../supabase/functions/_shared/access-rules.js`), so a rule changed for the web is changed for the phone. Screens call the same `db.js` functions the web components call, with the same arguments and the same checks.

- Port a web page by reading its component in `../src/components/` and keeping every condition (who may see which action at which status, validation messages, what is written). Rebuild only the layout.
- Never re-implement a query, a status change, a permission check or a formatter that exists in `src/lib`. If something you need lives inside a web component rather than in `src/lib`, copy the logic into the screen and say where it came from in a comment; do not edit `src/` from here.
- Mutations: call the `db.js` function, then `refresh()` from `useApp()`, then a toast. Same convention as the web (`refreshDB()`).
- A new status path must go through the status writers in `db.js` (see root `CLAUDE.md`, "Lead status changes — always logged").

How the sharing works (do not undo):
- `metro.config.js` watches `../src` and `../supabase/functions/_shared`; React always resolves from `mobile/node_modules`.
- `babel.config.js` rewrites `import.meta.env.VITE_X` to `process.env.EXPO_PUBLIC_X` (values in `mobile/.env`, same as the web's `.env` with the other prefix).
- `src/shims/` gives the shared code a synchronous `localStorage` (expo-sqlite) on the phone. It must stay the first import in `index.js`.
- Shared files must not import React or anything from the DOM. `src/hooks/*` and `src/components/*` of the web app are **not** importable here.

## Layout

- `App.js`, `index.js` — entry. Providers: SafeArea → `AppProvider` (`src/store.js`) → `UIProvider` (`src/ui`) → navigation.
- `src/store.js` — `useApp()`: `{ user, setUser, booting, syncing, dbVersion, refresh, enter, signOut, reload }`. Boot and realtime mirror the web's `App.jsx`. Read `dbVersion` (`void dbVersion`) in a screen that renders from `getDB()` so it re-renders after a change.
- `src/boot.js` — `hydrateFromCloud`, the web's steps in the web's order.
- `src/hooks.js` — `useLeadCounts(specs)`, `useLeadBook()`, `useActWindow()`, `useDebounced()`.
- `src/theme.js` — `useTheme()` colours (light/dark by the phone setting), `space`, `radius`, `statusTone`, `toneColors`.
- `src/ui/index.js` — every building block: `Screen`, `Card`, `Row`, `Section`, `T` (text), `Button`, `IconButton`, `Chip`, `ChipBar`, `Badge`, `StatusBadge`, `Avatar`, `Field`, `SearchField`, `Segmented`, `ListItem`, `Stat`, `Empty`, `Loading`, `Sheet` (bottom sheet), `Icon`, and `useUI()` → `{ toast(text, 'ok'|'warn'|'err'), confirm({ title, description, confirmLabel, danger, onConfirm }) }`. `src/ui/DateTimeField.js` is the date/time picker.
- `src/nav/index.js` — tabs (Home, Leads, Alerts, Menu) under one native stack. `src/nav/modules.js` — the registry of every other page: menu entries (`MODULES`, gated by `canSee(user, feature)`) and detail routes (`DETAIL_ROUTES`).
- `src/screens/` — one file per screen; `lead/LeadsScreen.js`, `lead/LeadDetailScreen.js` and `lead/sheets.js` are the reference for lists, detail pages and forms.

## Conventions

- Compose screens from `src/ui`. Do not style raw `View`/`Text` with colours of your own: take colours from `useTheme()` and spacing from `space`, so dark mode and consistency hold. Add a building block to `src/ui/index.js` only when two screens need it.
- Icons: `<Icon name="…">` with Material icon names; underscores or dashes both work (`phone_callback`). A name the icon set lacks renders as a dot, so check it shows.
- Touch targets are at least 44pt. Lists use `FlatList`, never `.map` inside a `ScrollView` for unbounded data.
- Leads are never loaded whole for a list: page through `queryLeads`, count with `countLeads` (`useLeadCounts`). Only screens that truly aggregate over the book call `useLeadBook()`.
- `Alert.alert` does nothing on the web target; use `useUI().confirm`.
- No native module beyond what `package.json` already has without a reason: the app must keep running in Expo Go. Install with `npx expo install <pkg>`, never `npm install`.
- Navigation: `navigation.navigate('LeadDetail', { leadId })`, `('LeadList', { preset: { title, kpi, kpiArg, status, extra, … } })`, `('AddLead')`, `('EditLead', { leadId })`. New pages are added to `src/nav/modules.js`.

## Looking at a screen without a phone

There is no emulator on this machine. Screens are checked on the web target, in a headless browser, against a mock of the Supabase project (`dev/mock.mjs`), so nothing touches real data.

```bash
cd mobile && npx expo start --web --port 8099        # once; it rebuilds on save
SHOT_DIR=<folder> node "<browser-automation skill>/browser.mjs" http://localhost:8099/ --script dev/check-core.mjs --timeout 120000
```

A check script default-exports `async (page) => result`, starts with `const mock = await signInAs(page, 'AGENT' | 'TEAM_LEAD' | 'MANAGEMENT', overrides)` and can read `mock.writes` (every POST/PATCH/DELETE the app sent). `overrides` answers extra tables: `{ hold_requests: [...rows] }`. `dev/check-core.mjs` is the example. The runner's console capture is unreliable; a blank page means a render error — read the dev server's own output.

This shows layout and logic; it is not a device test. Touch feel, keyboard behaviour, safe areas and push need a real phone (Expo Go, or an EAS build).

## Not built yet

Web pages with no screen here: shop booking floor plan, Facebook leads, inventory/finance, AI trainer, Meta CAPI, WhatsApp relay settings, public project admin, CSV import, bookings and payments.

## Push

`src/push.js` registers an Expo push token for the signed-in account (`push_register_device`, migration 0076); the `push-send` Edge Function sends each new `notifications` row to it through Expo's push service; a tap opens the lead (`usePushTaps` in `src/nav/index.js`). It needs what code cannot supply: an EAS project id (`eas init` writes `extra.eas.projectId` into `app.json`) and push credentials uploaded to EAS (FCM for Android, an APNs key for iOS). Without them, in Expo Go, on a simulator and on the web target, registration does nothing and logs why once.

## Building

`eas.json` has three profiles: `development` (dev client), `preview` (an installable Android `.apk`, internal iOS build) and `production`. `npx eas-cli build -p android --profile preview` produces the file to hand around. iOS builds need an Apple Developer account. The bundle ids are `com.wepro.crm` in `app.json`.
