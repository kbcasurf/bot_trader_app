const express = require('express');
const router = express.Router();
const binanceService = require('../services/binanceService');
const tradingBot = require('../services/tradingBot');

// Get current price for a symbol
router.get('/price/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const price = await binanceService.getPrice(symbol);
    res.json({ symbol, price });
  } catch (error) {
    console.error('Error getting price:', error);
    res.status(500).json({ error: 'Failed to get price' });
  }
});

// Start a new trading session (first purchase)
router.post('/start-session', async (req, res) => {
  try {
    const { symbol, amount } = req.body;
    
    if (!symbol || !amount) {
      return res.status(400).json({ error: 'Symbol and amount are required' });
    }
    
    const order = await tradingBot.startNewSession(symbol, parseFloat(amount));
    res.json({ success: true, order });
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ error: 'Failed to start trading session' });
  }
});

// Get order history for a symbol
router.get('/orders/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const orders = await binanceService.getOrderHistory(symbol);
    res.json(orders);
  } catch (error) {
    console.error('Error getting orders:', error);
    res.status(500).json({ error: 'Failed to get order history' });
  }
});

// Get all trading sessions
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await tradingBot.getAllSessions();
    res.json(sessions);
  } catch (error) {
    console.error('Error getting sessions:', error);
    res.status(500).json({ error: 'Failed to get trading sessions' });
  }
});

// Get a specific trading session
router.get('/sessions/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const session = await tradingBot.getSession(symbol);
    
    if (!session) {
      return res.status(404).json({ error: 'Trading session not found' });
    }
    
    res.json(session);
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: 'Failed to get trading session' });
  }
});

module.exports = router;