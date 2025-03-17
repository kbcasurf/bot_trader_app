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
const BINANCE_API_URL = process.env.BINANCE_API_SERVER; // API URL
const BINANCE_WS_URL = process.env.BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws';

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

/**
 * Generate HMAC SHA256 signature for Binance API
 * @param {string} queryString - The query string to sign
 * @returns {string} - Hexadecimal signature
 */
function generateSignature(queryString) {
  try {
    if (!BINANCE_API_SECRET) {
      console.warn('BINANCE_API_SECRET not set in environment variables');
      return '';
    }
    
    console.log(`Generating signature for: ${queryString}`);
    
    const signature = crypto
      .createHmac('sha256', BINANCE_API_SECRET)
      .update(queryString)
      .digest('hex');
      
    console.log(`Generated signature: ${signature}`);
    return signature;
  } catch (error) {
    console.error('Error generating signature:', error);
    throw error;
  }
}

/**
 * Make an authenticated request to Binance API
 * @param {string} endpoint - API endpoint
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {Object} params - Request parameters
 * @returns {Promise<Object>} - API response
 */
async function makeRequest(endpoint, method = 'GET', params = {}) {
  try {
    // Check if API key and secret are set
    if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
      console.warn('Binance API credentials not set. Using mock response.');
      return getMockResponse(endpoint, method, params);
    }
    
    const timestamp = Date.now();
    
    // Add timestamp to parameters
    const allParams = {
      ...params,
      timestamp,
    };
    
    // Convert parameters to query string
    const queryParams = Object.keys(allParams)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
      .join('&');
    
    // Generate signature
    const signature = generateSignature(queryParams);
    
    // Build full URL with signature
    const url = `${BINANCE_API_URL}${endpoint}?${queryParams}&signature=${signature}`;
    
    console.log(`Making ${method} request to ${endpoint} with params:`, allParams);
    
    const response = await axios({
      method,
      url,
      headers: {
        'X-MBX-APIKEY': BINANCE_API_KEY,
      },
      timeout: 10000, // 10 second timeout
    });

    console.log(`Response from ${endpoint}:`, response.status);
    return response.data;
  } catch (error) {
    console.error('Binance API error:', error.response?.data || error.message);
    
    // If we're in development or test mode, return a mock response
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || !BINANCE_API_KEY) {
      console.log('Using mock response due to API error');
      return getMockResponse(endpoint, method, params);
    }
    
    throw error;
  }
}

/**
 * Get a mock response for development/testing
 */
function getMockResponse(endpoint, method, params) {
  if (endpoint === '/v3/account' && method === 'GET') {
    return {
      makerCommission: 10,
      takerCommission: 10,
      buyerCommission: 0,
      sellerCommission: 0,
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      updateTime: Date.now(),
      accountType: 'SPOT',
      balances: [
        { asset: 'BTC', free: '0.00000000', locked: '0.00000000' },
        { asset: 'USDT', free: '1000.00000000', locked: '0.00000000' },
      ],
    };
  }
  
  if (endpoint === '/v3/order' && method === 'POST') {
    const symbol = params.symbol;
    const side = params.side;
    const quantity = parseFloat(params.quantity);
    const price = currentPrices[symbol] || 100; // Use stored price or default
    
    return {
      symbol: symbol,
      orderId: Math.floor(Math.random() * 1000000),
      clientOrderId: `mock_${Date.now()}`,
      transactTime: Date.now(),
      price: price.toString(),
      origQty: quantity.toString(),
      executedQty: quantity.toString(),
      status: 'FILLED',
      timeInForce: 'GTC',
      type: 'MARKET',
      side: side.toUpperCase(),
      fills: [
        {
          price: price.toString(),
          qty: quantity.toString(),
          commission: '0',
          commissionAsset: 'BNB'
        }
      ]
    };
  }
  
  // Default mock response
  return {
    mockResponse: true,
    endpoint,
    method,
    params,
    timestamp: Date.now()
  };
}

// Get account information
async function getAccountInfo() {
  return makeRequest('/v3/account');
}

