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
    commonjsOptions: {
      // Improved CommonJS compatibility options
      transformMixedEsModules: true,
      include: [/node_modules/, /\.js$/]
    },
    rollupOptions: {
      output: {
        // Support for legacy browsers if needed
        format: 'iife',
        // Split vendor code into a separate chunk
        manualChunks: {
          vendor: ['socket.io-client'],
          // Create a separate chunk for the application code
          app: ['./js/conns.js', './js/dashboard.js']
        },
        // Ensure assets are handled correctly
        assetFileNames: 'assets/[name]-[hash][extname]',
      }
    },
    // Make sure assets are copied to the dist folder
    assetsInclude: ['**/*.svg', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif'],
  },
  // Explicitly specify public directory for static assets
  publicDir: 'images',
  // Better handling of CommonJS modules
  optimizeDeps: {
    include: ['socket.io-client'],
    // Ensure proper handling of CJS/ESM interop
    esbuildOptions: {
      // Needed for CommonJS compatibility
      format: 'cjs',
      // Support for legacy browsers
      target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']
    }
  },
  // Resolve CommonJS and ESM modules
  resolve: {
    // Provide both CommonJS and ESM field resolutions
    mainFields: ['browser', 'module', 'jsnext:main', 'main'],
    // Help Vite understand CommonJS modules
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
  }
}