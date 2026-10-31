# Production snapshot: `wa-bot-eyad` v59

**Read-only evidence. Not deployable source. Do not edit these files, and do not deploy from this folder.**

| | |
|---|---|
| Project | `sbqmougcvnplgjgihpwe` |
| Function | `wa-bot-eyad`, version **59**, ACTIVE, `verify_jwt` false |
| Last deployed | 2026-10-19 18:04:28 UTC (deployer and source tree not recorded by Supabase) |
| Bundle `ezbr_sha256` | `90163b031b41dca1f2f77481139c2e286230631bd8aade044a8b8f6b0b5a03c6` |
| Downloaded | 2026-10-19 18:14:38 UTC with `supabase functions download wa-bot-eyad --use-api` |
| Metadata read | 18:14:23 UTC (before the download) and 18:15:00 UTC (after); same version and bundle hash both times |
| Previous snapshot | wa-bot-eyad-v58 (v58) |

The files are the deployed bundle, byte for byte. `SHA256SUMS` holds their hashes, and `DEPLOYMENT.json` holds the metadata and each file's relation to the previous snapshot.

**What changed:** `_shared/ai.ts` adds `brochureCaption()`: brochure captions name the sector ("Wecon Nuznan (Sector 16, Jolshiri Abashon) — Brochure"). `wa-bot-eyad/index.ts` uses it for the Jolshiri bundle and for `/send`. Every other file is byte-identical to the previous snapshot.

Full analysis: `docs/reports/legacy-bot-reconciliation.md`, section 13.

**Verify:**

```bash
cd supabase/deployed/2026-10-19/wa-bot-eyad-v59 && sha256sum -c SHA256SUMS
```
