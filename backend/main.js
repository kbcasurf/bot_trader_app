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

// Get the binance event emitter
const binanceEvents = binance.events;

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Log environment information - only for debugging
console.log('====== ENVIRONMENT DEBUG INFO ======');
console.log(`API URL: ${process.env.BINANCE_API_URL}`);
console.log(`WebSocket URL: ${process.env.BINANCE_WEBSOCKET_URL}`);
console.log(`External Host: ${process.env.EXTERNAL_HOST || 'Not set'}`);
console.log(`Backend URL: ${process.env.VITE_BACKEND_URL || 'Not set'}`);
console.log(`Using testnet environment: ${process.env.BINANCE_API_URL?.includes('testnet') ? 'YES' : 'NO'}`);
console.log('===================================');

// Create Express app
const app = express();
const server = http.createServer(app);

// Middleware - disable CORS restrictions completely
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: '*',
  credentials: true
}));
app.use(express.json());

// Additional headers to ensure CORS is disabled
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// Determine the allowed origins for Socket.IO
let corsOrigin = "*";
if (process.env.EXTERNAL_HOST) {
  corsOrigin = [
    `http://${process.env.EXTERNAL_HOST}`,
    `http://${process.env.EXTERNAL_HOST}:80`,
    "http://localhost",
    "http://localhost:80",
    "http://localhost:3000"
  ];
}

// Get transports from environment or use defaults
const transports = (process.env.SOCKET_TRANSPORTS || 'websocket,polling').split(',');
console.log(`Socket.IO using transports: ${transports.join(', ')}`);

// Create Socket.IO server with fully permissive CORS
const io = socketIo(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true
  },
  path: '/socket.io',
  transports: transports,
  allowEIO3: true, // For compatibility with older clients
  pingTimeout: 60000, // Increase ping timeout for better connection stability
  pingInterval: 25000, // More frequent pings to detect disconnections faster
  connectTimeout: 30000 // Allow more time for initial connection
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
        
        // Import historical trades if needed
        try {
          console.log('Checking and importing historical trades...');
          const importStats = await binance.importHistoricalTrades();
          if (importStats.totalImported > 0) {
            console.log(`Successfully imported ${importStats.totalImported} historical trades for ${importStats.symbolsProcessed} symbols`);
            telegram.sendMessage(`Imported ${importStats.totalImported} historical trades for ${importStats.symbolsProcessed} symbols`);
          } else {
            console.log('No new historical trades to import');
          }
        } catch (importError) {
          console.error('Error importing historical trades:', importError);
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
  
  // Handle auto-trading status changes
  binance.onAutoTradingStatusChange((statusData) => {
    // Broadcast auto-trading status to all connected clients
    io.emit('auto-trading-status', statusData);
  });
  
  // Handle auto-trading execution events
  binanceEvents.on('auto_trading_executed', (tradeData) => {
    console.log('Auto-trading executed:', tradeData);
    // Broadcast auto-trading execution to all connected clients
    io.emit('auto-trading-executed', tradeData);
    
    // CRITICAL: Force immediate update for the traded symbol's threshold data
    try {
      const tradedSymbol = tradeData.symbol;
      // Immediately send fresh threshold data to all clients
      if (tradeData.newThresholds) {
        console.log(`[FAST UPDATE] Broadcasting new thresholds for ${tradedSymbol} to all clients:`, tradeData.newThresholds);
        // Send a direct threshold update to all clients
        io.emit('threshold-update', {
          symbol: tradedSymbol,
          nextBuyPrice: tradeData.newThresholds.nextBuyPrice,
          nextSellPrice: tradeData.newThresholds.nextSellPrice
        });
      }
    } catch (fastUpdateError) {
      console.error('Error during fast threshold update:', fastUpdateError);
    }
    
    // Force update account balances and send complete fresh data after auto-trade
    setTimeout(async () => {
      try {
        // Update account balances
        await binance.updateAccountBalances();
        console.log('Account balances updated after auto-trading execution');
        
        // HIGH PRIORITY: Update data for the traded symbol first with highest urgency
        const tradedSymbol = tradeData.symbol;
        try {
          console.log(`[PRIORITY UPDATE] Getting fresh data for ${tradedSymbol} after trade`);
          const tradedSymbolData = await getUpdateDataForSymbol(tradedSymbol);
          io.emit('crypto-data-update', tradedSymbolData);
          
          // Log what was sent to the frontend
          console.log(`Sent updated thresholds to frontend for ${tradedSymbol}: Buy=${tradedSymbolData.nextBuyPrice}, Sell=${tradedSymbolData.nextSellPrice}`);
        } catch (error) {
          console.error(`Error getting priority update for ${tradedSymbol}:`, error);
        }
        
        // Then update the rest of the symbols
        const symbols = binance.getSupportedSymbols()
          .filter(s => s !== tradedSymbol) // Skip the symbol we just updated
          .map(symbol => `${symbol}USDT`);
        
        for (const fullSymbol of symbols) {
          const symbol = fullSymbol.replace('USDT', '');
          
          try {
            // Get updated data specifically for this symbol
            const updatedData = await getUpdateDataForSymbol(symbol);
            
            // Broadcast the fresh data to all clients
            io.emit('crypto-data-update', updatedData);
          } catch (symbolError) {
            console.error(`Error getting updated data for ${symbol}:`, symbolError);
          }
        }
      } catch (error) {
        console.error('Error updating account balances after auto-trade:', error);
      }
    }, 1000); // Reduced delay to ensure faster updates
  });
  
  // Handle auto-trading check events
  binanceEvents.on('auto_trading_check', (checkData) => {
    // Forward the auto-trading check event to the frontend
    io.emit('auto-trading-check', checkData);
  });
}

