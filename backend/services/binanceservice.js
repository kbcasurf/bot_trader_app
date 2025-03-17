const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');
const path = require('path');
const db = require('../db/connection');
const telegramService = require('./telegramservice.js');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Binance API configuration
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const BINANCE_API_URL = process.env.BINANCE_API_SERVER; // Testnet URL
// Add this near the top of your file with other constants
const BINANCE_WS_URL = process.env.BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws';

// Then in your setupBinanceWebsocket function
function setupBinanceWebsocket(broadcastCallback) {
  // Symbols to monitor
  const symbols = ['BTCUSDT', 'SOLUSDT', 'XRPUSDT', 'PENDLEUSDT', 'DOGEUSDT', 'NEARUSDT'];
  
  // Create a WebSocket connection for each symbol
  symbols.forEach(symbol => {
    try {
      console.log(`Connecting to Binance WebSocket for ${symbol}: ${BINANCE_WS_URL}/${symbol.toLowerCase()}@ticker`);
      const ws = new WebSocket(`${BINANCE_WS_URL}/${symbol.toLowerCase()}@ticker`);
      
      ws.on('open', () => {
        console.log(`WebSocket connection established for ${symbol}`);
      });
      
      // In your WebSocket message handler:
      ws.on('message', (data) => {
        try {
          const tickerData = JSON.parse(data);
          const price = parseFloat(tickerData.c); // Current price
          
          // Store current price
          currentPrices[symbol] = price;
          
          // Broadcast price update to clients
          if (global.broadcastPriceUpdate) {
            global.broadcastPriceUpdate(symbol, price);
          }
          
          // Check if we should buy or sell based on price changes
          checkTradingConditions(symbol, price);
        } catch (error) {
          console.error(`Error processing WebSocket data for ${symbol}:`, error);
        }
      });
      
      ws.on('error', (error) => {
        console.error(`WebSocket error for ${symbol}:`, error);
      });
      
      ws.on('close', () => {
        console.log(`WebSocket connection closed for ${symbol}`);
        
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          setupBinanceWebsocket();
        }, 5000);
      });
      
      websockets[symbol] = ws;
    } catch (error) {
      console.error(`Error setting up WebSocket for ${symbol}:`, error);
    }
  });
}

// Profit/Loss thresholds
const PROFIT_THRESHOLD = parseFloat(process.env.VITE_PROFIT_THRESHOLD) || 5; // 5%
const LOSS_THRESHOLD = parseFloat(process.env.VITE_LOSS_THRESHOLD) || 5; // 5%
const ADDITIONAL_PURCHASE_AMOUNT = 50; // $50 USD

// Store current prices
const currentPrices = {};
// Store active trading sessions
const activeSessions = {};
// Store WebSocket connections
const websockets = {};

// Generate signature for Binance API
function generateSignature(queryString) {
  return crypto
    .createHmac('sha256', BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');
}

// Make a request to Binance API
async function makeRequest(endpoint, method = 'GET', params = {}) {
  try {
    const timestamp = Date.now();
    const queryParams = new URLSearchParams({
      ...params,
      timestamp,
    }).toString();

    const signature = generateSignature(queryParams);
    const url = `${BINANCE_API_URL}${endpoint}?${queryParams}&signature=${signature}`;

    const response = await axios({
      method,
      url,
      headers: {
        'X-MBX-APIKEY': BINANCE_API_KEY,
      },
    });

    return response.data;
  } catch (error) {
    console.error('Binance API error:', error.response?.data || error.message);
    throw error;
  }
}

// Get account information
async function getAccountInfo() {
  return makeRequest('/v3/account');
}

// Get current price for a symbol
async function getCurrentPrice(symbol) {
  try {
    const response = await axios.get(`${BINANCE_API_URL}/v3/ticker/price`, {
      params: { symbol },
    });
    return parseFloat(response.data.price);
  } catch (error) {
    console.error(`Error getting price for ${symbol}:`, error.message);
    throw error;
  }
}

// Update the placeMarketOrder function to ensure it's properly implemented

// Place a market order
async function placeMarketOrder(symbol, side, quantity) {
  try {
    // Check if API credentials are set
    if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
      console.log('Using mock order since API credentials are not set');
      // Return a mock order response for testing
      return {
        symbol: symbol,
        orderId: Math.floor(Math.random() * 1000000),
        clientOrderId: `mock_${Date.now()}`,
        transactTime: Date.now(),
        price: '0.00000000',
        origQty: quantity.toString(),
        executedQty: quantity.toString(),
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        side: side.toUpperCase(),
        fills: [
          {
            price: currentPrices[symbol] ? currentPrices[symbol].toString() : '0',
            qty: quantity.toString(),
            commission: '0',
            commissionAsset: 'BNB'
          }
        ]
      };
    }

    // Format quantity to appropriate precision
    const formattedQuantity = parseFloat(quantity).toFixed(8);
    
    const params = {
      symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity: formattedQuantity,
    };

    return makeRequest('/v3/order', 'POST', params);
  } catch (error) {
    console.error(`Error placing ${side} order for ${symbol}:`, error);
    throw error;
  }
}

