// vite.config.js
export default {
  server: {
    host: '0.0.0.0',
    port: 80,
    proxy: {
      '/socket.io': {
        target: 'http://backend:3000',
        ws: true,
        changeOrigin: true
      },
      '/api': {
        target: 'http://backend:3000',
        changeOrigin: true
      }
    }
  },
  // Add optimization for production build
  build: {
    outDir: 'dist',
    minify: 'esbuild',
    sourcemap: false
  }
}