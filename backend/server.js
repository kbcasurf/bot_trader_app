require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db/connection');
const binanceRoutes = require('./routes/binance');
const telegramRoutes = require('./routes/telegram');
const tradingBot = require('./services/tradingBot');

const app = express();
const PORT = process.env.PORT || 4000;  // Use PORT from .env

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false  // Disable CSP for development
}));

// Enable CORS for all routes
app.use(cors({
  origin: ['http://localhost', 'http://localhost:80', 'http://frontend', 'http://frontend:80'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Parse JSON request body
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Routes
app.use('/api/binance', binanceRoutes);
app.use('/api/telegram', telegramRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database connection
    await db.init();
    console.log('Database connection established');

    // Start the trading bot service
    tradingBot.initialize();
    
    // Start the server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await db.close();
  process.exit(0);
});