// Start a new trading session
async function startSession(symbol, amount) {
  try {
    // Remove the slash from the symbol
    const formattedSymbol = symbol.replace('/', '');
    
    // Get current price
    const price = await getCurrentPrice(formattedSymbol);
    
    // Calculate quantity based on investment amount
    const quantity = (amount / price).toFixed(8);
    
    // Place buy order
    const order = await placeMarketOrder(formattedSymbol, 'buy', quantity);
    
    // Save session to database
    const result = await db.query(
      'INSERT INTO sessions (symbol, initial_investment, total_invested, total_quantity) VALUES (?, ?, ?, ?)',
      [formattedSymbol, amount, amount, quantity]
    );
    
    const sessionId = result.insertId;
    
    // Save order to database
    await db.query(
      'INSERT INTO orders (session_id, symbol, side, price, quantity, total) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, formattedSymbol, 'buy', price, quantity, amount]
    );
    
    // Send notification
    await telegramService.sendMessage(
      `🚀 Started trading session for ${symbol}\n` +
      `💰 Initial investment: $${amount}\n` +
      `🔢 Quantity: ${quantity}\n` +
      `💵 Price: $${price}`
    );
    
    // Add to active sessions
    activeSessions[formattedSymbol] = {
      id: sessionId,
      initialPrice: price,
      lastBuyPrice: price,
      totalInvested: amount,
      totalQuantity: parseFloat(quantity),
    };
    
    return {
      success: true,
      session: {
        id: sessionId,
        symbol: formattedSymbol,
        initialInvestment: amount,
        totalInvested: amount,
        totalQuantity: quantity,
        price,
      },
    };
  } catch (error) {
    console.error('Error starting session:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Get session data
// Add a utility function for formatting symbols consistently
function formatSymbol(symbol) {
// Remove any slashes if present
return symbol.replace('/', '');
}

// Add a utility function for formatting display values
function formatDisplayValue(value, decimals = 3) {
return parseFloat(value).toFixed(decimals);
}

// Update the getSession function to include formatted display values
async function getSession(symbol) {
try {
const formattedSymbol = formatSymbol(symbol);

const sessions = await db.query(
'SELECT * FROM sessions WHERE symbol = ? AND active = TRUE',
[formattedSymbol]
);

if (sessions.length === 0) {
return {
active: false,
};
}

const session = sessions[0];
const currentPrice = currentPrices[formattedSymbol] || await getCurrentPrice(formattedSymbol);
const currentValue = session.total_quantity * currentPrice;
const profitLoss = currentValue - session.total_invested;

return {
active: true,
id: session.id,
symbol: formattedSymbol,
initial_investment: session.initial_investment,
total_invested: session.total_invested,
total_quantity: session.total_quantity,
// Add formatted display values
display_quantity: formatDisplayValue(session.total_quantity),
current_price: currentPrice,
display_price: formatDisplayValue(currentPrice),
current_value: currentValue,
display_value: formatDisplayValue(currentValue),
profit_loss: profitLoss,
display_profit_loss: formatDisplayValue(profitLoss),
profit_loss_percentage: (profitLoss / session.total_invested) * 100,
display_percentage: formatDisplayValue((profitLoss / session.total_invested) * 100),
created_at: session.created_at,
updated_at: session.updated_at,
};
} catch (error) {
console.error('Error getting session:', error);
throw error;
}
}

// Get orders for a session
async function getOrders(symbol) {
  try {
    const formattedSymbol = symbol.replace('/', '');
    
    const sessions = await db.query(
      'SELECT * FROM sessions WHERE symbol = ? AND active = TRUE',
      [formattedSymbol]
    );
    
    if (sessions.length === 0) {
      return [];
    }
    
    const session = sessions[0];
    
    const orders = await db.query(
      'SELECT * FROM orders WHERE session_id = ? ORDER BY timestamp DESC',
      [session.id]
    );
    
    return orders;
  } catch (error) {
    console.error('Error getting orders:', error);
    throw error;
  }
}

// Buy more of a cryptocurrency when price drops
async function buyMore(symbol, price) {
  try {
    const session = activeSessions[symbol];
    
    if (!session) return;
    
    // Calculate quantity based on additional purchase amount
    const quantity = (ADDITIONAL_PURCHASE_AMOUNT / price).toFixed(8);
    
    // Place buy order
    const order = await placeMarketOrder(symbol, 'buy', quantity);
    
    // Update session in memory
    session.totalInvested += ADDITIONAL_PURCHASE_AMOUNT;
    session.totalQuantity += parseFloat(quantity);
    session.lastBuyPrice = price;
    
    // Update session in database
    await db.query(
      'UPDATE sessions SET total_invested = ?, total_quantity = ?, updated_at = NOW() WHERE id = ?',
      [session.totalInvested, session.totalQuantity, session.id]
    );
    
    // Save order to database
    await db.query(
      'INSERT INTO orders (session_id, symbol, side, price, quantity, total) VALUES (?, ?, ?, ?, ?, ?)',
      [session.id, symbol, 'buy', price, quantity, ADDITIONAL_PURCHASE_AMOUNT]
    );
    
    // Send notification
    await telegramService.sendMessage(
      `🔄 BOUGHT MORE ${symbol}\n` +
      `🔢 Quantity: ${quantity}\n` +
      `💵 Price: $${price}\n` +
      `💸 Total: $${ADDITIONAL_PURCHASE_AMOUNT}`
    );
    
    console.log(`Bought more ${symbol} at $${price}: ${quantity} units for $${ADDITIONAL_PURCHASE_AMOUNT}`);
  } catch (error) {
    console.error(`Error buying more ${symbol}:`, error);
    await telegramService.sendMessage(`❌ Error buying more ${symbol}: ${error.message}`);
  }
}

// Sell all crypto for a symbol
async function sellAllCrypto(symbol) {
  try {
    // Format the symbol properly
    const formattedSymbol = symbol.replace('/', '');
    
    // Get current session
    const session = await getSession(formattedSymbol);
    
    if (!session || !session.active) {
      throw new Error(`No active session found for ${formattedSymbol}`);
    }
    
    // Get current price
    const currentPrice = await getCurrentPrice(formattedSymbol);
    
    // Calculate quantity to sell (all available)
    const quantity = session.total_quantity || 0;
    
    if (quantity <= 0) {
      return { message: 'No crypto to sell', symbol: formattedSymbol, quantity };
    }
    
    // Place sell order - using the correct function and parameters
    const order = await placeMarketOrder(formattedSymbol, 'sell', quantity);
    
    // Calculate total
    const total = quantity * currentPrice;
    
    // Save order to database
    await db.query(
      'INSERT INTO orders (session_id, symbol, side, price, quantity, total) VALUES (?, ?, ?, ?, ?, ?)',
      [session.id, formattedSymbol, 'sell', currentPrice, quantity, total]
    );
    
    // Update session
    await db.query(
      'UPDATE sessions SET active = FALSE, updated_at = NOW() WHERE id = ?',
      [session.id]
    );
    
    // Calculate profit/loss
    const profitLoss = total - session.total_invested;
    const profitLossPercentage = (profitLoss / session.total_invested) * 100;
    
    // Send notification
    if (telegramService && telegramService.sendMessage) {
      await telegramService.sendMessage(
        `🔴 SOLD ALL ${formattedSymbol}\n` +
        `🔢 Quantity: ${quantity}\n` +
        `💵 Price: $${currentPrice}\n` +
        `💸 Total: $${total.toFixed(2)}\n` +
        `${profitLoss >= 0 ? '✅ Profit' : '❌ Loss'}: $${profitLoss.toFixed(2)} (${profitLossPercentage.toFixed(2)}%)`
      );
    }
    
    // Remove from active sessions if it exists there
    if (activeSessions[formattedSymbol]) {
      delete activeSessions[formattedSymbol];
    }
    
    return {
      message: 'Successfully sold all crypto',
      symbol: formattedSymbol,
      price: currentPrice,
      quantity,
      total,
      profit_loss: profitLoss,
      profit_loss_percentage: profitLossPercentage
    };
  } catch (error) {
    console.error(`Error selling all ${symbol}:`, error);
    throw error;
  }
}

// Check if we should buy or sell based on price changes
async function checkTradingConditions(symbol, price) {
  try {
    const session = activeSessions[symbol];
    
    if (!session) return;
    
    // Calculate price change percentage from initial price
    const priceChangeFromInitial = ((price - session.initialPrice) / session.initialPrice) * 100;
    
    // Calculate price change percentage from last buy price
    const priceChangeFromLastBuy = ((price - session.lastBuyPrice) / session.lastBuyPrice) * 100;
    
    // If price increased by PROFIT_THRESHOLD% from initial price, sell everything
    if (priceChangeFromInitial >= PROFIT_THRESHOLD) {
      await sellAll(symbol, price);
      return;
    }
    
    // If price decreased by LOSS_THRESHOLD% from last buy, buy more
    if (priceChangeFromLastBuy <= -LOSS_THRESHOLD) {
      await buyMore(symbol, price);
    }
  } catch (error) {
    console.error(`Error checking trading conditions for ${symbol}:`, error);
  }
}

// Setup WebSocket connections for real-time price updates
function setupBinanceWebsocket(broadcastCallback) {
  // Symbols to monitor
  const symbols = ['BTCUSDT', 'SOLUSDT', 'XRPUSDT', 'PENDLEUSDT', 'DOGEUSDT', 'NEARUSDT'];
  
  // Create a WebSocket connection for each symbol
  symbols.forEach(symbol => {
    try {
      const ws = new WebSocket(`${BINANCE_WS_URL}/${symbol.toLowerCase()}@ticker`);
      
      ws.on('open', () => {
        console.log(`WebSocket connection established for ${symbol}`);
      });
      
      // In your WebSocket message handler:
      ws.on('message', (data) => {
        try {
          const tickerData = JSON.parse(data);
          const price = parseFloat(tickerData.c); // Current price
          
          // Store current price
          currentPrices[symbol] = price;
          
          // Broadcast price update to clients
          if (global.broadcastPriceUpdate) {
            global.broadcastPriceUpdate(symbol, price);
          }
          
          // Check if we should buy or sell based on price changes
          checkTradingConditions(symbol, price);
        } catch (error) {
          console.error(`Error processing WebSocket data for ${symbol}:`, error);
        }
      });
      
      ws.on('error', (error) => {
        console.error(`WebSocket error for ${symbol}:`, error);
      });
      
      ws.on('close', () => {
        console.log(`WebSocket connection closed for ${symbol}`);
        
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          setupBinanceWebsocket();
        }, 5000);
      });
      
      websockets[symbol] = ws;
    } catch (error) {
      console.error(`Error setting up WebSocket for ${symbol}:`, error);
    }
  });
}

// Load active sessions from database
async function loadActiveSessions() {
  try {
    const sessions = await db.query('SELECT * FROM sessions WHERE active = TRUE');
    
    for (const session of sessions) {
      const orders = await db.query(
        'SELECT * FROM orders WHERE session_id = ? ORDER BY timestamp ASC',
        [session.id]
      );
      
      if (orders.length > 0) {
        const lastBuyOrder = orders.filter(order => order.side === 'buy').pop();
        
        activeSessions[session.symbol] = {
          id: session.id,
          initialPrice: orders[0].price,
          lastBuyPrice: lastBuyOrder ? lastBuyOrder.price : orders[0].price,
          totalInvested: session.total_invested,
          totalQuantity: session.total_quantity,
        };
      }
    }
    
    console.log(`Loaded ${Object.keys(activeSessions).length} active sessions`);
  } catch (error) {
    console.error('Error loading active sessions:', error);
  }
}

module.exports = {
  getAccountInfo,
  getCurrentPrice,
  startSession,
  getSession,
  getOrders,
  setupBinanceWebsocket,
  loadActiveSessions,
  sellAllCrypto, // Make sure this is exported
};

// Remove this duplicate export if it exists
// exports.sellAllCrypto = async (symbol) => {
// ... };