/**
 * Perform an immediate check of auto-trading conditions for all supported symbols
 * This is called when auto-trading is enabled to immediately check for trading opportunities
 * Uses a rate-limited approach to avoid multiple checks at the same time
 */
async function performImmediateAutoTradingCheck() {
  try {
    console.log('Performing immediate auto-trading check for all supported symbols...');
    
    // Get all supported symbols
    const supportedSymbols = binance.getSupportedSymbols();
    
    // Process symbols with a delay between each to prevent overwhelming the system
    for (const symbol of supportedSymbols) {
      try {
        // Get current price from binance
        const currentPrice = binance.getCurrentPrice(symbol);
        if (!currentPrice) {
          console.log(`No price data available for ${symbol}, skipping auto-trading check`);
          continue;
        }
        
        console.log(`Checking auto-trading conditions for ${symbol} at current price $${currentPrice.toFixed(4)}`);
        
        // Emit event to inform frontend that auto-trading check is happening
        io.emit('auto-trading-check', { symbol, price: currentPrice });
        
        // Call checkAutoTrading directly to check if we should execute a trade
        await binance.checkAutoTrading(symbol, currentPrice);
        
        // Add a LONGER delay between each symbol's check to prevent API rate limits and simultaneous operations
        // Increased from 3 seconds to 10 seconds to ensure each operation completes fully
        await new Promise(resolve => setTimeout(resolve, 10000));
        
      } catch (symbolError) {
        console.error(`Error checking auto-trading for ${symbol}:`, symbolError);
        // Continue with next symbol
      }
    }
    
    console.log('Immediate auto-trading check completed');
  } catch (error) {
    console.error('Error performing immediate auto-trading check:', error);
  }
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
    socket.on('set-auto-trading', async (data) => {
      if (data && typeof data.enabled === 'boolean') {
        try {
          // Attempt to set auto-trading state
          await binance.setAutoTrading(data.enabled);
          
          // If we get here, it was successful
          console.log(`Auto-trading ${data.enabled ? 'enabled' : 'disabled'} successfully via socket request`);
          
          // If enabling auto-trading, immediately check all supported symbols to see if any trades should be executed
          if (data.enabled) {
            performImmediateAutoTradingCheck();
          }
          
          // Send detailed status response
          const healthStatus = binance.getHealthStatus(); 
          io.emit('auto-trading-status', { 
            enabled: data.enabled,
            success: true,
            wsConnected: healthStatus.wsStatus,
            apiConnected: healthStatus.apiStatus,
            tradingEnabled: healthStatus.tradingEnabled
          });
        } catch (error) {
          // If there was an error, notify with details
          console.error(`Failed to ${data.enabled ? 'enable' : 'disable'} auto-trading:`, error.message);
          socket.emit('auto-trading-status', { 
            enabled: binance.getHealthStatus().autoTradingEnabled, // Current state
            success: false,
            error: error.message
          });
        }
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
  // Get actual auto-trading status from binance module
  const healthStatus = binance.getHealthStatus();

  const statusData = {
    serverTime: new Date().toISOString(),
    uptime: Math.floor((new Date() - appState.serverStartTime) / 1000),
    dbConnected: appState.isDbConnected,
    binanceConnected: appState.isBinanceConnected,
    activeClients: appState.clients.size,
    autoTradingEnabled: healthStatus.autoTradingEnabled // Use actual auto-trading state
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
async function shutdown() {
  console.log('Server shutting down...');
  
  // Save state before shutdown
  try {
    // Persist auto-trading state before disabling
    const autoTradingWasEnabled = binance.getHealthStatus().autoTradingEnabled;
    
    if (autoTradingWasEnabled) {
      console.log('Auto-trading was enabled, persisting state before shutdown');
      await db.saveAppSettings({
        'autoTradingEnabled': autoTradingWasEnabled,
        'shutdownTime': new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error saving app state during shutdown:', error);
  }
  
  // Close Socket.IO connections
  io.close();
  
  // Close Binance connections
  binance.close();
  
  // Close database connections
  db.close();
  
  // Stop Telegram bot
  telegram.stop();
  
  // Send shutdown notification
  telegram.sendMessage('Server shutting down cleanly. Auto-trading state has been persisted and will be restored on next startup.').finally(() => {
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