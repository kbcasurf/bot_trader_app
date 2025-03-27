// Import required modules
const http = require('http');
const app = require('./src/app');
const logger = require('./src/utils/logger');
const db = require('./config/database');
const dotenv = require('dotenv');
const telegramService = require('./src/services/telegramService');
const websocketController = require('./src/controllers/websocketController');
const tradingService = require('./src/services/tradingService');

// Load environment variables
dotenv.config();

// Check for required environment variables
function checkRequiredEnvVars() {
  const requiredVars = [
    'JWT_SECRET',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD'
  ];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    logger.warn(`Missing required environment variables: ${missing.join(', ')}`);
    logger.info('The application may not function correctly without these variables.');
  }
}

// Get port from environment or default to 5000
const port = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Set up WebSocket server
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
  
io.on('connection', (socket) => {
  // Handle new connection with our WebSocket controller
  websocketController.handleConnection(socket);
  logger.info(`New client connected: ${socket.id}`);
});

// Make io available globally
app.set('io', io);

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database connection with retry logic
    logger.info('Initializing database connection...');
    
    // Try to connect to the database
    let dbInitialized = false;
    let retryCount = 0;
    const maxRetries = 10;
    const retryInterval = 3000; // 3 seconds
    
    while (!dbInitialized && retryCount < maxRetries) {
      try {
        await db.getConnection();
        dbInitialized = true;
        logger.info('Database connection established successfully');
      } catch (error) {
        retryCount++;
        logger.warn(`Failed to connect to database (attempt ${retryCount}/${maxRetries}): ${error.message}`);
        if (retryCount < maxRetries) {
          logger.info(`Retrying in ${retryInterval / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryInterval));
        }
      }
    }
    
    if (!dbInitialized) {
      throw new Error('Failed to initialize database after multiple attempts');
    }
    
    // Check if tables exist and create them if needed
    await initializeDatabase();
    
    // Initialize Telegram bot for notifications
    await initializeTelegramService();
    
    // Initialize WebSockets for price updates
    await websocketController.initializeWebSockets(io);
    
    // Start the server
    server.listen(port, '0.0.0.0', () => {
      logger.info(`Server running on port ${port}`);
      
      // Check environment variables
      checkRequiredEnvVars();
      
      // Set up simulated price feed for Phase 2
      if (process.env.NODE_ENV !== 'production') {
        setupSimulation(io);
        logger.info('Running in simulation mode with generated price data');
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Initialize database tables and default settings
async function initializeDatabase() {
  try {
    logger.info('Verifying database tables...');
    const conn = await db.getConnection();
    
    // Check if required tables exist
    const tablesResult = await conn.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = ? 
      AND table_name IN ('trading_pairs', 'trading_configurations', 'transactions', 'holdings', 'price_history')
    `, [process.env.DB_NAME || 'crypto_trading_bot']);
    
    // Fix for the tables.map issue - ensure we're correctly accessing the result
    const tableNames = Array.isArray(tablesResult) 
      ? tablesResult[0].map(row => row.table_name)
      : tablesResult && typeof tablesResult === 'object' 
        ? Object.values(tablesResult).map(row => row.table_name) 
        : [];
    
    // If all tables exist, we can skip initialization
    const allTablesExist = ['trading_pairs', 'trading_configurations', 'transactions', 'holdings', 'price_history']
      .every(table => tableNames.includes(table));
    
    if (allTablesExist) {
      logger.info('All required database tables already exist');
      conn.release();
      return;
    }
    
    // Wait for database initialization to complete if it's in progress
    logger.info('Some tables are missing. Creating required database tables...');
    
    // Create trading_pairs table if it doesn't exist
    if (!tableNames.includes('trading_pairs')) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS trading_pairs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          symbol VARCHAR(20) NOT NULL UNIQUE,
          display_name VARCHAR(50) NOT NULL,
          logo_url VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      logger.info('Created trading_pairs table');
    }
    
    // Create trading_configurations table if it doesn't exist
    if (!tableNames.includes('trading_configurations')) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS trading_configurations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          trading_pair_id INT NOT NULL,
          initial_investment DECIMAL(10, 2) NOT NULL,
          active BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (trading_pair_id) REFERENCES trading_pairs(id)
        )
      `);
      logger.info('Created trading_configurations table');
    }
    
    // Create transactions table if it doesn't exist
    if (!tableNames.includes('transactions')) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS transactions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          trading_pair_id INT NOT NULL,
          transaction_type ENUM('BUY', 'SELL') NOT NULL,
          quantity DECIMAL(20, 8) NOT NULL,
          price DECIMAL(20, 8) NOT NULL,
          total_amount DECIMAL(20, 8) NOT NULL,
          binance_order_id VARCHAR(255),
          status ENUM('PENDING', 'COMPLETED', 'FAILED') DEFAULT 'PENDING',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (trading_pair_id) REFERENCES trading_pairs(id)
        )
      `);
      logger.info('Created transactions table');
    }
    
    // Create holdings table if it doesn't exist
    if (!tableNames.includes('holdings')) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS holdings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          trading_pair_id INT NOT NULL,
          quantity DECIMAL(20, 8) NOT NULL DEFAULT 0,
          average_buy_price DECIMAL(20, 8),
          last_buy_price DECIMAL(20, 8),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (trading_pair_id) REFERENCES trading_pairs(id),
          UNIQUE KEY unique_trading_pair (trading_pair_id)
        )
      `);
      logger.info('Created holdings table');
    }
    
    // Create price_history table if it doesn't exist
    if (!tableNames.includes('price_history')) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS price_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          trading_pair_id INT NOT NULL,
          price DECIMAL(20, 8) NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (trading_pair_id) REFERENCES trading_pairs(id)
        )
      `);
      logger.info('Created price_history table');
    }
    
    // Seed initial data if trading_pairs is empty
    const pairsCountResult = await conn.query('SELECT COUNT(*) as count FROM trading_pairs');
    const pairsCount = Array.isArray(pairsCountResult) 
      ? pairsCountResult[0][0].count 
      : pairsCountResult && pairsCountResult.count;
    
    if (pairsCount === 0) {
      logger.info('Seeding trading pairs...');
      
      await conn.query(`
        INSERT INTO trading_pairs (symbol, display_name, logo_url) VALUES
        ('BTCUSDT', 'BTC/USDT', '/assets/logos/btc.png'),
        ('SOLUSDT', 'SOL/USDT', '/assets/logos/sol.png'),
        ('XRPUSDT', 'XRP/USDT', '/assets/logos/xrp.png'),
        ('PENDLEUSDT', 'PENDLE/USDT', '/assets/logos/pendle.png'),
        ('DOGEUSDT', 'DOGE/USDT', '/assets/logos/doge.png'),
        ('NEARUSDT', 'NEAR/USDT', '/assets/logos/near.png')
      `);
      
      // Initialize holdings with zero quantity for each trading pair
      const pairsResult = await conn.query('SELECT id FROM trading_pairs');
      const pairs = Array.isArray(pairsResult) 
        ? pairsResult[0] 
        : pairsResult;
      
      if (pairs) {
        const pairsArray = Array.isArray(pairs) ? pairs : Object.values(pairs);
        for (const pair of pairsArray) {
          await conn.query(`
            INSERT INTO holdings (trading_pair_id, quantity) VALUES (?, 0)
          `, [pair.id]);
        }
        
        logger.info('Seeded trading pairs and initialized holdings');
      }
    }
    
    conn.release();
    logger.info('Database initialization completed successfully');
  } catch (error) {
    logger.error('Error initializing database tables:', error);
    throw error;
  }
}

