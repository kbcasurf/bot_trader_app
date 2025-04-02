// vite.config.js
export default {
  server: {
    host: '0.0.0.0',
    port: 80,
    proxy: {
      '/socket.io': {
        target: 'http://backend:3000',
        ws: true,
        changeOrigin: true,
        secure: false,
        // These additional options improve WebSocket handling
        rewrite: (path) => path,
        // Properly handle socket.io
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        }
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
  // Add optimization for production build
  build: {
    outDir: 'dist',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor code into a separate chunk
          vendor: ['socket.io-client'],
          // Create a separate chunk for the application code
          app: ['./js/conns.js', './js/dashboard.js']
        }
      }
    }
  }
}