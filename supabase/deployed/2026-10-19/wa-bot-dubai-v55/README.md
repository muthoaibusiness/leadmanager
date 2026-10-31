# Production snapshot: `wa-bot-dubai` v55

**Read-only evidence. Not deployable source. Do not edit these files, and do not deploy from this folder.**

| | |
|---|---|
| Project | `sbqmougcvnplgjgihpwe` |
| Function | `wa-bot-dubai`, version **55**, ACTIVE, `verify_jwt` false |
| Last deployed | 2026-10-19 18:04:46 UTC (deployer and source tree not recorded by Supabase) |
| Bundle `ezbr_sha256` | `323fac96af923d1454af61974cd72dd01da1fe8748ac5ec8b256e58d6c07f62c` |
| Downloaded | 2026-10-19 18:14:47 UTC with `supabase functions download wa-bot-dubai --use-api` |
| Metadata read | 18:14:23 UTC (before the download) and 18:15:00 UTC (after); same version and bundle hash both times |
| Previous snapshot | wa-bot-dubai-v54 (v54) |

The files are the deployed bundle, byte for byte. `SHA256SUMS` holds their hashes, and `DEPLOYMENT.json` holds the metadata and each file's relation to the previous snapshot.

**What changed:** `_shared/ai.ts` adds `brochureCaption()` (byte-identical to `wa-bot-eyad` v59). `wa-bot-dubai/index.ts` uses it for the Jolshiri bundle captions. Every other file is byte-identical to the previous snapshot.

Full analysis: `docs/reports/legacy-bot-reconciliation.md`, section 13.

**Verify:**

```bash
cd supabase/deployed/2026-10-19/wa-bot-dubai-v55 && sha256sum -c SHA256SUMS
```
