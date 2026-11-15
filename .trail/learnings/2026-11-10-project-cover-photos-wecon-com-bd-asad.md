---
title: "Project cover photos: wecon.com.bd blocks hotlinking"
author: Asad
date: 2026-11-10
branch: feat/ai-trainer-mvp
cost: { minutes: 1, tokens: 0 }
id: l-8bb60c45
scope: repo
status: active
src: agent
touches:
  - src/components/views/PropertiesView.jsx
  - src/index.css
---

Project photos live in properties.media.images ([{label,url}]); the WhatsApp bot's wa_projects.photos holds more, mostly wecon.com.bd URLs. On 2026-11-10 six of those were copied into properties.media.images as covers. Loaded in headless Chromium, most wecon.com.bd images return 403 (LiteSpeed hotlink/bot block): only the Southdale .webp loaded; Citizen Avenue, Dakshinayan, Nuznan, Osman Bellevue, Momtaz Manor and the older JM Heritage URL were blocked. A real phone browser may still be blocked. So the phone project list renders the photo as an <img> over a building icon and hides the <img> onError, so a blocked URL shows the icon, not a blank tile. The durable fix is uploading the photos to Supabase Storage (Admin console > Media upload) instead of linking wecon.com.bd.
