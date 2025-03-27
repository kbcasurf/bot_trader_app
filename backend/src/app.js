// Import required modules
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./utils/errorHandler');
const logger = require('./utils/logger');

// Import routes
const tradingRoutes = require('./routes/tradingRoutes');
const userRoutes = require('./routes/userRoutes');
const statusRoutes = require('./routes/statusRoutes');

// Create Express app
const app = express();

// Apply global middleware
app.use(helmet()); // Security headers

app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Request logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use('/api/', apiLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/trading', tradingRoutes);
app.use('/api/user', userRoutes);
app.use('/api/status', statusRoutes);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not Found' });
});

// Global error handler
app.use(errorHandler);

// Export the app for use in server.js
module.exports = app;