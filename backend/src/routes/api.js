const express = require('express');
const router = express.Router();
const binanceController = require('../controllers/binanceController');
const telegramController = require('../controllers/telegramController');

// Trading pairs routes
router.get('/trading-pairs', binanceController.getTradingPairs);

// Price routes
router.get('/prices/:symbol', binanceController.getCurrentPrice);

// Holdings routes
router.get('/holdings/:tradingPairId', binanceController.getHoldings);

// Transaction routes
router.get('/transactions/:tradingPairId', binanceController.getTransactions);
router.post('/transactions/buy', binanceController.buyOrder);
router.post('/transactions/sell-all', binanceController.sellAllOrder);

// Trading algorithm routes
router.get('/trading/status', binanceController.getTradingStatus);
router.post('/trading/start', binanceController.startTrading);
router.post('/trading/stop', binanceController.stopTrading);

// WebSocket management routes
router.get('/websocket/status', binanceController.getWebSocketStatus);
router.post('/websocket/restart', binanceController.restartWebSockets);

// Telegram notification routes
router.post('/telegram/test', telegramController.sendTestNotification);

module.exports = router;