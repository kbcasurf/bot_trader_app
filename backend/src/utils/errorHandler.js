const logger = require('../../utils/logger');

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error('API Error:', err);
  
  // Default error status and message
  let statusCode = 500;
  let message = 'Internal Server Error';
  let details = undefined;
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Failed';
    details = err.details || err.message;
  } else if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (err.name === 'ForbiddenError') {
    statusCode = 403;
    message = 'Forbidden';
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
    message = 'Not Found';
  } else if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 409;
    message = 'Conflict - Duplicate Entry';
  }
  
  // Handle custom status code if provided
  if (err.statusCode) {
    statusCode = err.statusCode;
  }
  
  // Include error details in development but not in production
  if (process.env.NODE_ENV !== 'production') {
    details = details || err.message || err.toString();
  }
  
  // Send the error response
  res.status(statusCode).json({
    error: {
      status: statusCode,
      message,
      details
    }
  });
};

module.exports = errorHandler;