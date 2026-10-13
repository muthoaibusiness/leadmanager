# Statement templates

Vendor layouts for expense statements (Admin → Inventory → New statement → Template).

- `index.js` is the registry and the renderer. The in-app preview, the printed PDF and the
  public share page (the `finance` Edge Function) all draw from it, so they always match.
- `*.pdf` are sample receipts from each vendor, kept for reference while building the template.

## Adding a vendor (Meta, Google, …)

1. Put a sample receipt here, e.g. `Meta.pdf`.
2. Add an entry to `TEMPLATES` in `index.js`:

   ```js
   meta: {
     id: 'meta', name: 'Meta', layout: 'receipt', currency: 'USD', accent: '#0866FF',
     vendor: { name: 'Meta Platforms, Inc.', address: ['1 Meta Way', 'Menlo Park, CA 94025', 'United States'] },
     refLabel: 'Transaction ID',
     defaults: { title: 'Meta ads', billTo: '…', lines: [{ description: 'Ads', qty: 1, unitPrice: 0 }] },
   },
   ```

   `layout: 'receipt'` reuses the vendor-receipt layout. If a vendor needs a different look,
   add a renderer function to `RENDERERS` and point `layout` at it.
3. Redeploy the function so share links use the new template:
   `npx supabase functions deploy finance --no-verify-jwt --use-api`

A statement made from a template is our internal record of the charge, not the vendor's
document: it is headed STATEMENT and its footer says WEPRO prepared it from the vendor's
receipt. Keep it that way for new vendors. Logos go in `logos/` as an SVG string module.
