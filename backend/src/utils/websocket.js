const WebSocket = require('ws');
const config = require('../config');

// Store active WebSocket connections
const activeConnections = new Map();

// Store the latest prices for each symbol
const latestPrices = new Map();

// Initialize WebSocket connection for a trading pair
const initializeWebSocket = (symbol) => {
  if (activeConnections.has(symbol)) {
    console.log(`WebSocket connection for ${symbol} already exists`);
    return;
  }
  
  const url = `${config.binance.websocketUrl}/ws/${symbol.toLowerCase()}@aggTrade`;
  const ws = new WebSocket(url);
  
  ws.on('open', () => {
    console.log(`WebSocket connection opened for ${symbol}`);
    activeConnections.set(symbol, ws);
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.p) {
        // Update latest price
        const price = parseFloat(message.p);
        latestPrices.set(symbol, price);
        
        // You can add additional logic here to check for trading conditions
        // This would be implemented in Phase 2
      }
    } catch (error) {
      console.error(`Error processing WebSocket message for ${symbol}:`, error);
    }
  });
  
  ws.on('error', (error) => {
    console.error(`WebSocket error for ${symbol}:`, error);
    closeWebSocket(symbol);
    
    // Try to reconnect after a delay
    setTimeout(() => {
      initializeWebSocket(symbol);
    }, 5000);
  });
  
  ws.on('close', () => {
    console.log(`WebSocket connection closed for ${symbol}`);
    activeConnections.delete(symbol);
    
    // Try to reconnect after a delay
    setTimeout(() => {
      initializeWebSocket(symbol);
    }, 5000);
  });
  
  // Set a ping interval to keep the connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);
};

// Close WebSocket connection for a trading pair
const closeWebSocket = (symbol) => {
  const ws = activeConnections.get(symbol);
  if (ws) {
    ws.terminate();
    activeConnections.delete(symbol);
    console.log(`WebSocket connection terminated for ${symbol}`);
  }
};

// Get the latest price for a symbol
const getLatestPrice = (symbol) => {
  return latestPrices.get(symbol);
};

// Initialize WebSocket connections for all supported trading pairs
const initializeAllWebSockets = async (tradingPairs) => {
  for (const pair of tradingPairs) {
    initializeWebSocket(pair.symbol);
  }
};

module.exports = {
  initializeWebSocket,
  closeWebSocket,
  getLatestPrice,
  initializeAllWebSockets
};