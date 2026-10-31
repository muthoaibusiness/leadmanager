# Production snapshot: `wa-followup` v10

**Read-only evidence. Not deployable source. Do not edit these files, and do not deploy from this folder.**

| | |
|---|---|
| Project | `sbqmougcvnplgjgihpwe` |
| Function | `wa-followup`, version **10**, ACTIVE, `verify_jwt` false |
| Last deployed | 2026-10-19 18:04:57 UTC (deployer and source tree not recorded by Supabase) |
| Bundle `ezbr_sha256` | `f397266626ae1681fc2bda12e90339a284fb0620a4364759384245b5a0863252` |
| Downloaded | 2026-10-19 18:14:54 UTC with `supabase functions download wa-followup --use-api` |
| Metadata read | 18:14:23 UTC (before the download) and 18:15:00 UTC (after); same version and bundle hash both times |
| Previous snapshot | none (first snapshot of this function) |

The files are the deployed bundle, byte for byte. `SHA256SUMS` holds their hashes, and `DEPLOYMENT.json` holds the metadata and each file's relation to the previous snapshot.

**What changed:** `wa-followup/index.ts` uses `brochureCaption()` for its scheduled bundle sends. `_shared/ai.ts` and `_shared/wa.ts` are byte-identical to `wa-bot-eyad` v59. `index.ts` uses LF line endings; the shared files use CRLF. Every other file is byte-identical to the previous snapshot.

Full analysis: `docs/reports/legacy-bot-reconciliation.md`, section 13.

**Verify:**

```bash
cd supabase/deployed/2026-10-19/wa-followup-v10 && sha256sum -c SHA256SUMS
```
