// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 80,
    proxy: {
      // Socket.io proxy configuration with proper WebSocket support
      '/socket.io': {
        target: 'http://backend:3000',
        ws: true,
        changeOrigin: true,
        secure: false,
        // Important: Configure socket.io specifics
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.warn('Proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Sending request to the target:', req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Received response from the target:', proxyRes.statusCode, req.url);
          });
        }
      },
      
      // API endpoint proxy
      '/api': {
        target: 'http://backend:3000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      
      // Health check endpoint proxy
      '/health': {
        target: 'http://backend:3000',
        changeOrigin: true
      }
    }
  },
  
  build: {
    outDir: 'dist',
    minify: 'esbuild',
    sourcemap: process.env.NODE_ENV !== 'production',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['socket.io-client']
        }
      }
    }
  },
  
  optimizeDeps: {
    include: ['socket.io-client']
  },
  
  // Make sure static assets are correctly handled
  publicDir: 'images',
  
  // Resolve aliases if needed
  resolve: {
    alias: {
      '@': '/src',
    }
  }
});