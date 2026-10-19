# Production snapshot: `wa-bot-dubai` v54

**Read-only evidence. Not deployable source. Do not edit these files, and do not deploy from this folder.**

| | |
|---|---|
| Project | `sbqmougcvnplgjgihpwe` |
| Function | `wa-bot-dubai`, version **54**, ACTIVE, `verify_jwt` false |
| Last deployed | 2026-10-19 15:14:37 UTC (deployer and source tree not recorded by Supabase) |
| Bundle `ezbr_sha256` | `a5a26163359bfac75915c02f3c57a9038a2160736fc7cb44e6a83afe0b8c3fb1` |
| Downloaded | 2026-10-19 15:56:13 UTC with `supabase functions download wa-bot-dubai --use-api` |
| Metadata read | 15:55:38 UTC (before the download) and 15:59:32 UTC (after); same version and bundle hash both times |
| Previous snapshot | `../wa-bot-dubai-v53/` (v53) |

The files are the deployed bundle, byte for byte, with their CRLF line endings. `SHA256SUMS` holds their hashes, and `DEPLOYMENT.json` holds the metadata and each file's relation to v53 and to git.

**What changed from v53.** Five shared files are byte-identical. Two files changed:

- `_shared/ai.ts` adds `isLandOffer` / `LAND_RE`, and `isPriceQuestion` no longer fires on land offers. It also adds a prompt rule: requests for "details" or "information" get the brochure, never a yes/no offer. This `ai.ts` is byte-identical to the one in `wa-bot-eyad` v58.
- `wa-bot-dubai/index.ts` adds a land-offer check that skips the Jolshiri welcome and brochure flow.

None of these additions is in any git object. Full analysis: `docs/reports/legacy-bot-reconciliation.md`, section 12.

**Verify:**

```bash
cd supabase/deployed/2026-10-19/wa-bot-dubai-v54 && sha256sum -c SHA256SUMS
```
