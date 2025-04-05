// vite.config.js
import { defineConfig } from 'vite';
import { createRequire } from 'module'; // For Node.js native CommonJS support

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 80,
    proxy: {
      '/socket.io': {
        target: 'http://backend:3000',
        ws: true,
        changeOrigin: true,
        secure: false
      },
      '/api': {
        target: 'http://backend:3000',
        changeOrigin: true,
        secure: false
      },
      '/health': {
        target: 'http://backend:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    minify: 'esbuild',
    sourcemap: false,
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/, /\.js$/]
    }
  },
  optimizeDeps: {
    include: ['socket.io-client']
  },
  publicDir: 'images'
});