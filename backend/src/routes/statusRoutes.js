const express = require('express');
const router = express.Router();
const statusController = require('../controllers/statusController');

// Public routes
router.get('/', statusController.getStatus);
router.get('/health', statusController.getHealth);
router.get('/version', statusController.getVersion);

module.exports = router;