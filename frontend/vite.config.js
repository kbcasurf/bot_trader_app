// vite.config.js
module.exports = {
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
    sourcemap: false
    // Removed the conflicting rollupOptions configuration
  },
  // Explicitly specify public directory for static assets
  publicDir: 'images'
}