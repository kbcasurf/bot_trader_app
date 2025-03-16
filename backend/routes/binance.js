const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const binanceService = require('../services/binanceService');

// Get account information
router.get('/account', async (req, res, next) => {
  try {
    const accountInfo = await binanceService.getAccountInfo();
    res.json(accountInfo);
  } catch (error) {
    next(error);
  }
});

// Get current price for a symbol
router.get('/price/:symbol', async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const price = await binanceService.getCurrentPrice(symbol);
    res.json({ symbol, price });
  } catch (error) {
    next(error);
  }
});

// Start a new trading session
router.post('/session/start', async (req, res, next) => {
  try {
    const { symbol, amount } = req.body;
    
    if (!symbol || !amount) {
      return res.status(400).json({ error: 'Symbol and amount are required' });
    }
    
    const result = await binanceService.startSession(symbol, parseFloat(amount));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get session data
router.get('/session/:symbol', async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const session = await binanceService.getSession(symbol);
    res.json(session);
  } catch (error) {
    next(error);
  }
});

// Get orders for a session
router.get('/orders/:symbol', async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const orders = await binanceService.getOrders(symbol);
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

// Get all settings
router.get('/settings', async (req, res) => {
  try {
    const [settings] = await db.query('SELECT setting_key, value FROM settings');
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update settings
router.post('/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    
    // Validate settings
    if (!settings || !Array.isArray(settings)) {
      return res.status(400).json({ error: 'Invalid settings format' });
    }
    
    // Update each setting
    for (const setting of settings) {
      if (!setting.key || !setting.value) continue;
      
      await db.query(
        'UPDATE settings SET value = ? WHERE setting_key = ?',
        [setting.value, setting.key]
      );
    }
    
    // Get updated settings
    const [updatedSettings] = await db.query('SELECT setting_key, value FROM settings');
    res.json(updatedSettings);
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;