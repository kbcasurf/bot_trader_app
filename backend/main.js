// backend/main.js
// Main application entry point for the backend server

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load internal modules
const binance = require('./js/binance');
const db = require('./js/dbconns');
const telegram = require('./js/telegram');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Log environment information - only for debugging
console.log('====== ENVIRONMENT DEBUG INFO ======');
console.log(`API URL: ${process.env.BINANCE_API_URL}`);
console.log(`WebSocket URL: ${process.env.BINANCE_WEBSOCKET_URL}`);
console.log(`Using testnet environment: ${process.env.BINANCE_API_URL?.includes('testnet') ? 'YES' : 'NO'}`);
console.log('===================================');

// Create Express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Create Socket.IO server
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Application state
const appState = {
  serverStartTime: new Date(),
  clients: new Set(),
  isDbConnected: false,
  isBinanceConnected: false
};

// Server startup
async function startServer() {
  const PORT = process.env.PORT || 3000;
  
  try {
    // Set up API routes first to ensure the health endpoint is available early
    setupApiRoutes();
    
    // Start HTTP server early so health checks can succeed
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
    
    // Set up socket.io connection
    setupSocketIO();
    
    // Initialize services in parallel
    console.log('Initializing services...');
    
    try {
      // Initialize database with a timeout
      console.log('Initializing database connection...');
      const dbPromise = Promise.race([
        db.initialize(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database initialization timeout')), 30000))
      ]);
      const dbInitialized = await dbPromise;
      appState.isDbConnected = dbInitialized;
      console.log('Database connected:', dbInitialized);
    } catch (dbError) {
      console.error('Database initialization error:', dbError);
      appState.isDbConnected = false;
    }
    
    try {
      // Initialize Telegram
      console.log('Initializing Telegram bot...');
      telegram.initialize();
      console.log('Telegram bot initialized');
    } catch (telegramError) {
      console.error('Telegram initialization error:', telegramError);
    }
    
    try {
      // Initialize Binance API
      console.log('Initializing Binance API...');
      const binanceInitialized = await binance.initialize();
      appState.isBinanceConnected = binanceInitialized;
      console.log('Binance API connected:', binanceInitialized);
      
      // Set up binance event handlers if connected
      if (binanceInitialized) {
        setupBinanceHandlers();
        
        // Perform initial account balance update at startup
        try {
          console.log('Performing initial account balance update...');
          await binance.updateAccountBalances();
        } catch (balanceError) {
          console.error('Error during initial account balance update:', balanceError);
          // Continue anyway - this is not critical for startup
        }
      }
    } catch (binanceError) {
      console.error('Binance initialization error:', binanceError);
      appState.isBinanceConnected = false;
    }
    
    // Send startup notification
    const statusMessage = `
      Backend server started successfully
      Database connected: ${appState.isDbConnected ? 'Yes' : 'No'}
      Binance API connected: ${appState.isBinanceConnected ? 'Yes' : 'No'}
    `;
    
    try {
      telegram.sendMessage(statusMessage);
    } catch (notificationError) {
      console.error('Failed to send startup notification:', notificationError);
    }
    
  } catch (error) {
    console.error('Error starting server:', error);
    telegram.sendErrorNotification('Failed to start server: ' + error.message);
  }
}

/**
 * Set up Binance event handlers
 */
function setupBinanceHandlers() {
  // Handle price updates
  binance.onPriceUpdate((symbol, price) => {
    // Broadcast price update to all connected clients
    io.emit('price-update', { symbol, price });
  });
  
  // Handle order updates
  binance.onOrderUpdate((orderData) => {
    // Broadcast order update to all connected clients
    io.emit('order-update', orderData);
  });
  
  // Handle connection changes
  binance.onConnectionChange((isConnected) => {
    appState.isBinanceConnected = isConnected;
    // Broadcast connection status to all connected clients
    io.emit('binance-connection', { connected: isConnected });
  });
}

/**
 * Set up Socket.IO connection and event handlers
 */
function setupSocketIO() {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    appState.clients.add(socket.id);
    
    // Send system status on connection
    sendSystemStatus(socket);
    
    // Set up event handlers
    
    // Client requests system status
    socket.on('get-system-status', () => {
      sendSystemStatus(socket);
    });
    
    // Client requests account information
    socket.on('get-account-info', async () => {
      try {
        // Get account info from Binance API
        const accountInfo = await binance.getAccountInfo();
        
        // Get balances from database (these will have been updated from the API)
        const dbBalances = await db.getAccountBalances();
        
        // Combine the data (add database balances to the response)
        const combinedAccountInfo = {
          ...accountInfo,
          databaseBalances: dbBalances
        };
        
        socket.emit('account-info', combinedAccountInfo);
      } catch (error) {
        console.error('Error fetching account info:', error);
        socket.emit('account-info', { error: error.message });
      }
    });
    
    // Client requests batch data for multiple symbols
    socket.on('batch-get-data', async (data) => {
      if (!data || !data.symbols || !Array.isArray(data.symbols)) {
        socket.emit('batch-data-result', { error: 'Invalid request' });
        return;
      }
      
      try {
        const results = {};
        
        // Before processing, verify that WebSocket is connected
        if (!binance.isConnected()) {
          throw new Error('WebSocket connection is down. Trading is halted until reconnection.');
        }
        
        // Force an update of account balances from Binance to ensure fresh data
        await binance.updateAccountBalances();
        
        // Get account balances from database (now guaranteed to be fresh from Binance)
        const accountBalances = await db.getAccountBalances();
        
        // Process each symbol
        for (const fullSymbol of data.symbols) {
          const symbol = fullSymbol.replace('USDT', '');
          
          // Get current price from WebSocket data (not API)
          const priceData = await binance.getSymbolPrice(fullSymbol);
          
          // Get trading history
          const tradingHistory = await db.getTradingHistory(symbol);
          
          // Get holdings
          const holdings = await db.getCurrentHoldings(symbol);
          
          // Calculate thresholds
          const thresholds = await db.calculateTradingThresholds(
            symbol, 
            parseFloat(priceData.price)
          );
          
          // Get the balance from the database (prefer this over calculated holdings)
          const databaseBalance = accountBalances[symbol] || 0;
          
          // Combine data
          results[symbol] = {
            price: parseFloat(priceData.price),
            history: tradingHistory,
            holdings: parseFloat(databaseBalance).toFixed(8), // Always use database balance which is now synced with Binance, but ensure we have decimal precision
            nextBuyPrice: thresholds.nextBuyPrice,
            nextSellPrice: thresholds.nextSellPrice,
            profitLossPercentage: thresholds.profitLossPercentage
          };
        }
        
        // Add USDT balance to the results
        results.USDT = {
          balance: parseFloat(accountBalances['USDT'] || 0).toFixed(8)
        };
        
        // Send batch results
        socket.emit('batch-data-result', results);
        
      } catch (error) {
        console.error('Error processing batch data request:', error);
        socket.emit('batch-data-result', { error: error.message });
      }
    });
    
    // Client initiates a buy operation
    socket.on('buy-crypto', async (data) => {
      try {
        if (!data || !data.symbol || !data.amount) {
          socket.emit('buy-result', { success: false, error: 'Invalid request' });
          return;
        }
        
        // Execute buy operation
        const result = await binance.buyWithUsdt(data.symbol, data.amount);
        
        // Send result back to client
        socket.emit('buy-result', { success: true, result });
        
        // Explicitly update account balances to make sure database is in sync with Binance
        try {
          await binance.updateAccountBalances();
          console.log(`Account balances explicitly updated after buying ${data.symbol}`);
        } catch (balanceError) {
          console.error(`Error updating balances after purchase: ${balanceError.message}`);
        }
        
        // Send updated data with a delay to ensure all systems are synced
        setTimeout(async () => {
          const updatedData = await getUpdateDataForSymbol(data.symbol);
          socket.emit('crypto-data-update', updatedData);
        }, 2000);  // Small delay to ensure Binance has processed the order
        
      } catch (error) {
        console.error('Error buying cryptocurrency:', error);
        socket.emit('buy-result', { success: false, error: error.message });
      }
    });
    
    // Client initiates a sell operation
    socket.on('sell-crypto', async (data) => {
      try {
        if (!data || !data.symbol) {
          socket.emit('sell-result', { success: false, error: 'Invalid request' });
          return;
        }
        
        // Execute sell operation
        const result = await binance.sellAll(data.symbol);
        
        // Send result back to client
        socket.emit('sell-result', { success: true, result });
        
        // Explicitly update account balances to make sure database is in sync with Binance
        try {
          await binance.updateAccountBalances();
          console.log(`Account balances explicitly updated after selling ${data.symbol}`);
        } catch (balanceError) {
          console.error(`Error updating balances after sale: ${balanceError.message}`);
        }
        
        // Send updated data with a delay to ensure all systems are synced
        setTimeout(async () => {
          const updatedData = await getUpdateDataForSymbol(data.symbol);
          socket.emit('crypto-data-update', updatedData);
        }, 2000);  // Small delay to ensure Binance has processed the order
        
      } catch (error) {
        console.error('Error selling cryptocurrency:', error);
        socket.emit('sell-result', { success: false, error: error.message });
      }
    });
    
    // Client requests to enable/disable auto-trading
    socket.on('set-auto-trading', (data) => {
      if (data && typeof data.enabled === 'boolean') {
        binance.setAutoTrading(data.enabled);
        io.emit('auto-trading-status', { enabled: data.enabled });
      }
    });
    
    // Test Binance stream connection
    socket.on('test-binance-stream', async () => {
      try {
        // Get current prices for supported symbols
        const supportedSymbols = binance.getSupportedSymbols();
        const prices = {};
        
        for (const symbol of supportedSymbols) {
          const price = binance.getCurrentPrice(symbol);
          prices[symbol] = price;
        }
        
        socket.emit('binance-stream-test', { 
          success: true,
          connected: binance.isConnected(),
          prices
        });
      } catch (error) {
        socket.emit('binance-stream-test', { 
          success: false, 
          error: error.message 
        });
      }
    });
    
    // Handle client disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      appState.clients.delete(socket.id);
    });
  });
}

