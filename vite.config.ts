import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Phase P — installable PWA. ASSET PRECACHE ONLY: no runtimeCaching for
    // firestore.googleapis.com (Firestore streams over channels workbox cannot
    // cache; its own IndexedDB persistence is the offline data layer).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['images/logo-finvastra.png'],
      manifest: {
        name: 'Finvastra Pulse',
        short_name: 'Pulse',
        description: 'Finvastra HRMS, CRM and MIS — one internal platform.',
        theme_color: '#0B1538',
        background_color: '#050d1f',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Large code-split app — raise the precache size ceiling (xlsx chunk ~430kB).
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // SPA fallback for offline navigation; never intercept API or Google endpoints.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into their own long-cached chunks so the
        // main entry stays small and route chunks (see router.tsx) load on demand.
        // NOTE: jspdf is deliberately NOT manual-chunked. As a static (object-form)
        // manual chunk it was emitted as a <link modulepreload> in the entry HTML
        // and preheated on every load (~134 kB br) though it's only used by lazy
        // PDF routes (payslips/letters/MIS payouts/offboarding/…). Left to Rollup,
        // jspdf is hoisted into a shared ASYNC chunk loaded on demand by those
        // routes — never on the home/module-picker critical path.
        manualChunks: {
          // Firestore is the bulk of the SDK — give it its own chunk so the rest
          // of Firebase (needed at login) stays small and loads first.
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/storage'],
          'vendor-firestore': ['firebase/firestore'],
          'vendor-ui': ['motion', 'lucide-react'], // project uses `motion`, not framer-motion
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
