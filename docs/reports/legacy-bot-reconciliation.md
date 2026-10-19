# Legacy WhatsApp Bot Reconciliation: Deployed vs Git

| | |
|---|---|
| Date | 2026-10-19. v57/v53 source retrieved at 15:07 UTC. v58/v54 retrieved at 15:56 UTC (section 12). |
| Production project | `sbqmougcvnplgjgihpwe` ("Wepro CRM") |
| Functions | `wa-bot-eyad`, `wa-bot-dubai` |
| Repository | `leadmanager/`. The comparison base is `feat/ai-trainer-mvp` HEAD `728e4c702c81821f2a8c0b5a90d7018af77ba9f7`. The evidence is committed on branch `reconcile/deployed-2026-10-19`, created from that HEAD. |
| Mode | Read-only towards production. Nothing was deployed, changed or sent, and nothing was pushed. Bot source is unchanged. |

> **Update, 16:04 UTC.** Sections 1 to 11 describe **v57 / v53**, which were live from 06:15 to 15:14 UTC. Both bots were redeployed at 15:14 UTC as **v58 / v54**, by someone other than this review. Section 12 documents that drift. The v57/v53 findings still hold for v58/v54, except for the additions listed there.
>
> The exact bytes of all four bundles are preserved, each with `SHA256SUMS` and `DEPLOYMENT.json`, in `supabase/deployed/2026-10-19/`. The v57/v53 folders are `wa-bot-eyad-v57/` and `wa-bot-dubai-v53/`; the v58/v54 folders are `wa-bot-eyad-v58/` and `wa-bot-dubai-v54/`. `INDEX.md` there lists all four. The `/tmp` paths in this report were the working copies used during the review.

**Classifications**

| Label | Meaning |
|---|---|
| **Confirmed** | Directly supported by retrieved source, deployment metadata or read-only SQL |
| **Likely** | Supported by partial evidence, not fully proven |
| **Unknown** | Evidence unavailable or ambiguous |

All production source was downloaded into `/tmp` (outside the repository), and every file was compared after stripping carriage returns, because the deployed files use CRLF line endings and git uses LF. Line numbers below refer to that normalised text.

---

## 1. Executive summary and scope

**Result (Confirmed).** Both deployed bots were built from git commit `96661e9`, plus one set of uncommitted edits that exists nowhere in git. The same edits appear in both bots.

**Exact matches (Confirmed).** 5 of the 8 deployed files match a git commit byte for byte after line-ending normalisation:

- `_shared/wa.ts` matches `96661e9`;
- `_shared/trainer-live.ts` and `_shared/trainer-deno.ts` match `ab66552`;
- `_shared/trainer-core.ts` matches `1e1fc85`;
- `_shared/trainer-handler.ts` matches `91cb211`.

**Files that match no commit (Confirmed).** `wa-bot-eyad/index.ts`, `wa-bot-dubai/index.ts` and `_shared/ai.ts`. Their closest commit is `96661e9` (author `hrridoyv2`, 2026-10-19 00:43 +06, message "h"). They differ from it by 35, 34 and 58 changed lines.

**The production-only edits form one coherent feature (Confirmed in source).**

1. A price or payment question, after the first message, gets a fixed English offer of a dedicated agent, and the lead jumps to follow-up stage `asked_agent`.
2. A project the customer names outright overrides the ad project, and is written back to `preleads.property_interest`.
3. The Jolshiri welcome and follow-up flow is restricted to the 3 Jolshiri projects.
4. Profile consent recognises more phrasing, including a reply that quotes the bot's question.
5. The Jolshiri bundle and profile-question texts are switched from Bangla to English.

**These edits are live and sending (Confirmed by read-only SQL).** Since `wa-bot-eyad` v57 was deployed at 06:15 UTC on 2026-10-19:

- the production-only price-agent text has gone out 14 times from the Eyad number (first send 06:16:04 UTC);
- the English Jolshiri bundle text has gone out 24 times.

**The repository has the opposite gap (Confirmed).** HEAD contains changes that production lacks:

- the webhook shared-secret check (`verifyWebhook`);
- re-checking the AI switch before every customer send (`aiStillOn`);
- 30-second timeouts on both OpenRouter calls;
- failing closed when the settings read fails;
- full-number test-number matching;
- the newer trainer test path: published System Prompt, memory key, pause on `/t`.

**Neither side is complete.** Deploying either bot from HEAD today would remove the five live production behaviours above. Leaving production as it is keeps it running code that no one can review or reproduce from git.

