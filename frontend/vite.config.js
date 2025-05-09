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
      host: process.env.EXTERNAL_HOST || 'localhost',
    },
    proxy: {
      // Proxy all socket.io requests to the backend
      '/socket.io': {
        target: process.env.VITE_BACKEND_URL || 'http://backend:3000',
        ws: true, // Enable WebSocket proxying
        changeOrigin: true,
        secure: false
      },
      // Proxy API requests to backend
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://backend:3000',
        changeOrigin: true,
        secure: false
      },
      // Proxy health check to backend
      '/health': {
        target: process.env.VITE_BACKEND_URL || 'http://backend:3000',
        changeOrigin: true,
        secure: false
      }
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