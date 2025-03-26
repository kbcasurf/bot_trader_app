const db = require('../../config/database');
const logger = require('../utils/logger');

// Get system status
exports.getSystemStatus = async (req, res, next) => {
  try {
    res.json({
      status: 'online',
      timestamp: new Date().toISOString(),
      version: '0.1.0'
    });
  } catch (error) {
    next(error);
  }
};

// Get all trading pairs
exports.getTradingPairs = async (req, res, next) => {
  let conn;
  try {
    conn = await db.getConnection();
    const rows = await conn.query('SELECT * FROM crypto_config');
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching trading pairs:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};

// Get a single trading pair by ID
exports.getTradingPairById = async (req, res, next) => {
  let conn;
  try {
    const { id } = req.params;
    conn = await db.getConnection();
    const [row] = await conn.query('SELECT * FROM crypto_config WHERE id = ?', [id]);
    
    if (!row) {
      return res.status(404).json({ error: 'Trading pair not found' });
    }
    
    res.json(row);
  } catch (error) {
    logger.error('Error fetching trading pair:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};

// Create a new trading pair
exports.createTradingPair = async (req, res, next) => {
  let conn;
  try {
    const { symbol, base_asset, quote_asset, is_active } = req.body;
    
    if (!symbol || !base_asset || !quote_asset) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    conn = await db.getConnection();
    const result = await conn.query(
      'INSERT INTO crypto_config (symbol, base_asset, quote_asset, is_active) VALUES (?, ?, ?, ?)',
      [symbol, base_asset, quote_asset, is_active || true]
    );
    
    res.status(201).json({
      id: result.insertId,
      symbol,
      base_asset,
      quote_asset,
      is_active: is_active || true
    });
  } catch (error) {
    logger.error('Error creating trading pair:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};

// Update a trading pair
exports.updateTradingPair = async (req, res, next) => {
  let conn;
  try {
    const { id } = req.params;
    const { symbol, base_asset, quote_asset, is_active } = req.body;
    
    conn = await db.getConnection();
    const [existingPair] = await conn.query('SELECT * FROM crypto_config WHERE id = ?', [id]);
    
    if (!existingPair) {
      return res.status(404).json({ error: 'Trading pair not found' });
    }
    
    await conn.query(
      'UPDATE crypto_config SET symbol = ?, base_asset = ?, quote_asset = ?, is_active = ? WHERE id = ?',
      [
        symbol || existingPair.symbol,
        base_asset || existingPair.base_asset,
        quote_asset || existingPair.quote_asset,
        is_active !== undefined ? is_active : existingPair.is_active,
        id
      ]
    );
    
    const [updatedPair] = await conn.query('SELECT * FROM crypto_config WHERE id = ?', [id]);
    res.json(updatedPair);
  } catch (error) {
    logger.error('Error updating trading pair:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};

// Delete a trading pair
exports.deleteTradingPair = async (req, res, next) => {
  let conn;
  try {
    const { id } = req.params;
    
    conn = await db.getConnection();
    const [existingPair] = await conn.query('SELECT * FROM crypto_config WHERE id = ?', [id]);
    
    if (!existingPair) {
      return res.status(404).json({ error: 'Trading pair not found' });
    }
    
    await conn.query('DELETE FROM crypto_config WHERE id = ?', [id]);
    
    res.status(204).end();
  } catch (error) {
    logger.error('Error deleting trading pair:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};

// Get all trading states
exports.getAllTradingState = async (req, res, next) => {
  let conn;
  try {
    conn = await db.getConnection();
    const rows = await conn.query(`
      SELECT ts.*, cc.symbol, cc.base_asset, cc.quote_asset 
      FROM trading_state ts
      JOIN crypto_config cc ON ts.symbol = cc.symbol
    `);
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching all trading states:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};

// Get trading state by symbol
exports.getTradingStateBySymbol = async (req, res, next) => {
  let conn;
  try {
    const { symbol } = req.params;
    conn = await db.getConnection();
    const [state] = await conn.query(`
      SELECT ts.*, cc.symbol, cc.base_asset, cc.quote_asset 
      FROM trading_state ts
      JOIN crypto_config cc ON ts.symbol = cc.symbol
      WHERE ts.symbol = ?
    `, [symbol]);
    
    if (!state) {
      return res.status(404).json({ error: 'Trading state not found' });
    }
    
    res.json(state);
  } catch (error) {
    logger.error('Error fetching trading state:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};

// Activate trading for a symbol
exports.activateTradingForSymbol = async (req, res, next) => {
  let conn;
  try {
    const { symbol } = req.params;
    conn = await db.getConnection();
    
    const [state] = await conn.query('SELECT * FROM trading_state WHERE symbol = ?', [symbol]);
    
    if (!state) {
      return res.status(404).json({ error: 'Trading state not found' });
    }
    
    await conn.query('UPDATE trading_state SET is_active = TRUE WHERE symbol = ?', [symbol]);
    
    const [updatedState] = await conn.query('SELECT * FROM trading_state WHERE symbol = ?', [symbol]);
    res.json(updatedState);
  } catch (error) {
    logger.error('Error activating trading for symbol:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};

// Deactivate trading for a symbol
exports.deactivateTradingForSymbol = async (req, res, next) => {
  let conn;
  try {
    const { symbol } = req.params;
    conn = await db.getConnection();
    
    const [state] = await conn.query('SELECT * FROM trading_state WHERE symbol = ?', [symbol]);
    
    if (!state) {
      return res.status(404).json({ error: 'Trading state not found' });
    }
    
    await conn.query('UPDATE trading_state SET is_active = FALSE WHERE symbol = ?', [symbol]);
    
    const [updatedState] = await conn.query('SELECT * FROM trading_state WHERE symbol = ?', [symbol]);
    res.json(updatedState);
  } catch (error) {
    logger.error('Error deactivating trading for symbol:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};

// Get settings
exports.getSettings = async (req, res, next) => {
  let conn;
  try {
    conn = await db.getConnection();
    const rows = await conn.query('SELECT * FROM settings');
    
    // Convert array of key-value pairs to a single object
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    
    res.json(settings);
  } catch (error) {
    logger.error('Error fetching settings:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};

// Update settings
exports.updateSettings = async (req, res, next) => {
  let conn;
  try {
    const settings = req.body;
    
    if (!settings || Object.keys(settings).length === 0) {
      return res.status(400).json({ error: 'No settings provided' });
    }
    
    conn = await db.getConnection();
    await conn.beginTransaction();
    
    for (const [key, value] of Object.entries(settings)) {
      await conn.query(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
        [key, value, value]
      );
    }
    
    await conn.commit();
    
    // Fetch the updated settings
    const rows = await conn.query('SELECT * FROM settings');
    const updatedSettings = {};
    for (const row of rows) {
      updatedSettings[row.key] = row.value;
    }
    
    res.json(updatedSettings);
  } catch (error) {
    if (conn) await conn.rollback();
    logger.error('Error updating settings:', error);
    next(error);
  } finally {
    if (conn) conn.release();
  }
};