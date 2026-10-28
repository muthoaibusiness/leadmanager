# Lead Lifecycle (Forward, NOT Interested, Follow-up Calendar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Forward to Agent" a plain hand-off that preserves the whole lead; let Add-Customer holders self-forward recorded as FORWARDED; expose Not Interested through SITE_VISIT_DONE; redesign the follow-up calendar to Date/Time/Note/shared notes; and reorder the agent actions to the required primary order with a single consolidated forward action.

> **Revision note (2026-10-29):** the corrective directive reverses two proposals from this plan:
> - Task 4's "actions visible-but-disabled at every stage" flattening is **reverted** — non-primary meeting/visit actions (Attend/Reschedule/Site Visit/Visit Done/Forward to Team Lead) are stage-gated (hidden when not applicable) again. The 9 primary actions render in the required order; Not Interested is available through SITE_VISIT_DONE.
> - Task 6's default cadence (`defaultFollowupIso` auto-scheduling in `clearFollowup` / `checkFollowUpReminders`) is **reverted** — no global cadence. A custom schedule applies per-lead; a note-only customer request does not change the schedule; overdue leads are notified, not auto-rescheduled.
> - Task 2/3 are folded: exactly one top-level Forward to Agent, whose modal offers agent/team member, Team Lead (offer), and myself (`canSelfForward`).
> - Task 5 stands, with the modal contents now Date + Time + Note + Shared Lead Notes ("View all notes" + "Add a new shared note…") + the customer-requested timing constraint; presets removed.
> See `docs/audits/lead-lifecycle-audit.md` revision 3 for the reconciled evidence (86/86 tests).

**Architecture:** All domain mutations live in `src/lib/db.js` and are driven by `<button onClick>` in `src/components/LeadPanel.jsx` / modals. Business rules go in `db.js`/`constants.js`; the UI only wires them. Tests run isolated via `vite-node` with a stubbed `fetch` (`scripts/followup-rules.test.mjs` is the template); nothing touches the production Supabase.

**Tech Stack:** React 19 SPA, no backend. Hand-rolled PostgREST (`src/lib/supabase.js`). JS `node:test` + `vite-node`.

