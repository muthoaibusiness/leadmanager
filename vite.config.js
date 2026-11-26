import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Installable app (Android + iOS home screen). The service worker is our own
    // file (src/sw.js): the plugin only builds it and injects the list of built
    // files to keep on the device. It is registered by src/lib/pwa.js, not by the
    // plugin, so an update never reloads the page under somebody's half-typed form.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        // Standalone demo pages and the invitation PDF are not part of the app.
        globIgnores: ['**/*-demo.html', '**/*.pdf'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        id: '/',
        name: 'WEPRO CRM',
        short_name: 'WEPRO',
        description: 'Real-estate lead and sales CRM',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0A0A0A',
        background_color: '#0A0A0A',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
