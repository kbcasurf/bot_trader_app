const express = require('express');
const router = express.Router();
const binanceController = require('../controllers/binanceController');

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

module.exports = router;