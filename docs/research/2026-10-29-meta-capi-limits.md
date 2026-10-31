# Meta Conversions API limits: research for the scheduled CTWA sender (2026-10-29)

Method: fetched Meta developer pages and quoted them. Fetch tool returns a summarised page, so quotes are as returned by the tool; re-verify exact wording on the page before relying on them. No Meta endpoint was called.

Pages fetched:
- A. https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api (mirror: https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api)
- B. https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging (mirror: .../documentation/ads-commerce/conversions-api/business-messaging)
- C. https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events
- D. https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- E. https://developers.facebook.com/docs/marketing-api/overview/rate-limiting
- F. https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
- G. https://developers.facebook.com/docs/marketing-api/conversions-api/best-practices

404 (not found): .../conversions-api/conversion-api-messaging, .../handling-errors, .../verify-your-setup, .../best-practices/handle-dropped-events, https://developers.facebook.com/docs/graph-api/reference/page/events-conversions-api

## Summary

| # | Question | Answer | Status | Source |
|---|---|---|---|---|
| 1a | Requests-per-time limit on /events | "There is no specific rate limit for the Conversions API." Calls count as Marketing API calls | Confirmed | A |
| 1b | Headers | X-App-Usage, X-Business-Use-Case-Usage, X-Ad-Account-Usage documented generally; none documented as returned by /events | Confirmed (headers) / Not documented (on /events) | D, E |
| 1c | estimated_time_to_regain_access | Documented, in minutes, in the BUC header | Confirmed | D, E |
| 2a | Max events per request | 1,000 | Confirmed | A |
| 2b | Max payload size | Not stated | Not documented | A, B, G |
| 2c | One bad event rejects batch? | Request returns error, but valid events with event_id still accepted; event_time >7d rejects whole request | Confirmed | A |
| 3a | event_time past | Up to 7 days; older rejects entire request | Confirmed | A, F |
| 3b | event_time future | Not stated | Not documented | A, F |
| 3c | Different window for business_messaging | Not stated for event_time. B gives a 7-day attribution rule on the no-ctwa_clid path only | Not documented | B |
| 4a | LeadSubmitted valid for business_messaging+whatsapp | Listed as supported event | Confirmed | B |
| 4b | ctwa_clid required | Not required: alternative path is page_id + hashed customer param. "Send ctwa_clid whenever you have it." | Confirmed | B |
| 4c | Send window after click | Only: attributes to interaction from past 7 days; later still accepted, not attributed (stated for the hashed-info path). No window stated for ctwa_clid path | Partly confirmed / Not documented for ctwa_clid | B |
| 4d | page_id required | Yes on the page_id/hashed-info path ("rejected" without it). For the ctwa_clid path, B lists whatsapp_business_account_id + ctwa_clid as the params; but a B quote also says omitting page_id is rejected when ctwa_clid is sent | Confirmed, with internal tension | B |
| 5a | Dedup key | event_id + event_name; first copy kept | Confirmed | A, C |
| 5b | Dedup window | 48 hours (browser+server page C) | Confirmed (C); not stated on A | C |
| 5c | Server-only duplicates | CONFLICT: C says server-only is not deduplicated and consecutive identical server events are both kept; A says same event_id+event_name keeps first and batch retries are safe; B says Meta does not assist with dedup for CAPI for Business Messaging | Conflicting sources | A, B, C |
| 6a | Throttle codes | 4, 17, 32, 613, 80004 documented generally; none tied to /events | Confirmed (general) | D, E |
| 6b | Retry-After header | Not mentioned | Not documented | D, E, A |
| 6c | Backoff guidance | Documented generally | Confirmed (general) | D, E |
| 7a | events_received meaning | Not found on any fetched page | Not documented | A, B, G |
| 7b | 200 with dropped events / messages warnings | Not found | Not documented | A, B, G |

## 1. Rate limits

- Answer: no specific limit; Marketing API logic.
- Quotes (A): "There is no specific rate limit for the Conversions API." / "Conversions API calls are counted as Marketing API calls." / "The Marketing API has its own rate-limiting logic and is excluded from all the Graph API rate limitations."
- No per-app/ad-account/BUC figure or throughput number for /events was found. Page D's BUC endpoint list (Ads Insights, Ads Management, Catalog, Custom Audience, Instagram Platform, LeadGen, Messenger, Pages, Spark AR, Threads, WhatsApp Business Management) does not include the dataset events endpoint. Not documented for /events specifically.
- Headers (D): "will include a `X-App-Usage` or `X-Ad-Account-Usage` (for v3.3 and older Ads API calls) HTTP header"; "All API responses made by your app that are rate limited using the BUC logic include an `X-Business-Use-Case-Usage` … HTTP header with a JSON-formatted string". E: X-Ad-Account-Usage contains "acc_id_util_pct, reset_time_duration and ads_api_access_tier"; BUC header has "call_count, total_cputime, total_time and estimated_time_to_regain_access".
- estimated_time_to_regain_access (D): "Time, in minutes, until calls will not longer be throttled." (sic)
- Which header an /events response carries: Not documented.

## 2. Batch limits

- A: "You can send up to 1,000 events in `data`."
- Payload size: not stated on A, B, G. Not documented.
- A: "If any event in a batch is invalid, the request returns an error — but valid events with an `event_id` are still accepted." / "Fix the invalid events and resend the whole batch; the events we already stored are dropped as duplicates, with no double-counting." / "If any `event_time` in `data` is greater than 7 days in the past, we return an error for the entire request and process no events."