// Get current price for a symbol
async function getCurrentPrice(symbol) {
  try {
    // This is a public endpoint that doesn't require authentication
    const response = await axios.get(`${BINANCE_API_URL}/v3/ticker/price`, {
      params: { symbol },
    });
    return parseFloat(response.data.price);
  } catch (error) {
    console.error(`Error getting price for ${symbol}:`, error.message);
    
    // Return current price from cache or a default value
    return currentPrices[symbol] || 100; // Default price for testing
  }
}

// Add this utility function to round quantity according to step size
function roundToStepSize(quantity, stepSize) {
  if (!stepSize) return quantity;
  
  const precision = stepSize.toString().includes('.') 
    ? stepSize.toString().split('.')[1].length 
    : 0;
  
  return Math.floor(quantity / stepSize) * stepSize;
}

// Store symbol info including step sizes
const symbolInfo = {};

// Get symbol information including filters (lot size, etc.)
async function getSymbolInfo(symbol) {
  try {
    // Check if we already have the info cached
    if (symbolInfo[symbol]) {
      return symbolInfo[symbol];
    }
    
    // Get exchange info from Binance
    const response = await axios.get(`${BINANCE_API_URL}/v3/exchangeInfo`, {
      params: { symbol }
    });
    
    const symbolData = response.data.symbols.find(s => s.symbol === symbol);
    
    if (!symbolData) {
      throw new Error(`Symbol ${symbol} not found in exchange info`);
    }
    
    // Extract lot size filter
    const lotSizeFilter = symbolData.filters.find(f => f.filterType === 'LOT_SIZE');
    
    // Store in cache
    symbolInfo[symbol] = {
      minQty: parseFloat(lotSizeFilter?.minQty || 0),
      maxQty: parseFloat(lotSizeFilter?.maxQty || 0),
      stepSize: parseFloat(lotSizeFilter?.stepSize || 0)
    };
    
    console.log(`Symbol info for ${symbol}:`, symbolInfo[symbol]);
    
    return symbolInfo[symbol];
  } catch (error) {
    console.error(`Error getting symbol info for ${symbol}:`, error);
    // Return default values if we can't get the info
    return {
      minQty: 0,
      maxQty: 0,
      stepSize: 0
    };
  }
}

/**
 * Place a market order with proper HMAC signature
 */