**Spec:** `docs/audits/lead-lifecycle-audit.md` (revision 2) — findings F1, F2, F6, F5; risks R1-R3; §8 proposals 1-7. Locked decisions D1-D4 (recorded in the audit's §9 at the end).

## Global Constraints

- Preserve branch `asad-dev`, HEAD `be1bab0`, `stash@{0}`, all working-tree state. No reset, stash, branch switch, commit, push, deploy.
- Isolated tests only. NEVER write test data to production. No SQL writes, no migrations rerun.
- Skip Supabase Auth/RLS for this task.
- `ni_count` and `followup_suppressed_*` are owned by the migration-0049 trigger. Client code never sends them; forward never unsuppresses.
- Shared notes go through `addNote` (db.js) — the same path as Add Note. Plain notes never increment `ni_count`.
- Output language: English. Code identifiers/strings verbatim.

## Review Focus

- A forward happens while the lead is suppressed or at a closed stage — must be refused or at least never unsuppress/never reset the cap.
- A self-forward by a non-owner who lacks Add-Customer access — must be refused by `canSelfForward` (permission lives in the rule, not only the button).
- A completed follow-up on a suppressed/closed lead — must not schedule a default cadence.
- An overdue follow-up whose "today 10:00" is already past — must land in the future, not the past.
- A Not Interested click at MEETING_SET/SITE_VISIT_* — must still write `STATUS_CHANGE`, transfer to the NI handler, and let the trigger bump `ni_count`.

---

### Task 1: Forward unit tests

**Files:**
- Create: `scripts/forward.test.mjs`
- Test: `scripts/forward.test.mjs`

**Interfaces:**
- Consumes: `fwdLead`, `claimLeadForSelf`, `getDB`, `canSelfForward` from `src/lib/db.js` / `src/lib/constants.js`.
- Produces: the exact behavior Tasks 2 and 3 must satisfy.

- [ ] **Step 1: Write the failing test suite** (mirror `scripts/followup-rules.test.mjs` harness: localStorage + fetch stubs, `const db = await import('../src/lib/db.js')`). Assert:
  - `fwdLead` changes only `assignedTo/assignedToName/assignedRole/previousAssignees` (status, `nextFollowup`, `noAnswerCount`, `followupSuppressedAt/Reason`, `meetingAt/meetingType/meetingAttended`, `offerSentAt` all unchanged).
  - `fwdLead` appends the current user to `previousAssignees` and adds one `FORWARDED` activity.
  - Plain hand-off to a TL (no `offerData`) sets no `offerSentAt`/`offerValue` and adds no `OFFER` activity.
  - Closing hand-off to a TL without a complete offer returns false and changes nothing.
  - `claimLeadForSelf` records `FORWARDED` (not `NOTE`) and appends the previous owner to `previousAssignees`.
  - `canSelfForward` is true for MA, for `self_forward` grant, and for an Add-Customer holder; false for a plain agent without grants.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vite-node --config .gate-harness/vite.config.mjs scripts/forward.test.mjs`
Expected: the self-forward `FORWARDED` assertion fails (it logs NOTE today) and the add-customer `canSelfForward` assertion fails.

### Task 2: "Forward to Agent" becomes a plain hand-off

**Files:**
- Modify: `src/components/modals/ForwardModal.jsx:127-133, 271-332`
- Modify: `src/components/modals/ForwardModal.jsx:62, 275-278` (hint copy)

**Interfaces:**
- Consumes: `fwdLead` (unchanged signature).
- Produces: `forward-agent` flow calls `fwdLead` alone — no `setMeeting`, no meeting fields.

- [ ] **Step 1: Remove the meeting-booking step from `forward-agent`**

In `submit`, delete the `if (isAG) { ... buildMeetingData ... setMeeting ... }` block. In the step-2 render for `isAG`, drop the meeting-type/time/link/shared fields and the "Set Meeting & Forward" submit; keep a one-line confirmation ("Forward to {name} as-is — status, follow-ups and history stay") and a "Forward" button. Step 1 "Next" still advances to step 2.

- [ ] **Step 2: Run the forward tests** — they pass.
- [ ] **Step 3: Update the hint copy** at `ForwardModal.jsx:275-278` to say the lead changes hands at its current stage with status/history preserved.

### Task 3: Self-forward for Add-Customer holders, recorded as FORWARDED

**Files:**
- Modify: `src/lib/constants.js:112-113` (`canSelfForward`)
- Modify: `src/lib/db.js:1691-1707` (`claimLeadForSelf`)
- Test: `scripts/forward.test.mjs` (Task 1)

**Interfaces:**
- Consumes: `NAV_SCOPES.add_customer`, `ROLES.MA`.
- Produces: `canSelfForward(user)` true for an Add-Customer holder; `claimLeadForSelf` logs FORWARDED and preserves `previousAssignees`.

- [ ] **Step 1: Extend `canSelfForward`** to also return true when the user has Add-Customer access — explicitly via `allowedFeatures.includes('add_customer')`, or by role when `allowedFeatures` is absent/empty and the role is in `NAV_SCOPES.add_customer` (mirror the feature-resolution rule in `defaultFeatures`/`canSee`).
- [ ] **Step 2: Change `claimLeadForSelf`** to log `type: 'FORWARDED'`, description `Forwarded to self by {name} ({role})`, and to append the current owner to `previousAssignees` before reassigning.

### Task 4: Actions visible-but-disabled with a reason; Not Interested through SITE_VISIT_DONE

**Files:**
- Modify: `src/components/LeadPanel.jsx` (Actions component, `137-443`)
- Modify: `src/index.css` (a disabled-action hint class)
- Test: `scripts/leadpanel-interested.test.mjs` (add tests)

**Interfaces:**
- Consumes: `STATUS_FLOW`, `PAST_QUALIFY`, `followUpBlock`.
- Produces: `doNotInterested` shows an inline optional-note field; on confirm it calls `changeStatus(id,'NOT_INTERESTED')` then `addNote` when text was typed.

- [ ] **Step 1: Add a disabled-action helper** that renders an action button with `disabled` and a `title`/hint when its stage condition is false, so every lifecycle action stays visible on every lead with a clear reason.
- [ ] **Step 2: Render Not Interested through SITE_VISIT_DONE** — change the gate `['NEW','CONTACTED','INTERESTED']` to include `MEETING_SET`, `SITE_VISIT_SCHEDULED`, `SITE_VISIT_DONE`.
- [ ] **Step 3: Add the optional note** — clicking Not Interested reveals an inline textarea + Save/Cancel; Save runs `changeStatus` plus `addNote` if non-empty.
- [ ] **Step 4: Add LeadPanel tests** (mount with the stub harness) asserting: buttons render disabled with reason text at stages where the action does not apply; Not Interested renders at MEETING_SET and SITE_VISIT_DONE; confirming NI writes STATUS_CHANGE and (with text) a NOTE, and never touches `ni_count`.

### Task 5: Follow-up calendar redesign

**Files:**
- Modify: `src/components/modals/FollowUpModal.jsx`
- Test: extend `scripts/leadpanel-interested.test.mjs` or a new `scripts/followup-modal.test.mjs`

**Interfaces:**
- Consumes: `setFollowUpAt`, `addNote`, `isAgentNote`, `getActs`, `companyTimeZone`, `zonedToUtcIso`, `utcIsoToZoned`.
- Produces: a modal with separate Date and Time inputs, an optional note, and a Shared Lead Notes section with "View all notes" and "Add a new shared note…", all notes via `addNote`.

- [ ] **Step 1: Split date/time** — replace the single `datetime-local` with a date input (type=date) and a time input (type=time), combined to `'YYYY-MM-DDTHH:MM'` company-zone wall-clock and converted via `zonedToUtcIso`. Keep the customer-requested checkbox when `has0049`.
- [ ] **Step 2: Rebuild the shared-notes section** — full agent-note list (not capped at 3), a "View all notes" expander, and an "Add a new shared note…" inline field that calls `addNote`; submit note plus any new shared note both go through `addNote`.
- [ ] **Step 3: Remove presets and any meeting-flavored fields** — presets are dropped for the Date/Time/Note/shared-note shape (no Online/Offline, links, prices, media were ever in this modal).

### Task 6: Default cadence for completed and overdue follow-ups

**Files:**
- Modify: `src/lib/companyTime.js` (helpers)
- Modify: `src/lib/db.js` (`clearFollowup`, `checkFollowUpReminders`, new helper)
- Test: `scripts/followup-rules.test.mjs` (add tests)

**Interfaces:**
- Consumes: `companyTimeZone`, `zonedToUtcIso`/`utcIsoToZoned`, `nextFollowupFor`, `followUpBlock`.
- Produces: `defaultCadenceIso(now, { overdue })` → next-day 10:00 company time (or 10:00 today for overdue, bumped to next day when that is past), floor applied via `nextFollowupFor`.

- [ ] **Step 1: Add `companyTime.js` helpers** — build a `'YYYY-MM-DDTHH:MM'` wall-clock for "today 10:00" and "next day 10:00" in the company zone and convert to ISO (`zonedToUtcIso`).
- [ ] **Step 2: Add `defaultCadenceIso(lead, now, { overdue })` in db.js** — `overdue` → today 10:00 (next day if already past); else next day 10:00; returns `nextFollowupFor(lead, candidate)` so the customer-requested floor still wins.
- [ ] **Step 3: Change `clearFollowup`** — if the lead is not closed/suppressed, set `nextFollowup = defaultCadenceIso(lead, now())`; else `null`.
- [ ] **Step 4: Add the overdue fallback in `checkFollowUpReminders`** — when a due lead's reminder is emitted and the lead is overdue, reschedule `nextFollowup` to today 10:00 (via `defaultCadenceIso`), skipping closed/suppressed leads.
- [ ] **Step 5: Add followup-rules tests** — clearFollowup on an active lead schedules next day 10:00; on a suppressed/closed lead clears without scheduling; an overdue lead reschedules to today 10:00 but never into the past; customer-requested floor is honoured.
- [ ] **Step 6: Run the full isolated suite** — `leadpanel-interested`, `followup-rules`, `followup-reminders`, `company-time`, `forward`, `test-0049` all green.

### Task 7: Update the audit document with evidence

**Files:**
- Modify: `docs/audits/lead-lifecycle-audit.md` §9 (Implementation Evidence)

- [ ] **Step 1: Fill §9** with the changed files, added tests, actual test counts, and mark the closed gaps (F1, F2, F5, F6; R1-R3) as addressed, leaving any UNKNOWN (visual/E2E, R10) labelled as such. No fabricated verification: quote observed test output.
