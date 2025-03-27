import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  
  return {
    plugins: [vue()],
    server: {
      host: '0.0.0.0', // Listen on all network interfaces
      port: 3000,
      strictPort: true, // Fail if port is already in use
      
      // Configure proxy for backend API during development
      proxy: {
        // Proxy /api requests to backend
        '/api': {
          target: env.VITE_API_URL?.replace('/api', ''),
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '/api')
        },
        
        // Proxy WebSocket requests
        '/socket.io': {
          target: env.VITE_WEBSOCKET_URL,
          ws: true, // Enable WebSocket proxy
          changeOrigin: true
        }
      },
      
      // CORS configuration
      cors: true,
      
      // Display network URLs for easier access in Docker
      hmr: {
        // Show detailed HMR logs
        clientPort: 3000,
        overlay: true
      }
    },
    
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    
    // Build configuration
    build: {
      // Sourcemaps for debugging
      sourcemap: mode !== 'production', 
      
      // Maximum bundle size warnings
      chunkSizeWarningLimit: 1000,
      
      // Output directory
      outDir: 'dist',
      
      // Plugin options
      rollupOptions: {
        output: {
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
    
    // Define global constants for your app
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
      __DEV_MODE__: mode !== 'production'
    }
  };
});