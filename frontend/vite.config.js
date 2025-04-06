// frontend/vite.config.js
// Vite configuration file

import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 80,
    strictPort: true,
    hmr: {
      port: 80,
      clientPort: 8080,
      host: 'localhost',
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,  // Set to false to reduce bundle size
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true
      }
    }
  },
  envPrefix: 'VITE_',
  publicDir: 'images',
});