/**
 * Get updated data for a specific cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @returns {Promise<Object>} The updated data
 */
async function getUpdateDataForSymbol(symbol) {
  try {
    // Verify WebSocket connection first
    if (!binance.isConnected()) {
      throw new Error('WebSocket connection is down. Trading is halted until reconnection.');
    }
    
    // Force an update of account balances from Binance to ensure fresh data
    await binance.updateAccountBalances();
    
    // Get current price from WebSocket (not API)
    const priceData = await binance.getSymbolPrice(`${symbol}USDT`);
    
    // Get trading history
    const tradingHistory = await db.getTradingHistory(symbol);
    
    // Get account balances from database (now guaranteed to be fresh from Binance)
    const accountBalances = await db.getAccountBalances();
    
    // Calculate thresholds
    const thresholds = await db.calculateTradingThresholds(
      symbol, 
      parseFloat(priceData.price)
    );
    
    // Get the balance from the database (will be the same as Binance's balance)
    const databaseBalance = (accountBalances && accountBalances[symbol]) || 0;
    
    // Combine data
    return {
      symbol,
      price: parseFloat(priceData.price),
      history: tradingHistory,
      holdings: parseFloat(databaseBalance).toFixed(8), // Always use the database balance which is now synced with Binance, with proper decimal precision
      nextBuyPrice: thresholds.nextBuyPrice,
      nextSellPrice: thresholds.nextSellPrice,
      profitLossPercentage: thresholds.profitLossPercentage
    };
  } catch (error) {
    console.error(`Error getting updated data for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Send system status to a client
 * @param {Object} socket - The socket.io client
 */
function sendSystemStatus(socket) {
  const statusData = {
    serverTime: new Date().toISOString(),
    uptime: Math.floor((new Date() - appState.serverStartTime) / 1000),
    dbConnected: appState.isDbConnected,
    binanceConnected: appState.isBinanceConnected,
    activeClients: appState.clients.size,
    autoTradingEnabled: false // This should be updated based on actual state
  };
  
  socket.emit('system-status', statusData);
}

/**
 * Set up HTTP API routes
 */
function setupApiRoutes() {
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      serverTime: new Date().toISOString(),
      dbConnected: appState.isDbConnected,
      binanceConnected: appState.isBinanceConnected
    });
  });
  
  // API routes for trading operations
  app.get('/api/symbols', (req, res) => {
    const symbols = binance.getSupportedSymbols();
    res.json({ symbols });
  });
}

/**
 * Graceful shutdown handler
 */
function shutdown() {
  console.log('Server shutting down...');
  
  // Close Socket.IO connections
  io.close();
  
  // Close Binance connections
  binance.close();
  
  // Close database connections
  db.close();
  
  // Stop Telegram bot
  telegram.stop();
  
  // Send shutdown notification
  telegram.sendMessage('Server shutting down').finally(() => {
    console.log('Shutdown complete');
    process.exit(0);
  });
}

// Handle process signals for graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the server
startServer().catch(err => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});