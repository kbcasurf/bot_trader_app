// vite.config.js
export default {
  server: {
    host: '0.0.0.0',
    port: 80,
    strictPort: true,
    proxy: {
      // Proxy all Socket.IO requests
      '/socket.io': {
        target: 'http://backend:3000',
        ws: true,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path
      },
      // Proxy all API requests
      '/api': {
        target: 'http://backend:3000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  preview: {
    port: 80
  }
}