**Scope.** Both bot entry points and every shared module they bundle: `_shared/ai.ts`, `wa.ts`, `trainer-core.ts`, `trainer-deno.ts`, `trainer-handler.ts` and `trainer-live.ts`. `wa-webhook`, `wa-send` and `wa-followup` were not compared at source level. Their metadata appears in section 3 for context only.

---

## 2. Repository state

| Item | Value | Classification |
|---|---|---|
| Root | `/home/asad/Cowork/local-dev/leadmanager` | Confirmed |
| Branch | `feat/ai-trainer-mvp`, equal to `origin/feat/ai-trainer-mvp` | Confirmed |
| HEAD | `728e4c7` "chore(e2e): stop tracking Playwright evidence…" | Confirmed |
| Working tree | Clean except one untracked file from an earlier task, `FuturePlan-AI-Trainer.md` (left untouched), and this report | Confirmed |
| Remote heads after `git fetch` | `origin/main` `7c109c0`, `origin/dev` `6ceb285`, `origin/asad-dev` `99a646b`, `origin/feat/ai-trainer-mvp` `728e4c7` | Confirmed |
| Bot code: HEAD versus `origin/dev` | Identical. `git diff HEAD origin/dev` on both bots and `_shared` is empty. | Confirmed |
| Bot code: HEAD versus `origin/main` | Different: 49 files. `main` predates the trainer and follow-up work. | Confirmed |
| `96661e9` an ancestor of | HEAD and `origin/dev`: yes. `origin/main`: no. | Confirmed |

Commits on HEAD that touch these files after `96661e9`: `17af8a6`, `abb90c1`, `3d13a6a` and the merge `28e2088`. Earlier reconciliation documents (`docs/phases/phase-0-report.md`, `docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md` §10.5) record older baselines, eyad v35 and then v38. Those baselines are superseded.

---

## 3. Deployed version and retrieval evidence

**Retrieval methods**, all read-only, using the access token from the local `.env` (never printed):

- `npx supabase functions list --project-ref sbqmougcvnplgjgihpwe -o json` (CLI 2.121.0);
- `npx supabase functions download <fn> --project-ref sbqmougcvnplgjgihpwe --use-api --workdir /tmp/rc-<fn>`, which unbundles server-side and needs no Docker;
- `GET https://api.supabase.com/v1/projects/sbqmougcvnplgjgihpwe/functions/<fn>`, the Management API metadata endpoint.

| Field | `wa-bot-eyad` | `wa-bot-dubai` |
|---|---|---|
| Function id | `f5d3c910-09cd-4598-88a6-ce98e40c7b91` | `ac5b899d-f3de-4084-b8fd-0b95325ee962` |
| Version | **57** | **53** |
| Status | ACTIVE | ACTIVE |
| `verify_jwt` | false | false |
| Import map | none | none |
| Entrypoint | `source/supabase/functions/wa-bot-eyad/index.ts` | `source/supabase/functions/wa-bot-dubai/index.ts` |
| Created | 2026-10-14 06:06:51 UTC | 2026-10-14 06:06:58 UTC |
| Last deployed | **2026-10-19 06:15:24 UTC** | **2026-10-19 06:15:46 UTC** |
| `ezbr_sha256` (bundle hash) | `44731a3093b06dc5c1b205868ca0312a6549e86d709fab775c3254f74452e09f` | `37240ddfc5cb9766bc0033ad163783113a183ea18abe217fb9c94fdc2bc0556b` |
| Files retrieved | 7 source files plus 2 CLI metadata files | Same 6 shared files plus its own `index.ts` |

**Deployed file hashes** (SHA-256 of the files as downloaded, CRLF):

| File | SHA-256 | Same in both bots |
|---|---|---|
| `_shared/ai.ts` | `e50d4776ce65167d99c3448dcba4b2da31aebc348c9c0386e504a9099fe0c493` | yes |
| `_shared/wa.ts` | `3c6911a750998a2bbfcb6a3b73a53e7efd7f8d72e0b64f8849f5327608ae212b` | yes |
| `_shared/trainer-core.ts` | `01a80bb5c69a0dd0749548ed1033a9a3e591e10f277bdef2cb8f42e95ea80939` | yes |
| `_shared/trainer-deno.ts` | `c381c8f0cb32ec602f2766b264916279734610026b3bb22cdaf42a5f0bf1ae50` | yes |
| `_shared/trainer-handler.ts` | `f4a8b68825f85ea7e3e6d85c0c0da3842c4002ed488225b0ca4eef12a108a1fa` | yes |
| `_shared/trainer-live.ts` | `1d32437fc0661592176af5cdbb18898eaeed087f0a78fcac867468873ff8ff23` | yes |
| `wa-bot-eyad/index.ts` | `c3e5a594d4b288c8526b18d0344bbf2ffca591be55bdef543dc020c9abac7f5f` | — |
| `wa-bot-dubai/index.ts` | `c5482de6e59d1a9c1c95dd3cdf52cff438917bf44fe4c7536b64cbf5d4421e85` | — |