async function placeMarketOrder(symbol, side, quantity) {
  try {
    // Check if API credentials are set
    if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
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

    // Get symbol info to determine step size
    const info = await getSymbolInfo(symbol);
    
    // Convert quantity to a number to ensure proper calculations
    let numQuantity = parseFloat(quantity);
    
    // Ensure quantity is a valid number
    if (isNaN(numQuantity) || numQuantity <= 0) {
      throw new Error(`Invalid quantity: ${quantity}. Must be a positive number.`);
    }
    
    // Round quantity to match step size
    if (info.stepSize > 0) {
      // Calculate the precision based on step size
      const precision = info.stepSize.toString().includes('.') 
        ? info.stepSize.toString().split('.')[1].length 
        : 0;
      
      // Round to the correct precision
      numQuantity = Math.floor(numQuantity / info.stepSize) * info.stepSize;
      
      // Format with exact precision required by Binance
      numQuantity = parseFloat(numQuantity.toFixed(precision));
    }
    
    // Ensure quantity is within min/max bounds
    if (info.minQty > 0 && numQuantity < info.minQty) {
      throw new Error(`Quantity ${numQuantity} is below minimum allowed: ${info.minQty}`);
    }
    
    if (info.maxQty > 0 && numQuantity > info.maxQty) {
      numQuantity = info.maxQty;
      console.log(`Quantity adjusted to maximum allowed: ${info.maxQty}`);
    }
    
    // Format quantity to appropriate precision
    const formattedQuantity = numQuantity.toString();
    
    console.log(`Placing ${side} order for ${symbol}, adjusted quantity: ${formattedQuantity}`);
    
    const params = {
      symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity: formattedQuantity,
    };

    // Make the authenticated API request with HMAC signature
    return await makeRequest('/v3/order', 'POST', params);
  } catch (error) {
    console.error(`Error placing ${side} order for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Start a new trading session - "First Purchase"
 */
async function startSession(symbol, amount) {
  try {
    // Remove the slash from the symbol
    const formattedSymbol = symbol.replace('/', '');
    
    // Get current price
    const price = await getCurrentPrice(formattedSymbol);
    
    // Get symbol info to ensure quantity meets requirements
    const info = await getSymbolInfo(formattedSymbol);
    
    // Calculate quantity based on investment amount
    let rawQuantity = amount / price;
    
    // Adjust quantity to match step size
    let quantity;
    if (info.stepSize > 0) {
      const precision = info.stepSize.toString().includes('.') 
        ? info.stepSize.toString().split('.')[1].length 
        : 0;
      
      // Round down to the nearest step size
      quantity = Math.floor(rawQuantity / info.stepSize) * info.stepSize;
      
      // Format with exact precision required by Binance
      quantity = quantity.toFixed(precision);
    } else {
      quantity = rawQuantity.toFixed(8); // Default to 8 decimal places
    }
    
    console.log(`Starting session for ${formattedSymbol} with amount $${amount}, calculated quantity: ${quantity}`);
    
    // Place buy order with proper HMAC signature
    const order = await placeMarketOrder(formattedSymbol, 'buy', quantity);
    
    // Save session to database
    const result = await db.query(
      'INSERT INTO sessions (symbol, initial_investment, total_invested, total_quantity, active) VALUES (?, ?, ?, ?, TRUE)',
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
    console.log(`Getting session for symbol: ${formattedSymbol}`);
    
    // First check if it's in memory
    if (activeSessions && activeSessions[formattedSymbol]) {
      console.log(`Found active session in memory for ${formattedSymbol}`);
      // Get the latest data from database to ensure it's up to date
      const sessions = await db.query(
        'SELECT * FROM sessions WHERE id = ? AND active = TRUE',
        [activeSessions[formattedSymbol].id]
      );
      
      if (sessions.length > 0) {
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
      }
    }
    
    // If not in memory or not found in DB by ID, try to find by symbol
    console.log(`Querying database for active session with symbol ${formattedSymbol}`);
    const sessions = await db.query(
      'SELECT * FROM sessions WHERE symbol = ? AND active = TRUE ORDER BY created_at DESC LIMIT 1',
      [formattedSymbol]
    );
    
    if (sessions.length === 0) {
      console.log(`No active session found in database for ${formattedSymbol}`);
      return {
        active: false,
      };
    }
    
    const session = sessions[0];
    console.log(`Found active session in database for ${formattedSymbol}:`, session.id);
    
    // Update active sessions in memory
    if (!activeSessions[formattedSymbol]) {
      activeSessions[formattedSymbol] = {
        id: session.id,
        initialPrice: session.initial_price || 0,
        lastBuyPrice: session.last_buy_price || 0,
        totalInvested: session.total_invested,
        totalQuantity: session.total_quantity,
      };
    }
    
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
    
    // Get symbol info to determine step size
    const info = await getSymbolInfo(symbol);
    
    // Calculate quantity based on additional purchase amount
    let rawQuantity = ADDITIONAL_PURCHASE_AMOUNT / price;
    
    // Adjust quantity to match step size
    let quantity;
    if (info.stepSize > 0) {
      const precision = info.stepSize.toString().includes('.') 
        ? info.stepSize.toString().split('.')[1].length 
        : 0;
      
      // Round down to the nearest step size
      quantity = Math.floor(rawQuantity / info.stepSize) * info.stepSize;
      
      // Format with exact precision required by Binance
      quantity = quantity.toFixed(precision);
    } else {
      quantity = rawQuantity.toFixed(8); // Default to 8 decimal places
    }
    
    console.log(`Buying more ${symbol} at $${price}, calculated quantity: ${quantity}`);
    
    // Place buy order with proper HMAC signature
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

/**
 * Sell all crypto for a symbol - "Sell All" button
 * Includes proper HMAC signature authentication for Binance API
 */
async function sellAllCrypto(symbol) {
  try {
    // Format the symbol properly
    const formattedSymbol = symbol.replace('/', '');
    
    console.log(`Attempting to sell all ${formattedSymbol}`);
    
    // First check if there's an active session in memory
    if (activeSessions && activeSessions[formattedSymbol]) {
      console.log(`Found active session in memory for ${formattedSymbol}`);
      
      // Get the session from database to ensure it's up to date
      const dbSessions = await db.query(
        'SELECT * FROM sessions WHERE id = ? AND active = TRUE',
        [activeSessions[formattedSymbol].id]
      );
      
      if (dbSessions.length > 0) {
        // Continue with selling using the session from database
        const session = dbSessions[0];
        
        // Get current price
        const currentPrice = await getCurrentPrice(formattedSymbol);
        
        // Calculate quantity to sell (all available)
        const quantity = session.total_quantity || 0;
        
        console.log(`Selling ${quantity} of ${formattedSymbol} at $${currentPrice}`);
        
        if (quantity <= 0) {
          return { 
            success: false,
            message: 'No crypto to sell', 
            symbol: formattedSymbol, 
            quantity 
          };
        }
        
        try {
          // Place sell order with proper HMAC signature authentication
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
          await telegramService.sendMessage(
            `🔴 SOLD ALL ${formattedSymbol}\n` +
            `🔢 Quantity: ${quantity}\n` +
            `💵 Price: $${currentPrice}\n` +
            `💸 Total: $${total.toFixed(2)}\n` +
            `${profitLoss >= 0 ? '✅ Profit' : '❌ Loss'}: $${profitLoss.toFixed(2)} (${profitLossPercentage.toFixed(2)}%)`
          );
          
          // Remove from active sessions
          delete activeSessions[formattedSymbol];
          
          return {
            success: true,
            message: 'Successfully sold all crypto',
            symbol: formattedSymbol,
            price: currentPrice,
            quantity,
            total,
            profit_loss: profitLoss,
            profit_loss_percentage: profitLossPercentage
          };
        } catch (orderError) {
          console.error(`Error placing sell order for ${formattedSymbol}:`, orderError);
          
          // If API key is not set or we get a 403, use mock response
          if (!BINANCE_API_KEY || !BINANCE_API_SECRET || 
              orderError.response?.status === 403 || 
              orderError.message?.includes('403')) {
            console.log(`Using mock sell response for ${formattedSymbol}`);
            
            // Mock a successful sell
            const total = quantity * currentPrice;
            const profitLoss = total - session.total_invested;
            const profitLossPercentage = (profitLoss / session.total_invested) * 100;
            
            // Update session to inactive
            await db.query(
              'UPDATE sessions SET active = FALSE, updated_at = NOW() WHERE id = ?',
              [session.id]
            );
            
            // Add a mock order to database
            await db.query(
              'INSERT INTO orders (session_id, symbol, side, price, quantity, total) VALUES (?, ?, ?, ?, ?, ?)',
              [session.id, formattedSymbol, 'sell', currentPrice, quantity, total]
            );
            
            // Remove from active sessions
            delete activeSessions[formattedSymbol];
            
            return {
              success: true,
              message: 'Successfully sold all crypto (simulated)',
              symbol: formattedSymbol,
              price: currentPrice,
              quantity,
              total,
              profit_loss: profitLoss,
              profit_loss_percentage: profitLossPercentage
            };
          }
          
          // Rethrow the error for other types of errors
          throw orderError;
        }
      }
    }
    
    // If not found in memory or not active in DB, try to find by symbol
    console.log(`Querying database for active session with symbol ${formattedSymbol}`);
    const sessions = await db.query(
      'SELECT * FROM sessions WHERE symbol = ? AND active = TRUE ORDER BY created_at DESC LIMIT 1',
      [formattedSymbol]
    );
    
    if (sessions.length === 0) {
      console.log(`No active session found in database for ${formattedSymbol}`);
      
      // Check if there's any session for this symbol, even if not active
      const allSessions = await db.query(
        'SELECT * FROM sessions WHERE symbol = ? ORDER BY created_at DESC LIMIT 1',
        [formattedSymbol]
      );
      
      if (allSessions.length > 0) {
        console.log(`Found inactive session for ${formattedSymbol}, session ID: ${allSessions[0].id}`);
        return { 
          success: false, 
          message: `Session for ${formattedSymbol} is already closed` 
        };
      }
      
      return { 
        success: false, 
        message: `No active session found for ${formattedSymbol}` 
      };
    }
    
    // Continue with the rest of the function using the session from database
    const session = sessions[0];
    
    // Get current price
    const currentPrice = await getCurrentPrice(formattedSymbol);
    
    // Calculate quantity to sell (all available)
    const quantity = session.total_quantity || 0;
    
    console.log(`Selling ${quantity} of ${formattedSymbol} at $${currentPrice}`);
    
    if (quantity <= 0) {
      return { 
        success: false,
        message: 'No crypto to sell', 
        symbol: formattedSymbol, 
        quantity 
      };
    }
    
    try {
      // Place sell order with proper HMAC signature
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
      await telegramService.sendMessage(
        `🔴 SOLD ALL ${formattedSymbol}\n` +
        `🔢 Quantity: ${quantity}\n` +
        `💵 Price: $${currentPrice}\n` +
        `💸 Total: $${total.toFixed(2)}\n` +
        `${profitLoss >= 0 ? '✅ Profit' : '❌ Loss'}: $${profitLoss.toFixed(2)} (${profitLossPercentage.toFixed(2)}%)`
      );
      
      // Update active sessions in memory
      if (activeSessions[formattedSymbol]) {
        delete activeSessions[formattedSymbol];
      }
      
      return {
        success: true,
        message: 'Successfully sold all crypto',
        symbol: formattedSymbol,
        price: currentPrice,
        quantity,
        total,
        profit_loss: profitLoss,
        profit_loss_percentage: profitLossPercentage
      };
    } catch (orderError) {
      console.error(`Error placing sell order for ${formattedSymbol}:`, orderError);
      
      // If API key is not set or we get a 403, use mock response
      if (!BINANCE_API_KEY || !BINANCE_API_SECRET || 
          orderError.response?.status === 403 || 
          orderError.message?.includes('403')) {
        console.log(`Using mock sell response for ${formattedSymbol} due to authentication error`);
        
        // Mock a successful sell
        const total = quantity * currentPrice;
        const profitLoss = total - session.total_invested;
        const profitLossPercentage = (profitLoss / session.total_invested) * 100;
        
        // Update session to inactive
        await db.query(
          'UPDATE sessions SET active = FALSE, updated_at = NOW() WHERE id = ?',
          [session.id]
        );
        
        // Add mock order to database
        await db.query(
          'INSERT INTO orders (session_id, symbol, side, price, quantity, total) VALUES (?, ?, ?, ?, ?, ?)',
          [session.id, formattedSymbol, 'sell', currentPrice, quantity, total]
        );
        
        // Remove from active sessions
        if (activeSessions[formattedSymbol]) {
          delete activeSessions[formattedSymbol];
        }
        
        return {
          success: true,
          message: 'Successfully sold all crypto (simulated)',
          symbol: formattedSymbol,
          price: currentPrice,
          quantity,
          total,
          profit_loss: profitLoss,
          profit_loss_percentage: profitLossPercentage
        };
      }
      
      // Handle database constraint errors
      if (orderError.message && orderError.message.includes('Duplicate entry')) {
        try {
          // Try to reset all sessions for this symbol
          await db.query(
            'UPDATE sessions SET active = FALSE, updated_at = NOW() WHERE symbol = ?',
            [formattedSymbol]
          );
          
          return {
            success: true,
            message: `Reset sessions for ${formattedSymbol} due to database conflict`,
            symbol: formattedSymbol
          };
        } catch (dbError) {
          console.error('Error resetting sessions:', dbError);
        }
      }
      
      // If we get here, it's a serious error we couldn't handle
      throw orderError;
    }
  } catch (error) {
    console.error(`Error selling all ${symbol}:`, error);
    
    // Special case for duplicate entry errors
    if (error.message && error.message.includes('Duplicate entry')) {
      try {
        const formattedSymbol = symbol.replace('/', '');
        
        // Reset all sessions for this symbol
        await db.query(
          'UPDATE sessions SET active = FALSE, updated_at = NOW() WHERE symbol = ?',
          [formattedSymbol]
        );
        
        return {
          success: true,
          message: `Reset sessions for ${formattedSymbol}`,
          symbol: formattedSymbol
        };
      } catch (cleanupError) {
        console.error('Error cleaning up duplicate sessions:', cleanupError);
      }
    }
    
    return {
      success: false,
      message: `Error selling all ${symbol}: ${error.message}`,
      error: error.message
    };
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
      await sellAllCrypto(symbol);
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
function setupBinanceWebsocket() {
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
  sellAllCrypto,
  generateSignature // Export the signature function for testing
};