# Production snapshot: `wa-bot-eyad` v58

**Read-only evidence. Not deployable source. Do not edit these files, and do not deploy from this folder.**

| | |
|---|---|
| Project | `sbqmougcvnplgjgihpwe` |
| Function | `wa-bot-eyad`, version **58**, ACTIVE, `verify_jwt` false |
| Last deployed | 2026-10-19 15:14:29 UTC (deployer and source tree not recorded by Supabase) |
| Bundle `ezbr_sha256` | `23c4e8925caea776d0ce6a65457eb16610b91f878086161c2743ce63de0a5c80` |
| Downloaded | 2026-10-19 15:56:02 UTC with `supabase functions download wa-bot-eyad --use-api` |
| Metadata read | 15:55:38 UTC (before the download) and 15:59:32 UTC (after); same version and bundle hash both times |
| Previous snapshot | `../wa-bot-eyad-v57/` (v57) |

The files are the deployed bundle, byte for byte, with their CRLF line endings. `SHA256SUMS` holds their hashes, and `DEPLOYMENT.json` holds the metadata and each file's relation to v57 and to git.

**What changed from v57.** Five shared files are byte-identical. Two files changed:

- `_shared/ai.ts` adds `isLandOffer` / `LAND_RE`, and `isPriceQuestion` no longer fires on land offers. It also adds a prompt rule: requests for "details" or "information" get the brochure, never a yes/no offer.
- `wa-bot-eyad/index.ts` adds a land-offer check that skips the Jolshiri welcome and brochure flow.

None of these additions is in any git object. Full analysis: `docs/reports/legacy-bot-reconciliation.md`, section 12.

**Verify:**

```bash
cd supabase/deployed/2026-10-19/wa-bot-eyad-v58 && sha256sum -c SHA256SUMS
```