**Bundle completeness (Confirmed).**

- All 12 relative imports in the downloaded files resolve to downloaded files.
- There are no remote imports: no `jsr:`, `npm:` or `https:`.
- The download is therefore the complete source module graph of each bundle.

**Limitations.**

- The Management API has no version-history endpoint: `/functions/<fn>/versions` returned 404. Earlier versions cannot be retrieved. **Unknown:** what v56 or v52 contained.
- The deployment metadata does not record the git commit, the deployer or the source directory. The link to `96661e9` comes from source comparison, not metadata.
- CRLF in every file (Confirmed) indicates the deploy came from a working tree with CRLF line endings, most likely a Windows checkout. **Likely**, not proven.

**Context only (not compared at source level):**

| Function | Version | Deployed (UTC) |
|---|---|---|
| `wa-webhook` | 12 | 2026-10-14 11:49 |
| `wa-send` | 11 | 2026-10-14 18:14 |
| `wa-followup` | 9 | 2026-10-19 05:56 |

---

## 4. Per-bot source-to-git comparison

Measured after stripping carriage returns. The "closest commit" was found by testing every commit that ever touched the path (`git log --all -- <path>`) and keeping the one with the fewest changed lines.

### 4.1 `wa-bot-eyad` v57

| File | Deployed lines | HEAD lines | Closest commit | Lines changed vs closest | Deployed vs HEAD | Classification |
|---|---|---|---|---|---|---|
| `wa-bot-eyad/index.ts` | 714 | 693 | `96661e9` | 35 | +42 / −21 | **Production-only edits** |
| `_shared/ai.ts` | 444 | 400 | `96661e9` | 58 | +52 / −8 | **Production-only edits** |
| `_shared/wa.ts` | 452 | 484 | `96661e9` | **0** (exact) | +7 / −39 | Older than HEAD |
| `_shared/trainer-live.ts` | 107 | 139 | `ab66552` | **0** (exact) | +12 / −44 | Older than HEAD |
| `_shared/trainer-deno.ts` | 77 | 112 | `ab66552` | **0** (exact) | +3 / −38 | Older than HEAD |
| `_shared/trainer-core.ts` | 587 | 790 | `1e1fc85` | **0** (exact) | +18 / −221 | Older than HEAD (`CORE_VERSION` "1.0.0" against HEAD's "1.7.0") |
| `_shared/trainer-handler.ts` | 557 | 1090 | `91cb211` | **0** (exact) | +24 / −557 | Older than HEAD. Bundled through `trainer-deno.ts`, but no bot code path calls the handler. |

### 4.2 `wa-bot-dubai` v53

| File | Deployed lines | HEAD lines | Closest commit | Lines changed vs closest | Deployed vs HEAD | Classification |
|---|---|---|---|---|---|---|
| `wa-bot-dubai/index.ts` | 752 | 733 | `96661e9` | 34 | +41 / −22 | **Production-only edits** |
| Shared files | identical to eyad's (same hashes) | | | | | As 4.1 |

### 4.3 Is the production-only code anywhere in git?

**No (Confirmed for this clone).** Each production-only symbol and string was searched for in three places, all with 0 hits:

- every commit on every ref: `git log --all -S`;
- the stash, which is empty;
- 123 dangling blobs and commits: `git fsck --lost-found --no-reflogs`.

Searched: `matchNamedProject`, `isPriceQuestion`, `isProfileConsent`, `FLOW_PRICE_AGENT_TEXT`, `isJolshiriProject`, `YES_PHRASES`, `ASK_PROFILE_TEXTS` and "We have 3 projects in Jolshiri".

**Unknown:** whether the code exists in another developer's local clone or an unpushed branch. Finding it requires asking the author of `96661e9`, `hrridoyv2`.

---

## 5. Confirmed production-only behaviour

Each item is in both deployed bots unless marked otherwise. Locations are deployed-file lines after normalisation. The diffs against `96661e9` were captured during this review. To reproduce them, follow the steps in section 11.

| # | Behaviour | Deployed location | Evidence of live use | Classification |
|---|---|---|---|---|
| P1 | **Price or payment question sends an agent offer.** When `is_new !== true`, the text matches `isPriceQuestion`, and the flow stage is not already `asked_agent`, `agent_ack` or `agent_assigned`: send `FLOW_PRICE_AGENT_TEXT` ("For price and payment details, would you like me to assign a dedicated agent who will call you?"), set `flow_stage='asked_agent'`, `stage_at` and `stage_msg_count`, and **return before the FAQ agent runs**. | eyad `handleInbound`, inserted after the stage-3 block (diff hunk `@@ -371,4 +385,15`); dubai the same (`@@ -474,4 +487,15`); text and `PRICE_RE` in `_shared/ai.ts` | 14 sends from the Eyad number, 06:16:04 to 13:07:12 UTC on 2026-10-19. 0 from Dubai. | Confirmed |
| P2 | **A named project overrides the ad project.** `matchNamedProject(text, activeProjects)` matches a full name, the name without "Wecon ", or any keyword of 4 or more characters, as a substring. A match different from `property_interest` replaces it in memory **and writes it to `preleads.property_interest`**. | eyad `@@ -320,7 +326,15`; dubai `@@ -418,7 +423,15`; `_shared/ai.ts` `matchNamedProject` | No direct trace. The `preleads` write is unlogged. | Confirmed (code), Unknown (frequency) |
| P3 | **Jolshiri welcome only for the Jolshiri projects.** Was: any `property_interest` gets the Jolshiri welcome and the follow-up clock. Now: only `isJolshiriProject(property_interest)`, an exact case-insensitive match on "Wecon Osman Bellevue", "Wecon Nuznan" or "Wecon Dakshinayan". Other contacts get `GENERIC_WELCOME_TEXT`. | Same hunks as P2 | Follow-up stages exist for 28 preleads (earlier read-only check) | Confirmed |
| P4 | **Broader profile consent.** `isProfileConsent(text, quoted)` replaces `isAffirmative(text)` at follow-up stage 3. It adds 24 consent phrases (Bangla and Banglish) and the words "thanks", "thank", "you", "tnx", "thnx" and "ধন্যবাদ". A reply that **quotes** the profile question counts as consent unless it matches `NEGATIVE_RE`. Requires the new `quoted` field, parsed from `extendedTextMessage.contextInfo.quotedMessage`. | `ParsedEvent.quoted` and `parseEvent` / `parseWasenderEvent`; stage-3 condition; `_shared/ai.ts` `YES_WORDS`, `YES_PHRASES`, `ASK_PROFILE_TEXTS`, `isNegative`, `isProfileConsent`, `isAffirmative` | — | Confirmed |
| P5 | **English Jolshiri copy.** `JOLSHIRI_BUNDLE_MESSAGE`, `FLOW_ASK_PROFILE_TEXT` and `FLOW_AUTO_PROFILE_TEXT` are changed from Bangla to English. `FLOW_ASK_AGENT_TEXT` and `FLOW_AGENT_YES_TEXT` stay Bangla. | `_shared/ai.ts` `@@ -265,5` and `@@ -271,7` | English bundle: 24 sends, first 05:12:19 UTC, latest 14:26:05 UTC on 2026-10-19. Bangla bundle: 41 sends, 2026-10-18 06:33 UTC to 2026-10-19 03:59 UTC. | Confirmed |

**Locally verified helper behaviour (Confirmed).** The pure helpers were copied out of the deployed `ai.ts` and run with Node's type stripper, with no handler, network or I/O. Results:

| Input | Helper | Result |
|---|---|---|
| "nuznan er flat koto boro?" (size question) | `isPriceQuestion` | **true** |
| "flat koto sft?" | `isPriceQuestion` | **true** |
| "dam koto?", "দাম কত?" | `isPriceQuestion` | true |
| "project kothay?" | `isPriceQuestion` | false |
| "summer e ki offer ache" | `matchNamedProject` | **"Wecon Summer Breeze"** |
| "orchid er photo" | `matchNamedProject` | "Wecon Iqbal Orchid" |
| "Wecon Osman Bellevue, P2P Helthcare" (a merged legacy value) | `isJolshiriProject` | **false** |
| "thank you" | `isProfileConsent` | **true** |
| "you" alone | `isAffirmative` | **true** |
| "ok thanks", quoting the question | `isProfileConsent` | true |
| "na lagbe na", quoting the question | `isProfileConsent` | false |

**Observations from that run**, which are risks and are not judged in this report:

- **`koto` makes most size questions count as price questions.** `PRICE_RE` contains the word `koto` ("how much / how many") and `sft`. The bot then answers with the price-agent offer instead of the size (Confirmed by the run).
- **A generic keyword reassigns the project.** `matchNamedProject` matches keywords such as "summer" or "orchid" anywhere in the text, so a common word can move a lead's `property_interest` (Confirmed by the run; this matches audit finding F17's concern about generic keywords).
- **Merged legacy values lose the Jolshiri flow.** About 29 rows hold strings like "A, B" (audit §4.4, Reported). Such contacts get the generic welcome even when one of the projects is a Jolshiri project (Confirmed for the string tested).
- **"thank you" counts as consent.** A thank-you after the profile question sends the bundle (Confirmed by the run).

