import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
        manualChunks: {
          // Firestore is the bulk of the SDK — give it its own chunk so the rest
          // of Firebase (needed at login) stays small and loads first.
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/storage'],
          'vendor-firestore': ['firebase/firestore'],
          'vendor-pdf': ['jspdf', 'jspdf-autotable'],
          'vendor-ui': ['motion', 'lucide-react'], // project uses `motion`, not framer-motion
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
