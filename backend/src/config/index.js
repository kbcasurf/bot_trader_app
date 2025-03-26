const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Load environment variables with defaults
const config = {
    database: {
      host: process.env.DB_HOST || 'database',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'trading_bot_user',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'crypto_trading_bot',
      connectionLimit: 5
    },
    server: {
      port: parseInt(process.env.PORT || '5000', 10),
      env: process.env.NODE_ENV || 'development'
    },
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    },
    binance: {
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
      baseUrl: process.env.BINANCE_API_URL || 'https://testnet.binance.vision/',
      websocketUrl: 'wss://stream.binance.com:9443'
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID
    }
  };

// Import routes
const apiRoutes = require('./src/routes/api');

// Create Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// API routes
app.use('/api', apiRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('Cryptocurrency Trading Bot API is running');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: {
      message: 'Something went wrong on the server',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = config;