---

## 6. Git-only behaviour (in HEAD, not in production)

| # | Behaviour | HEAD location | Effect if deployed | Classification |
|---|---|---|---|---|
| G1 | **Webhook shared-secret check.** `verifyWebhook` is called before the mirror forward and returns 401 on a mismatch. With no secret configured it accepts the request with a warning. `x-replay: 1` skips dedupe only for a verified request. | `_shared/wa.ts` `verifyWebhook`; `wa-bot-eyad/index.ts` and `wa-bot-dubai/index.ts` in `Deno.serve` | No change today, because no secret exists in `wa_secrets` (all 3 rows empty, verified earlier on 2026-10-19). Setting a secret would start rejecting traffic that lacks the header. | Confirmed |
| G2 | **AI switch re-checked before every send.** `aiStillOn(bot, phone)` before each `sendWaMessageMirrored` in `runFaqAgent` | Both bots' `runFaqAgent` | Turning replies off mid-turn stops the remaining sends | Confirmed |
| G3 | **30 s timeouts** (`AbortSignal.timeout(30_000)`) on `fixGrammar` and `askAgent` | `_shared/ai.ts` | A hung OpenRouter call ends after 30 s instead of holding the webhook | Confirmed |
| G4 | **Fail closed on a settings read failure.** `sbSelectOrNull`, and customer automations OFF when `wa_bot_settings` cannot be read | `_shared/wa.ts` `getBotSettings` | A database error silences customer automation; agent commands keep working | Confirmed |
| G5 | **Full-number test-number match.** `samePhone` (`_shared/phone.ts`) replaces the last-10-digit `phoneKey` | `_shared/wa.ts`, `_shared/trainer-live.ts` | Fixes cross-country false matches. Adds `phone.ts` to the bundle, which is not in production today. | Confirmed |
| G6 | **Newer trainer test path.** Published System Prompt only, memory key `bot:phone`, pause on `/t` takeover, `trainer-core` 1.7.0 | `_shared/trainer-live.ts`, `trainer-deno.ts`, `trainer-core.ts`, plus `trainer-model.ts` and `trainer-prompt.ts`, which production lacks | Only runs when `trainer_test_mode` is on, which it is not on either bot (verified earlier on 2026-10-19) | Confirmed |

