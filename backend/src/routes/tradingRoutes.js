const express = require('express');
const router = express.Router();
const tradingController = require('../controllers/tradingController');
const { authenticate } = require('../middleware/auth');

// Public routes
router.get('/status', tradingController.getSystemStatus);

// Protected routes (require authentication)
// Uncomment the authenticate middleware when authentication is implemented
// router.use(authenticate);

// Trading pair configuration routes
router.get('/pairs', tradingController.getTradingPairs);
router.get('/pairs/:id', tradingController.getTradingPairById);
router.post('/pairs', tradingController.createTradingPair);
router.put('/pairs/:id', tradingController.updateTradingPair);
router.delete('/pairs/:id', tradingController.deleteTradingPair);

// Trading state routes
router.get('/state', tradingController.getAllTradingState);
router.get('/state/:symbol', tradingController.getTradingStateBySymbol);
router.put('/state/:symbol/activate', tradingController.activateTradingForSymbol);
router.put('/state/:symbol/deactivate', tradingController.deactivateTradingForSymbol);

// Settings routes
router.get('/settings', tradingController.getSettings);
router.put('/settings', tradingController.updateSettings);

module.exports = router;