# Statement templates

Vendor layouts for expense statements (Admin → Inventory → New statement → Category).
Choosing **Meta** or **Supabase** as the statement's category lays it out like that vendor's
receipt; any other category uses WEPRO's own statement. The editor shows the chosen layout in
its live preview.

- The registry and the renderer live in `supabase/functions/_shared/finance-doc.js`
  (`TEMPLATES`, `templateForCategory`, `renderStatement`). The in-app preview, the printed PDF
  and the public share page (the `finance` Edge Function) all draw from it, so they always
  match. It sits under `supabase/functions` so the function deploy bundles it.
- Logos are SVG string modules in `supabase/functions/_shared/logos/`; their SVG sources are
  kept here in `logos/`.
- `*.pdf` are sample receipts from each vendor, kept for reference while building a template.

## Adding a vendor (Google, …)

1. Put a sample receipt here, e.g. `Google.pdf`, and its logo SVG in `logos/`.
2. Add the logo as `supabase/functions/_shared/logos/google.js` (`export default "<svg …>"`).
3. Add an entry to `TEMPLATES` in `finance-doc.js`:

   ```js
   google: {
     id: 'google', name: 'Google', layout: 'receipt', currency: 'USD', accent: '#1A73E8',
     logo: googleLogo, wordmark: '', logoHeight: 30,   // import googleLogo from './logos/google.js'
     vendor: { name: 'Google Asia Pacific Pte. Ltd.', address: ['…'] },
     refLabel: 'Invoice number',
     defaults: { title: 'Google Ads', billTo: OUR_ORG, lines: [{ description: 'Ads', qty: 1, unitPrice: 0 }], months: 1 },
   },
   ```

   `meta` is a full example. `columns: 'impressions'` swaps Quantity · Rate for
   Impressions · CPM (impressions fill in from amount ÷ CPM × 1000); `defaults.months` sets the
   default duration. `layout: 'receipt'` reuses the vendor-receipt layout. If a vendor needs a
   different look, add a renderer to `VENDOR_RENDERERS` and point `layout` at it.
4. To pick it from the category dropdown, add the category to `CATEGORIES` and map it in
   `CATEGORY_TEMPLATES`.
5. Redeploy the function so share links use the new template:
   `npx supabase functions deploy finance --no-verify-jwt --use-api`

A statement made from a template is our internal record of the charge, not the vendor's
document: it is headed STATEMENT and its footer says WEPRO prepared it from the vendor's
receipt. Keep it that way for new vendors.
