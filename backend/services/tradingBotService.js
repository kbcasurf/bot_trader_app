const binanceService = require('./binanceservice.js');

// Setup trading bot
async function setupTradingBot() {
  try {
    // Load active sessions from database
    await binanceService.loadActiveSessions();
    
    console.log('Trading bot initialized');
  } catch (error) {
    console.error('Error setting up trading bot:', error);
  }
}

module.exports = {
  setupTradingBot,
};