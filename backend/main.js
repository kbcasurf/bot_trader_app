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
const EventEmitter = require('events');

// Get the binance event emitter
const binanceEvents = binance.events;

// Create global event emitter for app-wide events
global.events = new EventEmitter();

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, './.env') });

// Log environment information - only for debugging
console.log('====== ENVIRONMENT DEBUG INFO ======');
console.log(`API URL: ${process.env.BINANCE_API_URL}`);
console.log(`WebSocket URL: ${process.env.BINANCE_WEBSOCKET_URL}`);
console.log(`External Host: ${process.env.EXTERNAL_HOST}`);
console.log(`Backend URL: ${process.env.VITE_BACKEND_URL}`);
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
        
        // Critical functionality: Perform initial account balance update and reference price setup
        try {
          console.log('Performing initial account balance update and reference price initialization...');
          console.log('NOTE: On first app run, all reference_prices values will be set to 0 for all symbols per requirement 1.2');
          // Call updateAccountBalances with isFirstRun=true flag to trigger reference price setup
          // This implements requirements 1.1 and 1.2 - read balances from Binance and initialize reference_prices to 0
          await binance.updateAccountBalances(true);
          console.log('Initial account balance update and reference price initialization completed successfully');
          
          // Verify the reference prices were set correctly for all symbols
          console.log('Verifying reference prices are correctly set for all symbols...');
          const accountBalances = await db.getAccountBalances();
          const supportedSymbols = binance.getSupportedSymbols();
          
          for (const symbol of supportedSymbols) {
            try {
              const refPrices = await db.getReferencePrice(symbol);
              const balance = accountBalances[symbol] || 0;
              
              console.log(`Verification for ${symbol}: 
                Balance = ${balance.toFixed(8)}
                First Transaction Price = ${refPrices.firstTransactionPrice}
                Last Transaction Price = ${refPrices.lastTransactionPrice}
                Next Buy Price = ${refPrices.nextBuyPrice}
                Next Sell Price = ${refPrices.nextSellPrice}`);
                
              // Per requirement 1.2: System must set all columns on reference_prices table to 0
              // until the user decides to click "Buy 'symbol'" button
              // This applies to ALL symbols whether they have holdings or not
              
              // For all symbols, verify all prices are set to 0 at first run
              if (refPrices.firstTransactionPrice !== 0 || 
                  refPrices.lastTransactionPrice !== 0 || 
                  refPrices.nextBuyPrice !== 0 || 
                  refPrices.nextSellPrice !== 0) {
                console.error(`ERROR: Symbol ${symbol} has reference prices not set to 0 at first run!`);
                
                // Force reset to zero on verification failure to ensure compliance with requirements
                try {
                  await db.updateReferencePrice(symbol, {
                    firstTransactionPrice: 0,
                    lastTransactionPrice: 0,
                    nextBuyPrice: 0,
                    nextSellPrice: 0
                  });
                  console.log(`Reset all reference prices to 0 for ${symbol} as required by 1.2`);
                } catch (resetError) {
                  console.error(`Failed to reset reference prices for ${symbol}:`, resetError);
                }
              }
            } catch (verifyError) {
              console.error(`Error verifying reference prices for ${symbol}:`, verifyError);
            }
          }
        } catch (balanceError) {
          console.error('CRITICAL ERROR during initial account balance update and reference price setup:', balanceError);
          // This is critical functionality - notify the error loudly
          telegram.sendErrorNotification('CRITICAL ERROR initializing reference prices: ' + balanceError.message);
        }
        
        // Restore auto-trading interval if auto-trading was enabled
        try {
          const savedSettings = await db.getAppSettings('autoTradingEnabled');
          if (savedSettings === true) {
            console.log('Restoring auto-trading interval from previous state');
            // Set up interval for requirement 3.1 - check every minute
            if (!global.autoTradingInterval) {
              global.autoTradingInterval = setInterval(() => {
                if (binance.getHealthStatus().autoTradingEnabled) {
                  console.log('Running scheduled auto-trading check (every minute)');
                  performImmediateAutoTradingCheck();
                } else {
                  // If auto-trading was disabled, clear the interval
                  if (global.autoTradingInterval) {
                    clearInterval(global.autoTradingInterval);
                    global.autoTradingInterval = null;
                    console.log('Auto-trading interval cleared');
                  }
                }
              }, 60000); // Check every minute per requirement 3.1
              console.log('Auto-trading interval started - checking every minute');
            }
          }
        } catch (settingsError) {
          console.error('Error restoring auto-trading settings:', settingsError);
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
  // Listen for reference price updates and broadcast to clients
  global.events.on('reference_price_updated', (data) => {
    console.log(`[EVENT] Reference price updated for ${data.symbol}:`, data);
    // Send immediate update to all clients about the threshold change
    io.emit('threshold-update', {
      symbol: data.symbol,
      nextBuyPrice: data.nextBuyPrice,
      nextSellPrice: data.nextSellPrice,
      lastTransactionPrice: data.lastTransactionPrice
    });
  });

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
        
        // Convert any BigInt values to numbers
        const safeAccountInfo = db.convertBigIntToNumber(combinedAccountInfo);
        
        socket.emit('account-info', safeAccountInfo);
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
          
          // First, get the exact reference prices straight from the database
          // This is critical to ensure we're using the actual stored values, not recalculated ones
          const refPrices = await db.getReferencePrice(symbol);
          console.log(`[BATCH DATA] Direct DB reference prices for ${symbol}: Buy=${refPrices.nextBuyPrice}, Sell=${refPrices.nextSellPrice}, Holdings=${holdings.quantity}, LastTxPrice=${refPrices.lastTransactionPrice}`);
          
          // Calculate profit/loss percentage
          const currentPrice = parseFloat(priceData.price);
          const profitLossPercentage = holdings.averageBuyPrice > 0 
            ? ((currentPrice - holdings.averageBuyPrice) / holdings.averageBuyPrice) * 100
            : 0;
          
          // Get the balance from the database (prefer this over calculated holdings)
          const databaseBalance = accountBalances[symbol] || 0;
          
          // Use the nextSellPrice value exactly as it is in the database
          // We don't want to "fix" a zero value, as it's an intentional state after "sell all" operations
          const nextSellPrice = refPrices.nextSellPrice;
          
          // Just log zero sell prices for debugging
          if (refPrices.nextSellPrice === 0) {
            console.log(`[INFO] Symbol ${symbol} has nextSellPrice=0, keeping as-is per requirements`);
          }
          
          // Combine data - using the DIRECT reference prices from the database
          // Convert any potential BigInt values to regular Numbers
          results[symbol] = {
            price: parseFloat(priceData.price),
            history: tradingHistory.map(item => ({
              ...item,
              binance_trade_id: item.binance_trade_id ? Number(item.binance_trade_id) : null
            })),
            holdings: parseFloat(databaseBalance).toFixed(8), // Always use database balance which is now synced with Binance, but ensure we have decimal precision
            nextBuyPrice: parseFloat(refPrices.nextBuyPrice), // Ensure it's a regular number
            nextSellPrice: parseFloat(nextSellPrice), // Ensure it's a regular number
            profitLossPercentage: parseFloat(profitLossPercentage),
            lastTransactionPrice: parseFloat(refPrices.lastTransactionPrice) // Ensure it's a regular number
          };
        }
        
        // Add USDT balance to the results
        results.USDT = {
          balance: parseFloat(accountBalances['USDT'] || 0).toFixed(8)
        };
        
        // Convert any BigInt values before sending
        const safeResults = db.convertBigIntToNumber(results);
        
        // Send batch results
        socket.emit('batch-data-result', safeResults);
        
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
        
        // Convert any BigInt values in result to regular numbers before sending to client
        const safeResult = db.convertBigIntToNumber(result);
        
        // Send result back to client
        socket.emit('buy-result', { success: true, result: safeResult });
        
        // Explicitly update account balances to make sure database is in sync with Binance
        try {
          await binance.updateAccountBalances();
          console.log(`Account balances explicitly updated after buying ${data.symbol}`);
        } catch (balanceError) {
          console.error(`Error updating balances after purchase: ${balanceError.message}`);
        }
        
        // Send updated data with a longer delay to ensure all systems are properly synced
        // and any transaction-based recalculations have completed
        setTimeout(async () => {
          try {
            // Ensure we have the most up-to-date reference prices by explicitly checking them
            const refPrices = await db.getReferencePrice(data.symbol);
            console.log(`[DATA REFRESH] For ${data.symbol}: Getting final data with latest thresholds - Buy=${refPrices.nextBuyPrice}, Sell=${refPrices.nextSellPrice}`);
            
            // Get updated data with our consistent thresholds
            const updatedData = await getUpdateDataForSymbol(data.symbol);
            
            // Double-check the data before sending to client
            if (updatedData.nextBuyPrice !== refPrices.nextBuyPrice || 
                updatedData.nextSellPrice !== refPrices.nextSellPrice) {
              console.warn(`[MISMATCH] Price inconsistency detected for ${data.symbol}: DB has Buy=${refPrices.nextBuyPrice}, Sell=${refPrices.nextSellPrice} but calculated values are Buy=${updatedData.nextBuyPrice}, Sell=${updatedData.nextSellPrice}. Using DB values.`);
              
              // Override with the actual DB values to ensure consistency
              updatedData.nextBuyPrice = refPrices.nextBuyPrice;
              updatedData.nextSellPrice = refPrices.nextSellPrice;
            }
            
            // Send verified data to client
            socket.emit('crypto-data-update', updatedData);
            console.log(`[SENT] Final verified data for ${data.symbol} with thresholds: Buy=${updatedData.nextBuyPrice}, Sell=${updatedData.nextSellPrice}`);
          } catch (err) {
            console.error(`[ERROR] Failed to send final crypto update for ${data.symbol}:`, err);
          }
        }, 3000);  // Longer delay to ensure all DB updates are complete
        
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
        
        // Convert any BigInt values in result to regular numbers before sending to client
        const safeResult = db.convertBigIntToNumber(result);
        
        // Send result back to client
        socket.emit('sell-result', { success: true, result: safeResult });
        
        // Explicitly update account balances to make sure database is in sync with Binance
        try {
          await binance.updateAccountBalances();
          console.log(`Account balances explicitly updated after selling ${data.symbol}`);
        } catch (balanceError) {
          console.error(`Error updating balances after sale: ${balanceError.message}`);
        }
        
        // Send updated data with a longer delay to ensure all systems are properly synced
        // and any transaction-based recalculations have completed
        setTimeout(async () => {
          try {
            // Ensure we have the most up-to-date reference prices by explicitly checking them
            const refPrices = await db.getReferencePrice(data.symbol);
            console.log(`[DATA REFRESH] For ${data.symbol}: Getting final data with latest thresholds - Buy=${refPrices.nextBuyPrice}, Sell=${refPrices.nextSellPrice}`);
            
            // Get updated data with our consistent thresholds
            const updatedData = await getUpdateDataForSymbol(data.symbol);
            
            // Double-check the data before sending to client
            if (updatedData.nextBuyPrice !== refPrices.nextBuyPrice || 
                updatedData.nextSellPrice !== refPrices.nextSellPrice) {
              console.warn(`[MISMATCH] Price inconsistency detected for ${data.symbol}: DB has Buy=${refPrices.nextBuyPrice}, Sell=${refPrices.nextSellPrice} but calculated values are Buy=${updatedData.nextBuyPrice}, Sell=${updatedData.nextSellPrice}. Using DB values.`);
              
              // Override with the actual DB values to ensure consistency
              updatedData.nextBuyPrice = refPrices.nextBuyPrice;
              updatedData.nextSellPrice = refPrices.nextSellPrice;
            }
            
            // Send verified data to client
            socket.emit('crypto-data-update', updatedData);
            console.log(`[SENT] Final verified data for ${data.symbol} with thresholds: Buy=${updatedData.nextBuyPrice}, Sell=${updatedData.nextSellPrice}`);
          } catch (err) {
            console.error(`[ERROR] Failed to send final crypto update for ${data.symbol}:`, err);
          }
        }, 3000);  // Longer delay to ensure all DB updates are complete
        
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
          
          // If enabling auto-trading, implement requirement 3.1 - check permanently with interval of 1 minute
          if (data.enabled) {
            // Perform immediate check first
            performImmediateAutoTradingCheck();
            
            // Set up interval to check every minute (requirement 3.1)
            if (!global.autoTradingInterval) {
              global.autoTradingInterval = setInterval(() => {
                if (binance.getHealthStatus().autoTradingEnabled) {
                  console.log('Running scheduled auto-trading check (every minute)');
                  performImmediateAutoTradingCheck();
                } else {
                  // If auto-trading is disabled, clear the interval
                  if (global.autoTradingInterval) {
                    clearInterval(global.autoTradingInterval);
                    global.autoTradingInterval = null;
                    console.log('Auto-trading interval cleared');
                  }
                }
              }, 60000); // Check every minute per requirement 3.1
              console.log('Auto-trading interval started - checking every minute');
            }
          } else {
            // If disabling auto-trading, clear the interval
            if (global.autoTradingInterval) {
              clearInterval(global.autoTradingInterval);
              global.autoTradingInterval = null;
              console.log('Auto-trading interval cleared');
            }
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
    
    // First, get the exact reference prices straight from the database
    // This is critical to ensure we're using the actual stored values, not recalculated ones
    const refPrices = await db.getReferencePrice(symbol);
    
    // For profit/loss calculation, get holdings and other data
    const holdings = await db.getCurrentHoldings(symbol);
    
    // Log with holdings information
    console.log(`[GET_UPDATE_DATA] Direct DB reference prices for ${symbol}: Buy=${refPrices.nextBuyPrice}, Sell=${refPrices.nextSellPrice}, Holdings=${holdings.quantity}, LastTxPrice=${refPrices.lastTransactionPrice}`);
    
    // Calculate profit/loss percentage
    const currentPrice = parseFloat(priceData.price);
    const profitLossPercentage = holdings.averageBuyPrice > 0 
      ? ((currentPrice - holdings.averageBuyPrice) / holdings.averageBuyPrice) * 100
      : 0;
    
    // Use the nextSellPrice value exactly as it is in the database
    // We don't want to "fix" a zero value, as it's an intentional state after "sell all" operations
    const nextSellPrice = refPrices.nextSellPrice;
    
    // Just log zero sell prices for debugging
    if (refPrices.nextSellPrice === 0) {
      console.log(`[INFO] Symbol ${symbol} has nextSellPrice=0, keeping as-is per requirements`);
    }
    
    // Get the balance from the database (will be the same as Binance's balance)
    const databaseBalance = (accountBalances && accountBalances[symbol]) || 0;
    
    // Combine data - using the DIRECT reference prices from the database instead of recalculated ones
    // Convert any potential BigInt values to regular Numbers
    return {
      symbol,
      price: parseFloat(priceData.price),
      history: tradingHistory.map(item => ({
        ...item,
        binance_trade_id: item.binance_trade_id ? Number(item.binance_trade_id) : null
      })),
      holdings: parseFloat(databaseBalance).toFixed(8), // Always use the database balance which is now synced with Binance, with proper decimal precision
      nextBuyPrice: parseFloat(refPrices.nextBuyPrice), // Ensure it's a regular number
      nextSellPrice: parseFloat(nextSellPrice), // Ensure it's a regular number
      profitLossPercentage: parseFloat(profitLossPercentage),
      lastTransactionPrice: parseFloat(refPrices.lastTransactionPrice) // Ensure it's a regular number
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
  
  // Convert any BigInt values to numbers
  const safeStatusData = db.convertBigIntToNumber(statusData);
  
  socket.emit('system-status', safeStatusData);
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
    
    // Clear auto-trading interval if exists
    if (global.autoTradingInterval) {
      clearInterval(global.autoTradingInterval);
      global.autoTradingInterval = null;
      console.log('Auto-trading interval cleared during shutdown');
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