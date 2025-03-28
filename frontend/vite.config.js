// vite.config.js
export default {
    server: {
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
    }
  }