**Behaviour HEAD would remove if deployed (Confirmed).** All of P1 to P5: the price-agent offer, named-project override, Jolshiri-only welcome, broader consent and the English copy. HEAD's `ai.ts` keeps the Bangla texts and the 4-word `isAffirmative` without phrases.

---

## 7. Shared-dependency and configuration differences

| Item | Production | HEAD | Classification |
|---|---|---|---|
| Shared files bundled | `ai`, `wa`, `trainer-core`, `trainer-deno`, `trainer-handler`, `trainer-live` | The same, plus `phone`, `trainer-model`, `trainer-prompt` and their own imports (`trainer-docs`, `trainer-index`, `trainer-inventory` through `trainer-core` and `trainer-handler`) | Confirmed |
| Bots share logic | Yes. The same 6 shared files with identical hashes, and the same P1-P5 edits written once for each bot's own variables (`upsert`/`p`/`sbPatchJson` in Eyad, `prelead`/`evt`/`sbPatchFireAndForget` in Dubai). The edits look deliberate and common to both bots, not bot-specific. | Same sharing | Confirmed (Likely deliberate) |
| `verify_jwt` | false for both | Deploy comments say `--no-verify-jwt` | Confirmed |
| Import map | none | none | Confirmed |
| Line endings | CRLF | LF | Confirmed |
| Function secrets used by these bundles | Names only, verified earlier on 2026-10-19: `OPENROUTER_API_KEY`, `WASENDER_API_TOKEN`, `META_CAPI_ACCESS_TOKEN`, plus the Supabase defaults. No webhook-secret environment variable. | Same names. HEAD also reads `AI_TRAINER_*` variables in `trainer-deno.ts`, which are not set. | Confirmed |
| Database settings that change behaviour | `wa_bot_settings`: Eyad FAQ agent on, Dubai off, `trainer_test_mode` off on both (verified earlier on 2026-10-19) | Same rows are read | Confirmed |
| Command routing contract | `scripts/command-compat/deployed-parity.test.ts` run against the v57/v53 download: **17 of 17 pass** | Same test file | Confirmed |

