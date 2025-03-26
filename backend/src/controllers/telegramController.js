const telegramService = require('../services/telegramService');

// Send a test notification
exports.sendTestNotification = async (req, res, next) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const success = await telegramService.sendNotification(message);
    
    if (success) {
      res.json({ success: true, message: 'Test notification sent successfully' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to send test notification' });
    }
  } catch (error) {
    next(error);
  }
};