// backend/src/utils/errorHandler.js
/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
    // Log the error for server-side debugging
    console.error('Error:', err.message, err.stack);
    
    // Determine status code (default to 500 if not specified)
    const statusCode = err.statusCode || 500;
    
    // Send response to client
    res.status(statusCode).json({
      error: {
        message: err.message || 'Internal Server Error',
        code: err.code || 'INTERNAL_ERROR',
        // Only include stack trace in development environment
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      }
    });
  }
  
  module.exports = errorHandler;