// Initialize Telegram notification service
async function initializeTelegramService() {
  try {
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      logger.info('Initializing Telegram notification service...');
      const success = await telegramService.initializeBot();
      if (success) {
        logger.info('Telegram notification service initialized successfully');
      } else {
        logger.warn('Failed to initialize Telegram notification service');
      }
    } else {
      logger.info('Telegram notification service disabled (missing credentials)');
    }
  } catch (error) {
    logger.error('Error initializing Telegram notification service:', error);
  }
}

// Setup trading simulation for development and testing
function setupSimulation(io) {
  // Base prices for each symbol (these will fluctuate)
  const basePrices = {
    'BTCUSDT': 66000,
    'SOLUSDT': 145, 
    'XRPUSDT': 0.55,
    'PENDLEUSDT': 2.35,
    'DOGEUSDT': 0.12,
    'NEARUSDT': 4.85
  };
  
  // Keep track of current prices
  const currentPrices = { ...basePrices };
  
  // Simulate price changes every 10 seconds
  const simulationInterval = setInterval(() => {
    // Generate price updates with realistic volatility for each symbol
    const updates = Object.keys(basePrices).map(symbol => {
      // Calculate volatility based on the price (higher priced assets have higher absolute changes)
      const volatilityFactor = Math.max(0.005, Math.min(0.02, 0.01 * Math.sqrt(basePrices[symbol] / 10)));
      
      // Random factor between -1 and 1, with slight bias toward price reverting to base
      const randomFactor = (Math.random() * 2 - 1) * 0.7 + 
                          ((basePrices[symbol] - currentPrices[symbol]) / basePrices[symbol]) * 0.3;
      
      // Calculate new price with random change
      const priceChange = currentPrices[symbol] * volatilityFactor * randomFactor;
      const newPrice = Math.max(currentPrices[symbol] + priceChange, basePrices[symbol] * 0.5);
      
      // Update current price
      currentPrices[symbol] = newPrice;
      
      return {
        symbol,
        price: newPrice,
        timestamp: new Date().toISOString()
      };
    });
    
    // Emit price updates to connected clients
    io.emit('priceUpdates', updates);
    
    // Process each price update with the trading algorithm
    updates.forEach(async update => {
      try {
        // Find the trading pair ID for this symbol
        const conn = await db.getConnection();
        const [pairResult] = await conn.query('SELECT id FROM trading_pairs WHERE symbol = ?', [update.symbol]);
        conn.release();
        
        if (pairResult && pairResult.length > 0) {
          const tradingPairId = pairResult[0].id;
          
          // Process the price update with the trading algorithm
          await tradingService.processPriceUpdate(tradingPairId, update.price);
          
          // Also broadcast individual price update for WebSocket subscribers
          websocketController.broadcastPriceUpdate(update.symbol, update.price);
        }
      } catch (error) {
        logger.error(`Error processing simulated price update for ${update.symbol}:`, error);
      }
    });
    
    logger.debug('Simulated price updates sent:', updates.map(u => `${u.symbol}: $${u.price.toFixed(2)}`).join(', '));
  }, 10000); // Every 10 seconds
  
  // Store the interval for cleanup
  global.simulationInterval = simulationInterval;
}

// Start server
startServer();

// Handle graceful shutdown
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Clear simulation interval if it exists
  if (global.simulationInterval) {
    clearInterval(global.simulationInterval);
  }
  
  // Close database connection
  try {
    await db.end();
    logger.info('Database connections closed');
  } catch (error) {
    logger.error('Error closing database connections:', error);
  }
  
  // Stop Telegram bot if running
  const bot = telegramService.getBot();
  if (bot) {
    bot.stop('SIGTERM');
    logger.info('Telegram bot stopped');
  }
  
  // Close server
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force exit after timeout
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  // Clear simulation interval if it exists
  if (global.simulationInterval) {
    clearInterval(global.simulationInterval);
  }
  
  // Close database connection
  try {
    await db.end();
    logger.info('Database connections closed');
  } catch (error) {
    logger.error('Error closing database connections:', error);
  }
  
  // Stop Telegram bot if running
  const bot = telegramService.getBot();
  if (bot) {
    bot.stop('SIGINT');
    logger.info('Telegram bot stopped');
  }
  
  // Close server
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force exit after timeout
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});