## 3. event_time

- A: "The `event_time` can be up to 7 days before you send an event to Meta." / "The specified time may be earlier than the time you send the event to Facebook." F: "A Unix timestamp in seconds indicating when the actual event occurred."
- A also: "for optimal performance, we recommend you send events as soon as they occur and ideally within an hour of the event occurring."
- Future timestamps: Not documented (A, F).
- business_messaging window: Not documented for event_time. B (hashed-info path): "It attributes an event to an ad interaction from the past seven days. A conversion you report after that is still accepted, but is not attributed."
- Note: the 7-day rule is measured against event_time, not click time. A daily batch with event_time = original lead creation time must be <7 days old or the ENTIRE request fails.

## 4. Business messaging / CTWA

- B supported events: "Purchase, LeadSubmitted, InitiateCheckout, AddToCart, ViewContent, OrderCreated, OrderShipped, OrderDelivered, OrderCanceled, OrderReturned, CartAbandoned, QualifiedLead, RatingProvided, ReviewProvided." Sample payloads use "action_source": "business_messaging" and "messaging_channel": "whatsapp". LeadSubmitted and QualifiedLead are not defined on the page.
- ctwa_clid: "Send `ctwa_clid` whenever you have it." Required user_data for WhatsApp: "whatsapp_business_account_id" + "ctwa_clid"; without ctwa_clid: page_id plus at least one hashed customer parameter.
- page_id: "an event that omits `page_id` is rejected even when it carries valid customer information." / "Include `page_id` in `user_data` on this path."
- Note: the plan sends ctwa_clid + page_id and no whatsapp_business_account_id. The B summary lists whatsapp_business_account_id as a WhatsApp param; whether it is required is not resolved by the quotes. Verify with Test Events.
- Send window after click: Not documented for the ctwa_clid path.
- Access tier (B): "an error rate of less than 10% in the past 15 days."

## 5. Deduplication

- A: "Send an event_id with every event so we can deduplicate" / "if we receive the same event_id and event_name more than once, we keep only the first copy." / "That makes batch retries safe."
- C: "We determine if events are identical based on their ID and name." / "events are only deduplicated if they are received within 48 hours" / "Does not deduplicate events when only using one event source, that is browser-only or server-only." / "If you send us two consecutive server events with the same information, we do not discard either."
- B: "Meta does not assist with deduplicating events for Conversions API for Business Messaging so we highly encourage advertisers to perform deduplication" before sending.
- Result: the pages conflict. Page B is the most specific to this channel and says dedup is the advertiser's job. Page C says server-only dups are kept. Page A says first copy kept. Whether a lead sent at creation and again days later with the same event_id is dropped or counted twice is NOT resolved by Meta docs. Treat as: may be counted twice; dedup on our side. Neither 48h applies to days-later resends per C.

## 6. Errors

- Codes (D): 4 "Indicates that the app whose token is being used in the request has reached its rate limit."; 17 "...the User whose token is being used in the request has reached their rate limit."; 32 "...the User or app whose token is being used in the Pages API request has reached its rate limit."; 613 "Indicates that a custom rate limit has been reached."; 80004 listed with subcode 2446079 (Ads Management). E lists 80004 among "too many calls from this ad-account".
- None is documented specifically for /events.
- Retry-After: not mentioned on D, E, A. Not documented.
- Backoff (D): "When the limit has been reached, stop making API calls. Continuing to make calls will continue to increase your call count, which will increase the time before calls will be successful again." / "Spread out queries evenly to avoid traffic spikes." E: "Implement exponential backoff when receiving throttling errors, gradually increasing the time between retries. You can also examine HTTP headers for the reset time estimation."

## 7. Response

- events_received, fbtrace_id, messages: no fetched page describes them (A explicitly has no response-body section). The "Handle Dropped Events" video topic is listed on G, but its text was absent from A. Not documented; whether a 200 may include dropped events is not stated.
- Only related quote (A): "If any event in a batch is invalid, the request returns an error — but valid events with an `event_id` are still accepted."

## Implications for the scheduled sender

Only what the sources support:
- No documented /events rate limit. Generic Marketing API throttling guidance applies: stop on throttle, back off exponentially, spread calls (D, E). Retry-After and the header set returned by /events are not documented, so read headers defensively.
- Up to 1,000 events per request (A). One request with any event_time >7 days old fails entirely, so send only events with event_time within 7 days, or set event_time per policy and split batches by age.
- Meta says send as soon as possible, ideally within an hour (A). A daily 21:00 batch departs from that recommendation; the effect on attribution is not documented.
- Resending with the same event_id+event_name: A says first copy is kept; B says Meta does not dedupe for Business Messaging; C says server-only is not deduped. Do not rely on Meta; keep a sent-marker per lead.
- Use LeadSubmitted or QualifiedLead: both are supported; semantics undefined by Meta. Which fits "agent qualified" is unresolved.
- Keep ctwa_clid + page_id; page_id omission is rejected (B). Reported events after 7 days from the ad interaction are accepted but not attributed (B, stated for the hashed path).
- Do not infer success from HTTP 200 alone; the response contract is undocumented. Validate with the Test Events tool before launch.
