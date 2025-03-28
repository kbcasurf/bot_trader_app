import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 3000,
    strictPort: true, // Fail if port is already in use
    
    // Proxy configuration for all API and WebSocket requests
    proxy: {
      // Proxy all API requests to backend
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      
      // Proxy all Socket.IO WebSocket requests to backend
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true, // Enable WebSocket proxy
        changeOrigin: true
      }
    },
    
    // Show detailed HMR logs
    hmr: {
      clientPort: 3000,
      overlay: true
    }
  },
  
  // Path alias for easier imports
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  
  // Build configuration
  build: {
    // Output directory
    outDir: 'dist',
    
    // Generate sourcemaps for easier debugging
    sourcemap: true,
    
    // Maximum bundle size warnings
    chunkSizeWarningLimit: 1000,
    
    // Rollup options
    rollupOptions: {
      output: {
        // Split vendor code into separate chunks
        manualChunks: {
          'vendor': ['vue', 'socket.io-client', 'axios'],
          'chart': ['chart.js']
        }
      }
    }
  },
  
  // Configure Vite to show more verbose output in console
  logLevel: 'info',
  clearScreen: false, // Don't clear the console
  
  // Define global constants
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.1.0')
  }
});
