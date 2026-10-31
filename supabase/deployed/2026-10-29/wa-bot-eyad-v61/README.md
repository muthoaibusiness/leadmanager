# Production snapshot: `wa-bot-eyad` v61

**Read-only evidence and the CR-002 rollback bundle. Do not edit these files.**

| | |
|---|---|
| Project | `sbqmougcvnplgjgihpwe` |
| Function | `wa-bot-eyad`, version **61**, ACTIVE, `verify_jwt` false |
| Last deployed | 2026-10-19 20:03:49 UTC (deployer and source tree not recorded by Supabase) |
| Bundle `ezbr_sha256` | `7cd431da1a965fb0494e374199d3dd596f7d7517897f6fd98cc97620c9a4ac22` |
| Downloaded | 2026-10-29 09:33:30 UTC with `supabase functions download wa-bot-eyad --use-api` (CLI 2.122.0) |
| Metadata read | 09:33:14 UTC (before the download) and 09:33:36 UTC (after): the same version and bundle hash both times |
| Cross-check | Byte-identical to a separate download of the same version at 07:28 UTC the same day |
| Previous snapshot | `../../2026-10-19/wa-bot-eyad-v59` |

The files are the deployed bundle, byte for byte, with CRLF line endings. `SHA256SUMS` holds their hashes, and `DEPLOYMENT.json` holds the metadata and each file's relation to v59. `.gitattributes` (`* -text`) in the parent folder keeps git from changing the bytes.

**What changed from v59:**
- `wa-bot-eyad/index.ts` adds the ad-lead welcome rule. A `property_interest` filled in from `wa_settings.default_project` no longer counts as a Jolshiri lead. Only an ad signal (`isAd`, `ctwa_clid`, `wa_ad_id`) or a named project does, and a defaulted project is not passed to the model.
- `_shared/ai.ts` adds the "No project is known… ask which one" rule to the FAQ prompt.
- The other five files are byte-identical to v59.

CR-002 ports both rules into git as `leadContext()` and the same prompt text.

**Secrets:** none. Secrets are read only through `Deno.env.get`. The Meta pixel and page ids in `sendMetaCapiEvent` are identifiers, not credentials.

**Verify:**

```bash
cd supabase/deployed/2026-10-29/wa-bot-eyad-v61 && sha256sum -c SHA256SUMS
```

**Rollback (CR-002 §9), only after a later `wa-bot-eyad` deploy goes wrong:**

```bash
rm -rf /tmp/rb && mkdir -p /tmp/rb/supabase/functions
cp -r supabase/deployed/2026-10-29/wa-bot-eyad-v61/{_shared,wa-bot-eyad} /tmp/rb/supabase/functions/
cd /tmp/rb && npx supabase functions deploy wa-bot-eyad --no-verify-jwt --project-ref sbqmougcvnplgjgihpwe
```

The deploy bundles only the files that `wa-bot-eyad/index.ts` imports, and all seven are here.
