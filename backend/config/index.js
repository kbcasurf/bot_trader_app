const express = require('express');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const apiRoutes = require('../src/routes/api');
const logger = require('../src/utils/logger');

// Load environment variables
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Create Express app
const app = express();
const PORT = process.env.PORT;

// Middleware
app.use(helmet());
app.use(express.json());

// API routes
app.use('/api', apiRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('Cryptocurrency Trading Bot API is running');
});

// Error handling middleware - production safe version
app.use((err, req, res, next) => {
  // Log the error internally for troubleshooting
  logger.error('Server error:', err);
  
  // Send a generic error response without exposing details
  res.status(500).json({
    error: {
      message: 'Something went wrong on the server'
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
});

module.exports = app;