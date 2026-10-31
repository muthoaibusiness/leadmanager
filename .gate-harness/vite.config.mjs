import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Root = this dir, so nothing outside .gate-harness/ is copied or built.
  root: here,
  publicDir: false, // the repo's public/ (demo pages, favicon) stays out
  plugins: [react()],
  base: './',
  resolve: {
    alias: [
      // LeadPanel/FollowUpModal import useApp from the real context; the
      // harness swaps in a minimal stand-in so the whole app is not bundled.
      { find: /.*context\/AppContext\.jsx$/, replacement: resolve(here, 'appContextStub.jsx') },
    ],
  },
  build: {
    outDir: resolve(here, 'dist'), // absolute: never the repo-root dist/
    emptyOutDir: true,
    rollupOptions: { input: resolve(here, 'main.html') },
  },
  define: {
    // Harness must not touch the network: supabase.js reads these at import.
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://harness.invalid'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('hide-from-gate'),
  },
});
