const os = require('os');
const db = require('../../config/database');
const logger = require('../utils/logger');
const packageJson = require('../../package.json');

// Get overall system status
exports.getStatus = async (req, res, next) => {
  try {
    let dbStatus = false;
    
    // Check database connection
    try {
      const conn = await db.getConnection();
      await conn.ping();
      conn.release();
      dbStatus = true;
    } catch (error) {
      logger.error('Database status check failed:', error);
    }
    
    // Basic system information
    const systemInfo = {
      uptime: Math.floor(process.uptime()),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      },
      cpus: os.cpus().length,
      load: os.loadavg()
    };
    
    res.json({
      status: 'online',
      timestamp: new Date().toISOString(),
      version: packageJson.version,
      database: {
        connected: dbStatus
      },
      system: systemInfo
    });
  } catch (error) {
    logger.error('Error getting status:', error);
    next(error);
  }
};

// Simple health check
exports.getHealth = async (req, res, next) => {
  try {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting health status:', error);
    next(error);
  }
};

// Get application version
exports.getVersion = async (req, res, next) => {
  try {
    res.json({
      version: packageJson.version,
      name: packageJson.name,
      description: packageJson.description
    });
  } catch (error) {
    logger.error('Error getting version:', error);
    next(error);
  }
};