# Meta WhatsApp Business Cloud API in Wepro

Wepro's bots talk through Wasender (an unofficial WhatsApp session). Meta's official Cloud API is added beside it for what Wasender cannot do safely: **announcements and follow-ups to people who have not written in the last 24 hours**, sent as approved templates.

Number in use: Wecon Broadcaster, Phone Number ID `1280200118502055` (from the n8n "Whatsapp Broadcasting" workflow).

## What is built

| Piece | File |
| --- | --- |
| Rules: number format, template/text payloads, Meta error kinds | `supabase/functions/_shared/meta-wa-core.ts` (+ test) |
| Sending | `supabase/functions/_shared/meta-wa.ts` |
| Endpoint | `supabase/functions/wa-meta-send` (one message per call, key-protected) |
| Command line | `scripts/meta-wa-send.mjs` |

Not built yet: receiving Meta's webhook (delivery status, replies), mirroring these messages into Conversations, a broadcast to a list. Each is a next step once one send works.

## What you need

1. **Phone Number ID** of the sending number (WhatsApp Manager > Phone numbers, or Meta app > WhatsApp > API Setup). It is not the phone number.
2. **A permanent token.** The token inside n8n's "Wecon Broadcaster" credential is encrypted and cannot be read from outside. Make one: Business Settings > Users > **System users** > add a system user > assign the WhatsApp account with full control > Generate token, with `whatsapp_business_messaging` and `whatsapp_business_management`, expiry **Never**. A token from the API Setup page expires in 24 hours.
3. **An approved template** for any message to someone outside the 24-hour window. WhatsApp Manager > Message templates > Create. Category **Marketing** for an announcement (a Utility template for an announcement is rejected or recategorised). Name in lower case with underscores, language `bn` (and `en` if wanted), an image header, a body with `{{1}}`, `{{2}}` for what changes (name, date, venue), optional buttons (call, map link, "Stop promotions"). Approval takes minutes to 24 hours.
4. **Billing** attached to the WhatsApp Business account: every marketing message is charged at Meta's Bangladesh rate.
5. **Messaging tier.** A new number can start conversations with about 250 people in 24 hours; the tier rises with volume and quality. Check it in WhatsApp Manager before a large send.
6. **Opt-in.** Meta requires recipients to have agreed to hear from you. Many reports as spam lower the quality rating and can block the number.

## Turn it on

```
npx supabase secrets set META_WA_PHONE_ID=1280200118502055 --project-ref sbqmougcvnplgjgihpwe
read -s META_WA_TOKEN
npx supabase secrets set META_WA_TOKEN="$META_WA_TOKEN" --project-ref sbqmougcvnplgjgihpwe
npx supabase functions deploy wa-meta-send --no-verify-jwt --project-ref sbqmougcvnplgjgihpwe
```

Run the lines one at a time; type the token in your own shell, never in a chat. `FOLLOWUP_CRON_KEY` is already set (the same key protects this endpoint).

## Test, in this order

```
read -s FOLLOWUP_CRON_KEY; export FOLLOWUP_CRON_KEY
# 1. Free text. First send a message FROM 01866064500 TO the Meta number, then within 24 hours:
node scripts/meta-wa-send.mjs 01866064500 --text "Test OK"
# 2. A template (once approved):
node scripts/meta-wa-send.mjs 01866064500 --template wecon_mela_announcement --lang bn --body "Rahim,4-8 Nov" --image https://i.postimg.cc/Y2m7kYFW/Wecon-Broadcaster-Header.png
```

## Reading the answer

The reply is `{ ok, kind, wamid?, code?, message? }`.

| kind | Meaning | Do |
| --- | --- | --- |
| `ok` | Accepted by Meta (`wamid` is its id) | none |
| `token` | Token missing, expired or without permission | make a permanent System User token |
| `window` | Free text outside the 24-hour window | send a template |
| `template` | Template name or language wrong, not approved or paused, or the number of variables does not match | check the name, language and variables in WhatsApp Manager |
| `not_whatsapp` | The number is not on WhatsApp, or not a real number (a hidden-number id) | skip it |
| `rate` | Sending too fast, or the tier is used up | slow down; wait for the next 24 hours |
| `quality` | Meta chose not to deliver a marketing message, or the spam limit is hit | reduce volume, improve the message |
| `payment` | No payment method on the WhatsApp account | add one in Meta billing |

## Notes

- A hidden-number contact (WhatsApp LID) has no phone number, so Meta cannot send to it.
- The old hard-coded Facebook Page token printed in the "P2P furniture" n8n workflows is a live credential that was shown in a chat: revoke it in Meta and make a new one.
- The n8n "Whatsapp Broadcasting" workflow has the recipient hard-coded and its loop wired so the send node never runs; this Edge Function replaces it for Wepro.