---

## 8. Missing evidence and confidence

| Question | Status | What would resolve it |
|---|---|---|
| Who deployed v57/v53, and from which directory | **Unknown.** The metadata has no deployer or path. CRLF suggests a Windows checkout (Likely). | Ask the team; the most likely source is the author of `96661e9` |
| Do P1-P5 exist in an unpushed local branch | **Unknown** | The same person's local `git log --all -S matchNamedProject` |
| What v56 and v52 contained, and when P1-P5 first went live | **Unknown.** No version-history API. The English bundle text first appears at 05:12:19 UTC, before the 06:15 deploy of v57 (Confirmed), so at least the English copy was live in an earlier version. | Supabase dashboard deployment history, if the plan exposes it, or the deployer's records |
| How often P2 rewrites `property_interest` | **Unknown.** The write is not logged. | Compare `preleads.property_interest` with `message_logs` read-only, or add logging in a future change |
| Whether the bots ran this exact code for every request since 06:15 | **Likely.** An Edge Function serves its active version, but no runtime trace was checked. | Edge Function logs in the dashboard |
| Type correctness of the deployed and HEAD bot files | **Partially checked.** Node's type stripper parses the four main files on both sides. A full `deno check` was not run because Deno is not installed. | `deno check` in a Deno environment |

**Overall confidence.**

- High that the source comparison is complete for both bundles: full module graph, file hashes recorded.
- High that P1, P3 and P5 are live, from sent-message evidence.
- Medium on P2 and P4 frequency, which is code-confirmed only.

---

## 9. Risks of redeploying the repository version without reconciliation

1. **Live sales behaviour disappears without notice.** These stop on deploy: the price-agent offer (P1), the named-project override (P2), the Jolshiri-only welcome (P3), broader consent (P4) and the English copy (P5).
   - Customers would get Bangla bundle text again.
   - Price questions would go to the FAQ agent instead of the agent offer.
   - Every ad contact would receive the Jolshiri welcome again, including non-Jolshiri projects.
2. **Mixed copy within ongoing conversations.** Recent threads contain the English question. HEAD's consent check does not recognise a quoted English question and has no quote parsing, so replies to it fall back to the word-only check.
3. **Follow-up stage changes.** P1 moves leads to `asked_agent`, and `wa-followup` (v9, not compared here) acts on those stages. Removing P1 changes who reaches stage 4. **Unknown:** exactly how `wa-followup` v9 interacts with each change.
4. **A new dependency footprint.** HEAD adds `phone.ts`, `trainer-model.ts` and `trainer-prompt.ts` to the bundle, plus a newer `trainer-core` and `trainer-handler`. It has not been run in Deno against these exact versions.
5. **The webhook check is inert until secrets are set (G1),** so deploying HEAD alone does not close the unauthenticated-webhook risk. Setting a secret before Wasender is confirmed to send the header would reject real traffic.

Leaving production as it is also has risks: it runs code that cannot be reviewed or rebuilt from git, and it lacks G1 to G5.

---

## 10. Recommended next steps, by risk

Each step needs separate approval. None was done in this task.

1. **Preserve production source in git, without changing production.**
   - Commit the downloaded v57 and v53 bundle source, CRLF normalised, as a snapshot on a dedicated branch, for example `reconcile/deployed-2026-10-19`.
   - Tag it `deployed/wa-bot-eyad-v57` and `deployed/wa-bot-dubai-v53`.
   - Record the `ezbr_sha256` values in the commit message.
   - This makes the live code reviewable and restorable.
