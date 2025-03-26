// Import required modules
const http = require('http');
const app = require('./src/app');
const logger = require('./src/utils/logger');
const db = require('./src/config/database');
const dotenv = require('dotenv');

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

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  // Send initial data to client
  const sendInitialData = async () => {
    try {
      // In Phase 1, we'll send mock data
      // In later phases, this will be actual trading state from the database
      const mockData = {
        tradingPairs: [
          { id: 1, symbol: 'BTCUSDT', displayName: 'BTC/USDT', isActive: true },
          { id: 2, symbol: 'SOLUSDT', displayName: 'SOL/USDT', isActive: true },
          { id: 3, symbol: 'XRPUSDT', displayName: 'XRP/USDT', isActive: true },
          { id: 4, symbol: 'PENDLEUSDT', displayName: 'PENDLE/USDT', isActive: true },
          { id: 5, symbol: 'DOGEUSDT', displayName: 'DOGE/USDT', isActive: true },
          { id: 6, symbol: 'NEARUSDT', displayName: 'NEAR/USDT', isActive: true }
        ],
        settings: {
          profitThreshold: 5,
          lossThreshold: 5,
          additionalPurchaseAmount: 50,
          maxInvestmentPerSymbol: 200
        }
      };
      socket.emit('initialData', mockData);
    } catch (err) {
      logger.error('Error fetching initial data:', err);
    }
  };
  
  sendInitialData();
  
  // Handle disconnection
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
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
    
    // Start the server
    server.listen(port, () => {
      logger.info(`Server running on port ${port}`);
      
      // Check environment variables
      checkRequiredEnvVars();
      
      // Initialize services
      try {
        setupWebSocketFeeds();
        logger.info('WebSocket feeds established');
      } catch (error) {
        logger.error('Failed to setup WebSocket feeds:', error);
      }
      
      // Initialize trading bot simulation (Phase 1)
      try {
        setupSimulation(io);
        logger.info('Trading simulation initialized successfully');
      } catch (error) {
        logger.error('Failed to initialize trading simulation:', error);
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
    const [tables] = await conn.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = ? 
      AND table_name IN ('trading_pairs', 'trading_configurations', 'transactions', 'holdings', 'price_history')
    `, [process.env.DB_NAME || 'crypto_trading_bot']);
    
    const tableNames = tables.map(row => row.table_name);
    
    // If all tables exist, we can skip initialization
    const allTablesExist = ['trading_pairs', 'trading_configurations', 'transactions', 'holdings', 'price_history']
      .every(table => tableNames.includes(table));
    
    if (allTablesExist) {
      logger.info('All required database tables already exist');
      conn.release();
      return;
    }
    
    // Wait for database initialization to complete if it's in progress
    logger.info('Some tables are missing. Waiting for database initialization...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check again after waiting
    const [tablesAfterWait] = await conn.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = ? 
      AND table_name IN ('trading_pairs', 'trading_configurations', 'transactions', 'holdings', 'price_history')
    `, [process.env.DB_NAME || 'crypto_trading_bot']);
    
    const tableNamesAfterWait = tablesAfterWait.map(row => row.table_name);
    
    const allTablesExistAfterWait = ['trading_pairs', 'trading_configurations', 'transactions', 'holdings', 'price_history']
      .every(table => tableNamesAfterWait.includes(table));
    
    if (allTablesExistAfterWait) {
      logger.info('Database tables were created by init scripts');
      conn.release();
      return;
    }
    
    // If tables still don't exist, create them (simplified schema)
    logger.info('Creating missing database tables...');
    
    // Create trading_pairs table if it doesn't exist
    if (!tableNamesAfterWait.includes('trading_pairs')) {
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
    if (!tableNamesAfterWait.includes('trading_configurations')) {
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
    if (!tableNamesAfterWait.includes('transactions')) {
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
    if (!tableNamesAfterWait.includes('holdings')) {
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
    if (!tableNamesAfterWait.includes('price_history')) {
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
    const [pairsCount] = await conn.query('SELECT COUNT(*) as count FROM trading_pairs');
    if (pairsCount[0].count === 0) {
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
      
      // Initialize holdings for each trading pair
      const [pairs] = await conn.query('SELECT id FROM trading_pairs');
      for (const pair of pairs) {
        await conn.query(`
          INSERT INTO holdings (trading_pair_id, quantity) VALUES (?, 0)
        `, [pair.id]);
      }
      
      logger.info('Seeded trading pairs and initialized holdings');
    }
    
    conn.release();
    logger.info('Database initialization completed successfully');
  } catch (error) {
    logger.error('Error initializing database tables:', error);
    throw error;
  }
}

// Setup WebSocket feeds for price data
function setupWebSocketFeeds() {
  // In Phase 1, this is a placeholder
  // In later phases, this will connect to Binance WebSocket API
  logger.info('WebSocket feeds setup in simulation mode for Phase 1');
}

// Setup trading simulation for Phase 1
function setupSimulation(io) {
  // Simulate price changes every 10 seconds
  setInterval(() => {
    // Generate random price changes
    const updates = [
      { symbol: 'BTCUSDT', price: 66000 + (Math.random() - 0.5) * 2000 },
      { symbol: 'SOLUSDT', price: 145 + (Math.random() - 0.5) * 10 },
      { symbol: 'XRPUSDT', price: 0.55 + (Math.random() - 0.5) * 0.05 },
      { symbol: 'PENDLEUSDT', price: 2.35 + (Math.random() - 0.5) * 0.2 },
      { symbol: 'DOGEUSDT', price: 0.12 + (Math.random() - 0.5) * 0.02 },
      { symbol: 'NEARUSDT', price: 4.85 + (Math.random() - 0.5) * 0.4 }
    ];
    
    // Emit price updates to connected clients
    io.emit('priceUpdates', updates);
  }, 10000);
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
  await db.end();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await db.end();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});