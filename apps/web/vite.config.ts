import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Aptic Dynamics web UI. Dev proxies /api to the local API; in production nginx serves the static build
// and proxies /api to the api container on the SAME origin (so session cookies + CSRF double-submit work).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