2. **Agree a deploy freeze on `wa-bot-*`** until the merge in step 3 lands. Ask the author of `96661e9` whether P1-P5 exist locally, and what was intended.
3. **One reviewed merge of both lines** onto the current branch:
   - keep P1 to P5 (current live behaviour);
   - keep G1 to G6 (the repository's safety changes);
   - add regression tests for the P1 to P4 helpers, using the cases in section 5;
   - decide the observations flagged there: `koto` and `sft` in `PRICE_RE`, keyword-based project override, merged legacy values, "thank you" as consent. Each needs a product owner decision, not a silent code change.
4. **Before any deploy:**
   - run `test:commands`, `test:commands:deployed`, `test:live` and `test:trainer`;
   - run `deno check` on both bots;
   - deploy **one bot at a time** from a clean tagged commit;
   - download it again and compare with the commit to confirm, as was done for `ai-trainer` v8;
   - watch sent-message counts for P1 and P5 texts for 24 hours.
5. **Reconcile `wa-followup` v9** the same way: download, compare and snapshot. It is coupled to P1 through the flow stages.
6. **Keep the webhook check (G1) inert until secrets are rolled out through log mode,** as planned in `docs/changes/CR-001-phase-1a-security-fixes.md` and `FuturePlan-AI-Trainer.md` F2.

---

## 11. Actions intentionally not performed

- No deployment, redeployment, update, disable or delete of any Edge Function.
- No change to production prompts, bot pointers, secrets, environment variables, database rows, settings or cron schedules.
- No WhatsApp message sent, and no bot handler, outbound integration or production E2E run.
- No publish, rollback, activation or switch of any AI or bot configuration.
- No production-only code copied into the repository's bot files. No repository source file overwritten.
- No commit, push, merge or pull request.
- No security refactor or unrelated implementation work.

**Database access was SELECT only.** As noted in earlier audits, `supabase db query --linked` without a database password makes the CLI create or refresh its own temporary `cli_login_postgres` role; that is a platform-managed side effect, not an application change.

**Reproduce this comparison.** Strip carriage returns (`tr -d '\r'`) from each preserved file, then run `git diff --no-index <(git show 96661e9:supabase/functions/<path> | tr -d '\r') <stripped file>` for each file in section 4. The preserved files are under `supabase/deployed/2026-10-19/<function>-v<version>/`. During the review, temporary copies lived in `/tmp/rc-*`; they are byte-identical to the preserved files (verified in section 12.5).

---

## 12. Deployment drift: v57/v53 to v58/v54

### 12.1 What happened (Confirmed)

| Time (UTC) | Event | Source |
|---|---|---|
| 06:15:24 / 06:15:46 | `wa-bot-eyad` v57 and `wa-bot-dubai` v53 deployed | function metadata |
| 15:07:10 | v57/v53 downloaded for this review | retrieval log |
| **15:14:29 / 15:14:37** | **`wa-bot-eyad` v58 and `wa-bot-dubai` v54 deployed** | function metadata |
| 15:55:38 | Metadata read: v58/v54 | `functions list` |
| 15:56:02 / 15:56:13 | v58/v54 downloaded | retrieval log |
| 15:59:32 | Metadata read again: same versions and bundle hashes as at 15:55:38 | `functions list` |
| 16:04:20 | Metadata read again: still v58/v54, bundle hashes equal the snapshots | `functions list` |

**Who deployed it.** Not this review: no deploy command ran in this session. Supabase records no deployer, source tree or git commit. **Unknown:** who deployed, and from where. The files again have CRLF line endings, consistent with the earlier deploys from a Windows checkout (**Likely**).

### 12.2 Bundles

| | `wa-bot-eyad` v58 | `wa-bot-dubai` v54 |
|---|---|---|
| Deployed | 2026-10-19 15:14:29 UTC | 2026-10-19 15:14:37 UTC |
| `ezbr_sha256` | `23c4e8925caea776d0ce6a65457eb16610b91f878086161c2743ce63de0a5c80` | `a5a26163359bfac75915c02f3c57a9038a2160736fc7cb44e6a83afe0b8c3fb1` |
| Files | 7. The same module graph as v57/v53, and no CLI state files this time. | 7 |
| Preserved at | `supabase/deployed/2026-10-19/wa-bot-eyad-v58/` | `supabase/deployed/2026-10-19/wa-bot-dubai-v54/` |

### 12.3 File-by-file comparison with v57/v53

| File | eyad v57 to v58 | dubai v53 to v54 |
|---|---|---|
| `_shared/wa.ts` | byte-identical | byte-identical |
| `_shared/trainer-core.ts` | byte-identical | byte-identical |
| `_shared/trainer-deno.ts` | byte-identical | byte-identical |
| `_shared/trainer-handler.ts` | byte-identical | byte-identical |
| `_shared/trainer-live.ts` | byte-identical | byte-identical |
| `_shared/ai.ts` | **changed**, 13 lines. Byte-identical between the two v58/v54 bundles. | **changed**, 13 lines (the same file) |
| `<bot>/index.ts` | **changed**, 10 lines | **changed**, 9 lines |

The five unchanged shared files still match their git commits exactly (section 4). The three changed files are still `96661e9` plus production-only edits; the edits are now the P1-P5 set plus the additions below.

### 12.4 New production-only behaviour in v58/v54 (Confirmed in source)

| # | Behaviour | Location (normalised v58 text) | Classification |
|---|---|---|---|
| P6 | **Land-offer guard.** New `LAND_RE` and `isLandOffer(text)`. They match land, plot, gonda, katha, bigha, decimal, mouja, joint venture, jv, land share, developer and develop, plus the Bangla equivalents. `isPriceQuestion` now returns false for land offers, so P1's price-agent offer no longer fires on them. The source comment cites a real case where "rate" in a land offer triggered the price script. | `_shared/ai.ts`, after `PRICE_RE` (diff hunk `@@ -284,7 +290,12`) | Confirmed |
| P7 | **Land sellers skip the Jolshiri flow.** `landOffer = isLandOffer(text)`: the Jolshiri welcome and follow-up clock now need `isJolshiriProject(...) && !landOffer`. The FAQ agent is called with `profilesAlreadySent: profilesAlreadySent \|\| landOffer`, so no brochure bundle is sent to a land seller. | eyad `handleInbound` (hunks `@@ -333,8 +333,12` and `@@ -407,7 +411,7`); dubai the same (`@@ -430,8 +430,11` and `@@ -510,7 +513,7`) | Confirmed |
| P8 | **Brochure on "details" (prompt rule).** A new system-prompt instruction: "Details", "information", "profile", "know more", "বিস্তারিত" or "ডিটেইলস" about a project means sending the brochure in the same reply, never a yes/no offer, because "nothing tracks the answer". | `_shared/ai.ts` system prompt (hunk `@@ -144,6 +144,12`) | Confirmed (in the prompt; how the model complies is Unknown) |

**Not in git (Confirmed).** `git log --all -S` finds 0 commits for `isLandOffer`, `LAND_RE` and "land share", after a fresh `git fetch` showed no unfetched remote branch.

**The `developer` and `develop` keywords.** `LAND_RE` also matches these words, which can appear in an ordinary buyer's message ("who is the developer?"). Such a message would be treated as a land offer and skip the Jolshiri flow. This is from reading the regex; it was not run. **Likely**, and it needs a product decision.

### 12.5 Live evidence since 15:14:29 UTC (read-only SQL at 16:04:38 UTC)

| Measure | Value |
|---|---|
| Inbound messages since v58/v54 (all accounts) | 1 (Eyad) |
| "AI Agent" outbound since v58/v54 | 2 |
| English Jolshiri bundle text since v58/v54 | 2 (26 in total) |
| Price-agent text since v58/v54 | 0 (14 in total) |

So v58 is serving traffic. Its new land-offer paths (P6/P7) have no observed trigger yet. The window is 50 minutes.

### 12.6 Verification performed

| Check | Result |
|---|---|
| v58/v54 snapshot folders against their downloads (`diff -r`) | identical |
| v57/v53 snapshot folders against the first download (`diff -r`) | identical, unchanged by this step |
| v57/v53 `README.md`, `.gitattributes`, `SHA256SUMS`, `DEPLOYMENT.json` and every file, against hashes recorded before this step | unchanged |
| `sha256sum -c SHA256SUMS` in all four folders | 7/7 OK in each |
| Each `DEPLOYMENT.json` file hash and byte size, against the files | all match (28 of 28) |
| `ezbr_sha256` in `DEPLOYMENT.json` against live metadata at 16:04:20 UTC | v58 and v54 match. v57 and v53 no longer match, as expected. |
| Metadata before and after the v58/v54 download | identical, so the download is v58/v54 |

### 12.7 What this changes in sections 9 and 10

- **Deploys from outside git continue.** Production moved 9 hours after the previous deploy, and 7 minutes after this review's download. Any snapshot can go stale within minutes.
- **The deploy freeze (section 10, step 2) is now the first action,** ahead of any merge.
- **The merge in section 10, step 3 must take v58/v54 as the baseline,** so P1-P8. Redeploying from HEAD would now also remove the land-offer guard. That would let a land seller who mentions a "rate" get the price-agent script and the Jolshiri brochure flow again.
- **Before any merge, download the bundles again and compare them with the newest snapshot** (the `INDEX.md` verify loop). Add a new snapshot folder if the version moved again.
