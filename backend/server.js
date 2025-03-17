const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const binanceRoutes = require('./routes/binance');
const telegramRoutes = require('./routes/telegram');
const db = require('./db/connection');
const { setupBinanceWebsocket, loadActiveSessions } = require('./services/binanceservice.js');
const { setupTradingBot } = require('./services/tradingbotservice.js');
const http = require('http');
const WebSocket = require('ws');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 4000;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server for frontend connections
const wss = new WebSocket.Server({ server, path: '/ws' });

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('Frontend client connected to WebSocket');
  
  ws.on('message', (message) => {
    console.log('Received message from frontend:', message);
  });
  
  ws.on('close', () => {
    console.log('Frontend client disconnected from WebSocket');
  });
});

// Define the broadcast function
global.broadcastPriceUpdate = (symbol, price) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'price', symbol, price }));
    }
  });
};

// Use server.listen instead of app.listen
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Routes
app.use('/api/binance', binanceRoutes);
app.use('/api/telegram', telegramRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
    },
  });
});

// Initialize database tables
async function initializeTables() {
  try {
    console.log('Verifying database tables...');
    
    // Check if tables exist first
    const tablesExist = await checkTablesExist();
    
    if (tablesExist) {
      console.log('All required database tables already exist');
      
      // Only check settings if tables exist
      await ensureDefaultSettings();
      return;
    }
    
    // Wait a bit to allow init.sql to complete if it's running
    console.log('Waiting for database initialization from init.sql...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check again after waiting
    const tablesExistAfterWait = await checkTablesExist();
    
    if (tablesExistAfterWait) {
      console.log('Database tables were created by init.sql');
      
      // Only check settings if tables exist
      await ensureDefaultSettings();
      return;
    }
    
    // If tables still don't exist, create them
    console.log('Creating missing database tables...');
    
    // Create sessions table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        initial_investment DECIMAL(15, 8) NOT NULL,
        total_invested DECIMAL(15, 8) NOT NULL,
        total_quantity DECIMAL(15, 8) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_active_symbol (symbol, active)
      )
    `);
    
    // Create orders table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        symbol VARCHAR(20) NOT NULL,
        side ENUM('buy', 'sell') NOT NULL,
        price DECIMAL(15, 8) NOT NULL,
        quantity DECIMAL(15, 8) NOT NULL,
        total DECIMAL(15, 8) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `);
    
    // Create settings table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(50) NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_key (setting_key)
      )
    `);
    
    await ensureDefaultSettings();
    
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database tables:', error);
    throw error;
  }
}

// Check if required tables exist
async function checkTablesExist() {
  try {
    // Try to query each table to see if they exist
    const [sessionsResult] = await db.query("SHOW TABLES LIKE 'sessions'");
    const [ordersResult] = await db.query("SHOW TABLES LIKE 'orders'");
    const [settingsResult] = await db.query("SHOW TABLES LIKE 'settings'");
    
    return sessionsResult.length > 0 && ordersResult.length > 0 && settingsResult.length > 0;
  } catch (error) {
    console.error('Error checking tables:', error);
    return false;
  }
}

// Ensure default settings exist
async function ensureDefaultSettings() {
  try {
    // Insert default settings with ON DUPLICATE KEY UPDATE
    await db.query(`
        INSERT INTO settings (setting_key, value) VALUES
          ('profit_threshold', '5'),
          ('loss_threshold', '5'),
          ('additional_purchase_amount', '50'),
          ('max_investment_per_symbol', '200')
        ON DUPLICATE KEY UPDATE value = VALUES(value)
      `);
    console.log('Default settings inserted or updated');
  } catch (error) {
    console.error('Error ensuring default settings:', error);
    throw error;
  }
}

// Start server
async function startServer() {
  try {
    // Initialize database connection
    await db.connect();
    console.log('Database connection established');
    
    // Initialize database tables
    await initializeTables();

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Setup Binance websocket connections
    setupBinanceWebsocket();

    // Setup trading bot service
    setupTradingBot();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await db.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await db.disconnect();
  process.exit(0);
});