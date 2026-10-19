# Production snapshots, 2026-10-19

**Read-only evidence. Not deployable source. Do not edit these files, and do not deploy from this folder.**

This folder holds the exact source of two production Edge Functions on Supabase project `sbqmougcvnplgjgihpwe`, downloaded on 2026-10-19 at 15:07:10 UTC. It is kept so the live code can be reviewed and restored. The working bots are still `supabase/functions/wa-bot-eyad` and `supabase/functions/wa-bot-dubai`, which differ from these copies.

| Folder | Function | Version | Last deployed (UTC) | Bundle `ezbr_sha256` |
|---|---|---|---|---|
| `wa-bot-eyad-v57/` | `wa-bot-eyad` | 57 | 2026-10-19 06:15:24 | `44731a3093b06dc5c1b205868ca0312a6549e86d709fab775c3254f74452e09f` |
| `wa-bot-dubai-v53/` | `wa-bot-dubai` | 53 | 2026-10-19 06:15:46 | `37240ddfc5cb9766bc0033ad163783113a183ea18abe217fb9c94fdc2bc0556b` |

**What each folder contains:**

- `<entry>/index.ts` and `_shared/*.ts`: every file in the deployed bundle, byte for byte as downloaded. The files keep their CRLF line endings, and `.gitattributes` (`* -text`) stops git from converting them.
- `SHA256SUMS`: the SHA-256 of each file.
- `DEPLOYMENT.json`: the function metadata, how and when it was retrieved, and for each file the closest git commit.

Not included: `supabase/.temp/cli-latest` and `supabase/.temp/linked-project.json`. The CLI writes these when it downloads; they are not part of the deployed bundle.

**Verify integrity:**

```bash
cd supabase/deployed/2026-10-19/wa-bot-eyad-v57  && sha256sum -c SHA256SUMS
cd supabase/deployed/2026-10-19/wa-bot-dubai-v53 && sha256sum -c SHA256SUMS
```

**Compare with production again** (read-only; needs an access token):

```bash
npx supabase functions download wa-bot-eyad --project-ref sbqmougcvnplgjgihpwe --use-api --workdir /tmp/check
diff -r /tmp/check/supabase/functions supabase/deployed/2026-10-19/wa-bot-eyad-v57 -x SHA256SUMS -x DEPLOYMENT.json
```

**How these files relate to git.** The deployment metadata records no commit. Comparing the source shows the following:

- Each bundle's `_shared/wa.ts`, `trainer-live.ts`, `trainer-deno.ts`, `trainer-core.ts` and `trainer-handler.ts` match a git commit exactly, once carriage returns are stripped.
- Both `index.ts` files and `_shared/ai.ts` are commit `96661e9` plus edits found in no git object.

The full analysis is in `docs/reports/legacy-bot-reconciliation.md`.
