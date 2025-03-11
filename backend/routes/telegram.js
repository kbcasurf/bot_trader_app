const express = require('express');
const router = express.Router();
const telegramService = require('../services/telegramService');

// Send a test message
router.post('/send-message', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const result = await telegramService.sendMessage(message);
    res.json({ success: result });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;