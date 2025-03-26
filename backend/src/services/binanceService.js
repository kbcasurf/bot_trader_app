const Binance = require('node-binance-api');
const mariadb = require('mariadb');
const config = require('../config');

// Create a pool for database connections
const pool = mariadb.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database,
  connectionLimit: 5
});

// Initialize Binance API client
const binance = new Binance().options({
  APIKEY: config.binance.apiKey,
  APISECRET: config.binance.apiSecret,
  urls: {
    base: config.binance.baseUrl
  }
});

// Get all trading pairs from the database
exports.getTradingPairs = async () => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM trading_pairs');
    return rows;
  } catch (error) {
    console.error('Error fetching trading pairs:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

// Get a single trading pair by ID
exports.getTradingPairById = async (tradingPairId) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM trading_pairs WHERE id = ?', [tradingPairId]);
    if (rows.length === 0) {
      throw new Error(`Trading pair with ID ${tradingPairId} not found`);
    }
    return rows[0];
  } catch (error) {
    console.error(`Error fetching trading pair with ID ${tradingPairId}:`, error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

// Get current price for a symbol from Binance
exports.getCurrentPrice = async (symbol) => {
  try {
    // In Phase 1, we'll simulate price data
    // In later phases, this would make a real API call to Binance
    const mockPrices = {
      'BTCUSDT': 67500.25,
      'SOLUSDT': 145.75,
      'XRPUSDT': 0.55,
      'PENDLEUSDT': 2.35,
      'DOGEUSDT': 0.12,
      'NEARUSDT': 4.85
    };
    
    // Add some random fluctuation for simulation
    const basePrice = mockPrices[symbol] || 100;
    const fluctuation = (Math.random() - 0.5) * 0.02; // +/- 1% change
    const price = basePrice * (1 + fluctuation);
    
    return parseFloat(price.toFixed(getPrecision(basePrice)));
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    throw error;
  }
};

// Helper function for price precision
function getPrecision(price) {
  if (price < 0.1) return 6;
  if (price < 1) return 5;
  if (price < 10) return 4;
  if (price < 1000) return 2;
  return 2;
}

// Get holdings for a trading pair
exports.getHoldings = async (tradingPairId) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT * FROM holdings WHERE trading_pair_id = ?',
      [tradingPairId]
    );
    
    if (rows.length === 0) {
      // Return default holdings with zero quantity
      return {
        tradingPairId: parseInt(tradingPairId),
        quantity: 0,
        averageBuyPrice: 0,
        lastBuyPrice: 0
      };
    }
    
    return {
      tradingPairId: rows[0].trading_pair_id,
      quantity: parseFloat(rows[0].quantity),
      averageBuyPrice: parseFloat(rows[0].average_buy_price || 0),
      lastBuyPrice: parseFloat(rows[0].last_buy_price || 0)
    };
  } catch (error) {
    console.error(`Error fetching holdings for trading pair ${tradingPairId}:`, error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

// Get transaction history for a trading pair
exports.getTransactions = async (tradingPairId) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT * FROM transactions WHERE trading_pair_id = ? ORDER BY created_at DESC',
      [tradingPairId]
    );
    
    return rows.map(row => ({
      id: row.id,
      tradingPairId: row.trading_pair_id,
      type: row.transaction_type,
      quantity: parseFloat(row.quantity),
      price: parseFloat(row.price),
      totalAmount: parseFloat(row.total_amount),
      status: row.status,
      timestamp: row.created_at
    }));
  } catch (error) {
    console.error(`Error fetching transactions for trading pair ${tradingPairId}:`, error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

// Execute a buy order
exports.executeBuyOrder = async (tradingPairId, amount) => {
  let conn;
  try {
    conn = await pool.getConnection();
    
    // Get trading pair information
    const tradingPair = await exports.getTradingPairById(tradingPairId);
    
    // Get current price from Binance (or simulation in Phase 1)
    const currentPrice = await exports.getCurrentPrice(tradingPair.symbol);
    
    // Calculate quantity based on investment amount
    const quantity = amount / currentPrice;
    
    // Start transaction
    await conn.beginTransaction();
    
    // Insert transaction record
    const transactionResult = await conn.query(
      `INSERT INTO transactions 
       (trading_pair_id, transaction_type, quantity, price, total_amount, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tradingPairId, 'BUY', quantity, currentPrice, amount, 'COMPLETED']
    );
    
    const transactionId = transactionResult.insertId;
    
    // Update or insert holdings
    const existingHoldings = await conn.query(
      'SELECT * FROM holdings WHERE trading_pair_id = ?',
      [tradingPairId]
    );
    
    if (existingHoldings.length > 0) {
      // Update existing holdings
      const currentHoldings = existingHoldings[0];
      const currentQuantity = parseFloat(currentHoldings.quantity);
      const newQuantity = currentQuantity + quantity;
      
      // Calculate new average buy price
      const currentValue = currentQuantity * parseFloat(currentHoldings.average_buy_price || 0);
      const newValue = quantity * currentPrice;
      const newAverageBuyPrice = (currentValue + newValue) / newQuantity;
      
      await conn.query(
        `UPDATE holdings 
         SET quantity = ?, average_buy_price = ?, last_buy_price = ? 
         WHERE trading_pair_id = ?`,
        [newQuantity, newAverageBuyPrice, currentPrice, tradingPairId]
      );
    } else {
      // Insert new holdings
      await conn.query(
        `INSERT INTO holdings 
         (trading_pair_id, quantity, average_buy_price, last_buy_price) 
         VALUES (?, ?, ?, ?)`,
        [tradingPairId, quantity, currentPrice, currentPrice]
      );
    }
    
    // Commit transaction
    await conn.commit();
    
    // Return transaction details
    return {
      id: transactionId,
      tradingPairId: parseInt(tradingPairId),
      type: 'BUY',
      quantity: parseFloat(quantity.toFixed(8)),
      price: currentPrice,
      totalAmount: parseFloat(amount),
      status: 'COMPLETED',
      timestamp: new Date()
    };
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Error executing buy order:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

// Execute a sell all order
exports.executeSellAllOrder = async (tradingPairId) => {
  let conn;
  try {
    conn = await pool.getConnection();
    
    // Get trading pair information
    const tradingPair = await exports.getTradingPairById(tradingPairId);
    
    // Get current holdings
    const holdings = await exports.getHoldings(tradingPairId);
    
    if (holdings.quantity <= 0) {
      throw new Error('No holdings to sell');
    }
    
    // Get current price from Binance (or simulation in Phase 1)
    const currentPrice = await exports.getCurrentPrice(tradingPair.symbol);
    
    // Calculate total amount from selling all holdings
    const totalAmount = holdings.quantity * currentPrice;
    
    // Start transaction
    await conn.beginTransaction();
    
    // Insert transaction record
    const transactionResult = await conn.query(
      `INSERT INTO transactions 
       (trading_pair_id, transaction_type, quantity, price, total_amount, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tradingPairId, 'SELL', holdings.quantity, currentPrice, totalAmount, 'COMPLETED']
    );
    
    const transactionId = transactionResult.insertId;
    
    // Reset holdings
    await conn.query(
      `UPDATE holdings 
       SET quantity = 0, average_buy_price = 0, last_buy_price = 0 
       WHERE trading_pair_id = ?`,
      [tradingPairId]
    );
    
    // Commit transaction
    await conn.commit();
    
    // Return transaction details
    return {
      id: transactionId,
      tradingPairId: parseInt(tradingPairId),
      type: 'SELL',
      quantity: parseFloat(holdings.quantity),
      price: currentPrice,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      status: 'COMPLETED',
      timestamp: new Date()
    };
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Error executing sell all order:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};