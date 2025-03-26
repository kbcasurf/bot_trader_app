// Import required modules
const http = require('http');
const app = require('./src/app');
const logger = require('./utils/logger');
const db = require('./config/database');
const binanceService = require('./src/services/binanceService');
const tradingService = require('./services/tradingService');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Check for required environment variables
function checkRequiredEnvVars() {
  const requiredVars = [
    'JWT_SECRET',
    'MARIADB_DATABASE',
    'MARIADB_USER',
    'MARIADB_PASSWORD'
  ];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    logger.warn(`Missing required environment variables: ${missing.join(', ')}`);
    logger.info('The application may not function correctly without these variables.');
  }
}

// Get port from environment or default to 3000
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
  tradingService.getAllTradingState()
    .then(data => {
      socket.emit('initialData', data);
    })
    .catch(err => {
      logger.error('Error fetching initial data:', err);
    });
  
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
    const dbInitialized = await db.initialize(10, 3000); // 10 retries, 3 seconds between retries
    
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
      
      // Initialize Binance websocket connections
      try {
        binanceService.setupWebsocket();
        logger.info('Binance websocket connections established');
      } catch (error) {
        logger.error('Failed to setup Binance websocket connections:', error);
      }
      
      // Initialize trading bot service
      try {
        tradingService.setupTradingBot(io);
        logger.info('Trading bot service initialized successfully');
      } catch (error) {
        logger.error('Failed to initialize trading bot service:', error);
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
    const [cryptoConfigExists] = await conn.query(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = ? AND table_name = 'crypto_config'
    `, [process.env.MARIADB_DATABASE || 'crypto_trading_bot']);
    
    const [tradingStateExists] = await conn.query(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = ? AND table_name = 'trading_state'
    `, [process.env.MARIADB_DATABASE || 'crypto_trading_bot']);
    
    const [settingsExists] = await conn.query(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = ? AND table_name = 'settings'
    `, [process.env.MARIADB_DATABASE || 'crypto_trading_bot']);
    
    // If all tables exist, we can skip initialization
    if (cryptoConfigExists.count > 0 && tradingStateExists.count > 0 && settingsExists.count > 0) {
      logger.info('All required database tables already exist');
      await ensureDefaultSettings(conn);
      conn.release();
      return;
    }
    
    // Wait a bit to allow init.sql to complete if it's running
    logger.info('Waiting for database initialization from init.sql...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check again after waiting
    const [tablesExistAfterWait] = await conn.query(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = ? AND table_name IN ('crypto_config', 'trading_state', 'settings')
    `, [process.env.MARIADB_DATABASE || 'crypto_trading_bot']);
    
    if (tablesExistAfterWait.count >= 3) {
      logger.info('Database tables were created by init.sql');
      await ensureDefaultSettings(conn);
      conn.release();
      return;
    }
    
    // If tables still don't exist, create them using the schema in database/init/01-schema.sql
    // This is a simplified version - you may want to read and execute the SQL file directly
    logger.info('Creating missing database tables...');
    
    // Create crypto_config table if it doesn't exist
    if (cryptoConfigExists.count === 0) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS crypto_config (
          id INT AUTO_INCREMENT PRIMARY KEY,
          symbol VARCHAR(20) NOT NULL,
          base_asset VARCHAR(10) NOT NULL,
          quote_asset VARCHAR(10) NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY (symbol)
        )
      `);
    }
    
    // Create trading_state table if it doesn't exist
    if (tradingStateExists.count === 0) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS trading_state (
          id INT AUTO_INCREMENT PRIMARY KEY,
          symbol VARCHAR(20) NOT NULL,
          initial_purchase_price DECIMAL(20, 8) NULL,
          last_purchase_price DECIMAL(20, 8) NULL,
          total_investment DECIMAL(20, 8) DEFAULT 0,
          current_holdings DECIMAL(20, 8) DEFAULT 0,
          is_active BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (symbol) REFERENCES crypto_config(symbol),
          UNIQUE KEY (symbol)
        )
      `);
    }
    
    // Create settings table if it doesn't exist
    if (settingsExists.count === 0) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS settings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          key VARCHAR(50) NOT NULL,
          value TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY (key)
        )
      `);
    }
    
    // Seed initial data if crypto_config is empty
    const [cryptoCount] = await conn.query('SELECT COUNT(*) as count FROM crypto_config');
    if (cryptoCount.count === 0) {
      logger.info('Seeding cryptocurrency pairs...');
      
      await conn.query(`
        INSERT INTO crypto_config (symbol, base_asset, quote_asset) VALUES
        ('BTCUSDT', 'BTC', 'USDT'),
        ('SOLUSDT', 'SOL', 'USDT'),
        ('XRPUSDT', 'XRP', 'USDT'),
        ('PENDLEUSDT', 'PENDLE', 'USDT'),
        ('DOGEUSDT', 'DOGE', 'USDT'),
        ('NEARUSDT', 'NEAR', 'USDT')
      `);
      
      // Initialize trading state for each cryptocurrency
      await conn.query(`
        INSERT INTO trading_state (symbol, is_active)
        SELECT symbol, FALSE FROM crypto_config
      `);
    }
    
    // Ensure default settings
    await ensureDefaultSettings(conn);
    
    conn.release();
    logger.info('Database tables initialized successfully');
  } catch (error) {
    logger.error('Error initializing database tables:', error);
    throw error;
  }
}

// Ensure default settings exist
async function ensureDefaultSettings(conn) {
  try {
    // Check if settings table has default values
    const [settingsCount] = await conn.query('SELECT COUNT(*) as count FROM settings');
    
    // Insert default settings if none exist
    if (settingsCount.count === 0) {
      logger.info('Inserting default settings...');
      
      await conn.query(`
        INSERT INTO settings (key, value) VALUES
          ('profit_threshold', '5'),
          ('loss_threshold', '5'),
          ('additional_purchase_amount', '50'),
          ('max_investment_per_symbol', '200')
      `);
    }
  } catch (error) {
    logger.error('Error ensuring default settings:', error);
    throw error;
  }
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
  await db.closeAll();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await db.closeAll();
  process.exit(0);
});