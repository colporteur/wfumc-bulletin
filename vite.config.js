import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Set BASE_PATH in your build env to match the GitHub Pages repo path,
// e.g. "/wfumc-bulletin/". Defaults to "/" for local dev.
const base = process.env.VITE_BASE_PATH || '/';

// Build-time stamp injected into the bundle so we can render a tiny
// version marker at the bottom of every page. Lets us answer
// "is the new version actually deployed?" at a glance.
const buildTime = new Date().toISOString();
const buildSha = (process.env.GITHUB_SHA || 'local').slice(0, 7);

export default defineConfig({
  base,
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icons/*'],
      manifest: {
        name: 'Wedowee First UMC Bulletin',
        short_name: 'WFUMC Bulletin',
        description: 'Sunday bulletin for Wedowee First United Methodist Church',
        theme_color: '#5b1a1a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
