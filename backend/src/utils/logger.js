// Simple logger utility

// Determine log level from environment
const LOG_LEVEL = process.env.LOG_LEVEL;

// Format a log message
function formatMessage(level, message, data) {
  const timestamp = new Date().toISOString();
  const levelUpper = level.toUpperCase();
  
  let logMessage = `${timestamp} [${levelUpper}] ${message}`;
  
  if (data) {
    if (data instanceof Error) {
      logMessage += `\n${data.stack || data.message || data}`;
    } else if (typeof data === 'object') {
      try {
        logMessage += `\n${JSON.stringify(data, null, 2)}`;
      } catch (e) {
        logMessage += `\n[Object cannot be stringified]`;
      }
    } else {
      logMessage += `\n${data}`;
    }
  }
  
  return logMessage;
}

// Logger implementation
const logger = {
  error(message, data) {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, data));
    }
  },
  
  warn(message, data) {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, data));
    }
  },
  
  info(message, data) {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, data));
    }
  },
  
  debug(message, data) {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, data));
    }
  },
  
  // Log using the provided level
  log(level, message, data) {
    switch (level.toLowerCase()) {
      case 'error':
        this.error(message, data);
        break;
      case 'warn':
        this.warn(message, data);
        break;
      case 'info':
        this.info(message, data);
        break;
      case 'debug':
        this.debug(message, data);
        break;
      default:
        this.info(message, data);
    }
  }
};

module.exports = logger;