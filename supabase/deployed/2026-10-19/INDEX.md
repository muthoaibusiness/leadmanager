# Production snapshots, 2026-10-19: index

**Read-only evidence. Not deployable source.** Each folder is one deployed bundle, byte for byte, with `SHA256SUMS` and `DEPLOYMENT.json`. `README.md` in this folder describes the first two snapshots and is kept unchanged.

| Folder | Function | Version | Deployed (UTC) | Downloaded (UTC) | Bundle `ezbr_sha256` |
|---|---|---|---|---|---|
| `wa-bot-eyad-v57/` | `wa-bot-eyad` | 57 | 2026-10-19 06:15:24 | 2026-10-19 15:07:10 | `44731a3093b06dc5c1b205868ca0312a6549e86d709fab775c3254f74452e09f` |
| `wa-bot-dubai-v53/` | `wa-bot-dubai` | 53 | 2026-10-19 06:15:46 | 2026-10-19 15:07:10 | `37240ddfc5cb9766bc0033ad163783113a183ea18abe217fb9c94fdc2bc0556b` |
| `wa-bot-eyad-v58/` | `wa-bot-eyad` | 58 | 2026-10-19 15:14:29 | 2026-10-19 15:56:02 | `23c4e8925caea776d0ce6a65457eb16610b91f878086161c2743ce63de0a5c80` |
| `wa-bot-dubai-v54/` | `wa-bot-dubai` | 54 | 2026-10-19 15:14:37 | 2026-10-19 15:56:13 | `a5a26163359bfac75915c02f3c57a9038a2160736fc7cb44e6a83afe0b8c3fb1` |
| `wa-bot-eyad-v59/` | `wa-bot-eyad` | 59 | 2026-10-19 18:04:28 | 2026-10-19 18:14:38 | `90163b031b41dca1f2f77481139c2e286230631bd8aade044a8b8f6b0b5a03c6` |
| `wa-bot-dubai-v55/` | `wa-bot-dubai` | 55 | 2026-10-19 18:04:46 | 2026-10-19 18:14:47 | `323fac96af923d1454af61974cd72dd01da1fe8748ac5ec8b256e58d6c07f62c` |
| `wa-followup-v10/` | `wa-followup` | 10 | 2026-10-19 18:04:57 | 2026-10-19 18:14:54 | `f397266626ae1681fc2bda12e90339a284fb0620a4364759384245b5a0863252` |

| Pair | Live window (UTC) |
|---|---|
| v57 and v53 | 06:15 to 15:14 |
| v58 and v54 | 15:14 to 18:04 |
| v59 and v55, plus `wa-followup` v10 | from 18:04; unchanged at 18:15:00 |

None of these versions' bot-specific code is in git. See `docs/reports/legacy-bot-reconciliation.md`, sections 5, 12 and 13.

**Verify all seven:**

```bash
for d in wa-bot-eyad-v57 wa-bot-dubai-v53 wa-bot-eyad-v58 wa-bot-dubai-v54 wa-bot-eyad-v59 wa-bot-dubai-v55 wa-followup-v10; do (cd supabase/deployed/2026-10-19/$d && sha256sum -c --quiet SHA256SUMS && echo "$d ok"); done
```
