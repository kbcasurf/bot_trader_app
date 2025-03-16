const express = require('express');
const router = express.Router();
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const telegramService = require('../services/telegramService');

// Send a message
router.post('/send', async (req, res, next) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    await telegramService.sendMessage(message);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get bot info
router.get('/info', async (req, res, next) => {
  try {
    const info = await telegramService.getBotInfo();
    res.json(info);
  } catch (error) {
    next(error);
  }
});

module.exports = router;