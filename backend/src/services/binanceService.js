const Binance = require('binance-api-node').default;
const logger = require('../utils/logger');

// Create Binance client instance
const binanceClient = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  getTime: () => Date.now()
});

/**
 * Setup Binance websocket connections for all supported trading pairs
 */
function setupWebsocket() {
  try {
    const supportedPairs = require('../config/binance').supportedPairs;
    logger.info(`Setting up Binance websocket connections for ${supportedPairs.length} pairs`);
    
    // Create a connection for each supported pair
    const connections = supportedPairs.map(symbol => {
      return startPriceStream(symbol, (priceData) => {
        // Emit the price update to any connected websocket clients
        const io = require('../app').get('io');
        if (io) {
          io.emit('priceUpdate', {
            symbol: priceData.symbol,
            price: priceData.price,
            timestamp: priceData.timestamp
          });
        }
      });
    });
    
    logger.info(`Established ${connections.length} Binance websocket connections`);
    return connections;
  } catch (error) {
    logger.error('Error setting up Binance websocket connections:', error);
    throw error;
  }
}

/**
 * Test connection to Binance API
 */
async function testConnection() {
  try {
    const ping = await binanceClient.ping();
    logger.info('Binance API connection successful');
    return { success: true, ping };
  } catch (error) {
    logger.error('Binance API connection error:', error);
    throw error;
  }
}

/**
 * Get account information
 */
async function getAccountInfo() {
  try {
    const info = await binanceClient.accountInfo();
    logger.debug('Account info retrieved successfully');
    return info;
  } catch (error) {
    logger.error('Error retrieving account info:', error);
    throw error;
  }
}

/**
 * Get current price for a symbol
 * @param {string} symbol - Trading pair symbol
 */
async function getCurrentPrice(symbol) {
  try {
    const ticker = await binanceClient.prices({ symbol });
    return parseFloat(ticker[symbol]);
  } catch (error) {
    logger.error(`Error getting current price for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Start a WebSocket connection for price updates
 * @param {string} symbol - Trading pair symbol
 * @param {Function} callback - Callback function for price updates
 */
async function startPriceStream(symbol, callback) {
  try {
    // Convert symbol to lowercase for WebSocket
    const lowerSymbol = symbol.toLowerCase();
    
    // Start WebSocket for trade updates
    const stream = binanceClient.ws.trades(symbol, trade => {
      callback({
        symbol,
        price: parseFloat(trade.price),
        quantity: parseFloat(trade.quantity),
        timestamp: trade.eventTime
      });
    });
    
    logger.info(`Price stream started for ${symbol}`);
    return stream;
  } catch (error) {
    logger.error(`Error starting price stream for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Close a WebSocket stream
 * @param {Object} stream - WebSocket stream to close
 */
async function closeStream(stream) {
  try {
    if (stream && typeof stream.close === 'function') {
      stream.close();
      logger.info('WebSocket stream closed');
    }
    return true;
  } catch (error) {
    logger.error('Error closing WebSocket stream:', error);
    return false;
  }
}

/**
 * Execute a buy order
 * @param {string} symbol - Trading pair symbol
 * @param {number} quantity - Quantity to buy
 */
async function executeBuy(symbol, quantity) {
  try {
    // Round quantity to appropriate precision
    const symbolInfo = await getSymbolInfo(symbol);
    const roundedQuantity = roundStepSize(quantity, symbolInfo.stepSize);
    
    // Execute market buy
    const order = await binanceClient.order({
      symbol: symbol,
      side: 'BUY',
      type: 'MARKET',
      quantity: roundedQuantity.toString()
    });
    
    logger.info(`Buy order executed for ${symbol}: ${roundedQuantity}`);
    return order;
  } catch (error) {
    logger.error(`Error executing buy order for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Execute a sell order
 * @param {string} symbol - Trading pair symbol
 * @param {number} quantity - Quantity to sell
 */
async function executeSell(symbol, quantity) {
  try {
    // Round quantity to appropriate precision
    const symbolInfo = await getSymbolInfo(symbol);
    const roundedQuantity = roundStepSize(quantity, symbolInfo.stepSize);
    
    // Execute market sell
    const order = await binanceClient.order({
      symbol: symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: roundedQuantity.toString()
    });
    
    logger.info(`Sell order executed for ${symbol}: ${roundedQuantity}`);
    return order;
  } catch (error) {
    logger.error(`Error executing sell order for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Get detailed information about a trading symbol
 * @param {string} symbol - Trading pair symbol
 */
async function getSymbolInfo(symbol) {
  try {
    const exchangeInfo = await binanceClient.exchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
    
    if (!symbolInfo) {
      throw new Error(`Symbol ${symbol} not found in exchange info`);
    }
    
    // Extract lot size filter for step size
    const lotSizeFilter = symbolInfo.filters.find(filter => filter.filterType === 'LOT_SIZE');
    const stepSize = lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : 0.00000100;
    
    return {
      baseAsset: symbolInfo.baseAsset,
      quoteAsset: symbolInfo.quoteAsset,
      stepSize: stepSize,
      minQty: parseFloat(lotSizeFilter.minQty),
      maxQty: parseFloat(lotSizeFilter.maxQty)
    };
  } catch (error) {
    logger.error(`Error getting symbol info for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Round quantity to step size precision
 * @param {number} quantity - Quantity to round
 * @param {number} stepSize - Step size from symbol info
 */
function roundStepSize(quantity, stepSize) {
  if (!stepSize) {
    return quantity;
  }
  
  // Calculate precision based on step size
  const precision = stepSize.toString().split('.')[1]?.length || 0;
  
  // Round down to step size
  return Math.floor(quantity / stepSize) * stepSize;
}

/**
 * Get USDT balance
 */
async function getUSDTBalance() {
  try {
    const account = await binanceClient.accountInfo();
    const usdtBalance = account.balances.find(b => b.asset === 'USDT');
    return {
      free: parseFloat(usdtBalance.free),
      locked: parseFloat(usdtBalance.locked)
    };
  } catch (error) {
    logger.error('Error getting USDT balance:', error);
    throw error;
  }
}

/**
 * Get balance for specific crypto
 * @param {string} asset - Asset symbol (e.g., "BTC")
 */
async function getAssetBalance(asset) {
  try {
    const account = await binanceClient.accountInfo();
    const assetBalance = account.balances.find(b => b.asset === asset);
    
    if (!assetBalance) {
      return { free: 0, locked: 0 };
    }
    
    return {
      free: parseFloat(assetBalance.free),
      locked: parseFloat(assetBalance.locked)
    };
  } catch (error) {
    logger.error(`Error getting ${asset} balance:`, error);
    throw error;
  }
}

module.exports = {
  testConnection,
  getAccountInfo,
  getCurrentPrice,
  startPriceStream,
  closeStream,
  executeBuy,
  executeSell,
  getSymbolInfo,
  getUSDTBalance,
  getAssetBalance,
  setupWebsocket
};