const binanceService = require('./binanceservice.js');

// Setup trading bot
async function setupTradingBot() {
  try {
    // Load active sessions from database
    await binanceService.loadActiveSessions();
    
    // Setup WebSocket connection to Binance API
    binanceService.setupBinanceWebsocket();
    
    console.log('Trading bot initialized with Binance WebSocket connection');
  } catch (error) {
    console.error('Error setting up trading bot:', error);
  }
}

module.exports = {
  setupTradingBot,
};