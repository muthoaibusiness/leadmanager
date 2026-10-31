import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
// Render check for Admin › Meta CAPI: real panel, real capi-core, fixtures only.
export default defineConfig({ root: here, publicDir: false, plugins: [react()],
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://harness.invalid'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('harness') } });
