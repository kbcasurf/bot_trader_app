// backend/js/health.js
// Health Monitoring Module
// Handles monitoring health of all system connections and services

// Import required modules
const binanceAPI = require('./binance.js');
const dbconns = require('./dbconns.js');
const telegramAPI = require('./telegram.js');

// Configuration for health checks
const HEALTH_CONFIG = {
    // Check intervals in milliseconds
    CHECK_INTERVALS: {
        BINANCE_API: 60000,     // 1 minute
        BINANCE_WSS: 30000,     // 30 seconds
        DATABASE: 45000,        // 45 seconds
        TELEGRAM: 120000,       // 2 minutes
        FRONTEND_SOCKET: 20000, // 20 seconds
        OVERALL: 15000          // 15 seconds for overall status check
    },
    
    // Timeouts for considering a service as unhealthy
    TIMEOUTS: {
        BINANCE_API: 10000,     // 10 seconds
        BINANCE_WSS: 5000,      // 5 seconds
        DATABASE: 8000,         // 8 seconds
        TELEGRAM: 15000,        // 15 seconds
        FRONTEND_SOCKET: 5000   // 5 seconds
    },
    
    // Maximum number of consecutive failures before marking as down
    MAX_FAILURES: {
        BINANCE_API: 3,
        BINANCE_WSS: 2,
        DATABASE: 2,
        TELEGRAM: 2,
        FRONTEND_SOCKET: 3
    }
};

// Health state tracking
const healthState = {
    status: {
        binanceAPI: { healthy: false, lastChecked: 0, lastSuccess: 0, failures: 0, details: {} },
        binanceWSS: { healthy: false, lastChecked: 0, lastSuccess: 0, failures: 0, details: {} },
        database: { healthy: false, lastChecked: 0, lastSuccess: 0, failures: 0, details: {} },
        telegram: { healthy: false, lastChecked: 0, lastSuccess: 0, failures: 0, details: {} },
        frontendSocket: { healthy: false, lastChecked: 0, lastSuccess: 0, failures: 0, details: {} },
        overall: { healthy: false, lastChecked: 0, details: {} }
    },
    lastNotification: {
        binanceAPI: 0,
        binanceWSS: 0,
        database: 0,
        telegram: 0,
        frontendSocket: 0,
        overall: 0
    },
    listeners: [],
    intervals: {},
    io: null
};

/**
 * Initialize health monitoring
 * @param {Object} io - Socket.io instance for emitting updates
 * @returns {boolean} Initialization success
 */
function initialize(io) {
    console.log('Initializing health monitoring...');
    
    try {
        // Store Socket.io instance for emitting updates
        healthState.io = io;
        
        // Start health check intervals
        startHealthChecks();
        
        console.log('Health monitoring initialized successfully');
        return true;
    } catch (error) {
        console.error('Error initializing health monitoring:', error);
        return false;
    }
}

/**
 * Start all health check intervals
 */
function startHealthChecks() {
    // Clear any existing intervals first
    stopHealthChecks();
    
    // Start individual service checks
    healthState.intervals.binanceAPI = setInterval(
        checkBinanceAPIHealth, 
        HEALTH_CONFIG.CHECK_INTERVALS.BINANCE_API
    );
    
    healthState.intervals.binanceWSS = setInterval(
        checkBinanceWebSocketHealth, 
        HEALTH_CONFIG.CHECK_INTERVALS.BINANCE_WSS
    );
    
    healthState.intervals.database = setInterval(
        checkDatabaseHealth, 
        HEALTH_CONFIG.CHECK_INTERVALS.DATABASE
    );
    
    healthState.intervals.telegram = setInterval(
        checkTelegramHealth, 
        HEALTH_CONFIG.CHECK_INTERVALS.TELEGRAM
    );
    
    healthState.intervals.frontendSocket = setInterval(
        checkFrontendSocketHealth, 
        HEALTH_CONFIG.CHECK_INTERVALS.FRONTEND_SOCKET
    );
    
    // Overall health check (combines results from individual checks)
    healthState.intervals.overall = setInterval(
        checkOverallHealth, 
        HEALTH_CONFIG.CHECK_INTERVALS.OVERALL
    );
    
    // Run initial checks immediately
    checkBinanceAPIHealth();
    checkBinanceWebSocketHealth();
    checkDatabaseHealth();
    checkTelegramHealth();
    
    console.log('Health check intervals started');
}

/**
 * Stop all health check intervals
 */
function stopHealthChecks() {
    // Clear all intervals
    Object.values(healthState.intervals).forEach(interval => {
        if (interval) clearInterval(interval);
    });
    
    // Reset intervals object
    healthState.intervals = {};
    
    console.log('Health check intervals stopped');
}

/**
 * Check Binance API health
 */
async function checkBinanceAPIHealth() {
    const component = 'binanceAPI';
    const now = Date.now();
    
    // Mark check as started
    healthState.status[component].lastChecked = now;
    
    try {
        // Set timeout to prevent long-running checks
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), HEALTH_CONFIG.TIMEOUTS.BINANCE_API);
        });
        
        // Run the actual check
        const testResult = await Promise.race([
            binanceAPI.testConnection(),
            timeoutPromise
        ]);
        
        // Update health state based on result
        updateHealthState(component, true, {
            responseTime: Date.now() - now,
            testResult
        });
    } catch (error) {
        console.warn(`Binance API health check failed: ${error.message}`);
        
        // Update health state with error
        updateHealthState(component, false, {
            error: error.message,
            time: now
        });
    }
}

/**
 * Check Binance WebSocket health
 */
async function checkBinanceWebSocketHealth() {
    const component = 'binanceWSS';
    const now = Date.now();
    
    // Mark check as started
    healthState.status[component].lastChecked = now;
    
    try {
        // Get WebSocket status from Binance API module
        const status = binanceAPI.getWebSocketStatus();
        
        // Determine if WebSocket is healthy
        const isHealthy = status && 
                         (status.connections && Object.keys(status.connections).length > 0) &&
                         (!status.pollingActive); // We prefer WebSocket over polling
        
        // Update health state
        updateHealthState(component, isHealthy, {
            wsStatus: status,
            time: now
        });
    } catch (error) {
        console.warn(`Binance WebSocket health check failed: ${error.message}`);
        
        // Update health state with error
        updateHealthState(component, false, {
            error: error.message,
            time: now
        });
    }
}

/**
 * Check database health
 */
async function checkDatabaseHealth() {
    const component = 'database';
    const now = Date.now();
    
    // Mark check as started
    healthState.status[component].lastChecked = now;
    
    try {
        // Set timeout to prevent long-running checks
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), HEALTH_CONFIG.TIMEOUTS.DATABASE);
        });
        
        // Run the actual check
        const healthStats = await Promise.race([
            dbconns.getHealthStats(),
            timeoutPromise
        ]);
        
        // Update health state based on result
        updateHealthState(component, healthStats.healthy, {
            responseTime: Date.now() - now,
            stats: healthStats
        });
    } catch (error) {
        console.warn(`Database health check failed: ${error.message}`);
        
        // Update health state with error
        updateHealthState(component, false, {
            error: error.message,
            time: now
        });
    }
}

/**
 * Check Telegram bot health
 */
async function checkTelegramHealth() {
    const component = 'telegram';
    const now = Date.now();
    
    // Mark check as started
    healthState.status[component].lastChecked = now;
    
    try {
        // Set timeout to prevent long-running checks
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), HEALTH_CONFIG.TIMEOUTS.TELEGRAM);
        });
        
        // Run the actual check
        const testResult = await Promise.race([
            telegramAPI.testConnection(),
            timeoutPromise
        ]);
        
        // Update health state based on result
        updateHealthState(component, testResult, {
            responseTime: Date.now() - now
        });
    } catch (error) {
        console.warn(`Telegram health check failed: ${error.message}`);
        
        // Update health state with error
        updateHealthState(component, false, {
            error: error.message,
            time: now
        });
    }
}

/**
 * Check frontend Socket.io connection health
 * This checks if there are any connected clients
 */
function checkFrontendSocketHealth() {
    const component = 'frontendSocket';
    const now = Date.now();
    
    // Mark check as started
    healthState.status[component].lastChecked = now;
    
    try {
        // Check if Socket.io is available
        if (!healthState.io) {
            updateHealthState(component, false, {
                error: 'Socket.io instance not available',
                time: now
            });
            return;
        }
        
        // Get number of connected clients
        const connectedSockets = Object.keys(healthState.io.sockets.sockets).length;
        const isHealthy = connectedSockets > 0;
        
        // Update health state
        updateHealthState(component, isHealthy, {
            connectedClients: connectedSockets,
            time: now
        });
    } catch (error) {
        console.warn(`Frontend Socket health check failed: ${error.message}`);
        
        // Update health state with error
        updateHealthState(component, false, {
            error: error.message,
            time: now
        });
    }
}

/**
 * Check overall system health
 * Aggregates results from individual component checks
 */
function checkOverallHealth() {
    const component = 'overall';
    const now = Date.now();
    
    // Mark check as started
    healthState.status[component].lastChecked = now;
    
    try {
        // Get recent status of all critical components
        const components = ['binanceAPI', 'binanceWSS', 'database'];
        
        // Check if all critical components are healthy
        const allCriticalHealthy = components.every(comp => healthState.status[comp].healthy);
        
        // Get all component statuses
        const allStatuses = Object.entries(healthState.status).reduce((acc, [name, status]) => {
            if (name !== 'overall') {
                acc[name] = status.healthy;
            }
            return acc;
        }, {});
        
        // Update overall health state
        updateHealthState(component, allCriticalHealthy, {
            components: allStatuses,
            time: now
        });
        
        // Emit overall health status to clients
        emitHealthStatus();
        
        // If overall status changed to unhealthy, notify via Telegram
        if (!allCriticalHealthy && 
            healthState.status[component].failures === 1 && 
            now - healthState.lastNotification.overall > 300000) {  // 5 minutes between notifications
            
            // Only send if Telegram is healthy
            if (healthState.status.telegram.healthy) {
                telegramAPI.sendSystemAlert({
                    type: 'error',
                    message: 'System health check failed',
                    details: `Critical components status: ${JSON.stringify(allStatuses)}`
                });
                
                healthState.lastNotification.overall = now;
            }
        }
    } catch (error) {
        console.warn(`Overall health check failed: ${error.message}`);
        
        // Update health state with error
        updateHealthState(component, false, {
            error: error.message,
            time: now
        });
    }
}

/**
 * Update health state for a component
 * @param {string} component - Component name
 * @param {boolean} isHealthy - Whether component is healthy
 * @param {Object} details - Additional details
 */
function updateHealthState(component, isHealthy, details = {}) {
    const status = healthState.status[component];
    const now = Date.now();
    
    // If status changed from healthy to unhealthy, increment failure count
    if (status.healthy && !isHealthy) {
        status.failures += 1;
    } 
    // If status changed from unhealthy to healthy, reset failure count
    else if (!status.healthy && isHealthy) {
        status.failures = 0;
    }
    
    // Only consider unhealthy if it fails multiple times in a row
    const maxFailures = HEALTH_CONFIG.MAX_FAILURES[component] || 1;
    const effectiveHealthy = !isHealthy ? (status.failures < maxFailures) : true;
    
    // Update status
    status.healthy = effectiveHealthy;
    status.details = details;
    
    // Update last success time if healthy
    if (isHealthy) {
        status.lastSuccess = now;
    }
    
    // If status changed and the component is now unhealthy, emit update
    if (status.healthy !== effectiveHealthy && !effectiveHealthy) {
        emitComponentStatus(component, effectiveHealthy);
        
        // Notify via Telegram if appropriate (and not the telegram component itself)
        if (component !== 'telegram' && 
            healthState.status.telegram.healthy && 
            now - healthState.lastNotification[component] > 300000) {  // 5 minutes between notifications
            
            telegramAPI.sendSystemAlert({
                type: 'warning',
                message: `${component} service is down`,
                details: details.error || 'No details available'
            });
            
            healthState.lastNotification[component] = now;
        }
    }
    
    // Call any registered listeners
    healthState.listeners.forEach(listener => {
        try {
            listener(component, effectiveHealthy, details);
        } catch (error) {
            console.error(`Error in health status listener: ${error.message}`);
        }
    });
}

/**
 * Emit health status of a specific component to clients
 * @param {string} component - Component name
 * @param {boolean} isHealthy - Whether component is healthy
 */
function emitComponentStatus(component, isHealthy) {
    // Skip if Socket.io is not available
    if (!healthState.io) return;
    
    // Map component name to event name
    const eventMap = {
        'binanceAPI': 'binance-status',
        'binanceWSS': 'websocket-status',
        'database': 'database-status',
        'telegram': 'telegram-status',
        'frontendSocket': 'frontend-socket-status'
    };
    
    const eventName = eventMap[component];
    if (!eventName) return;
    
    // Emit status update
    if (component === 'binanceWSS') {
        // Special handling for WebSocket status which has a different format
        healthState.io.emit(eventName, { 
            connected: isHealthy 
        });
    } else {
        healthState.io.emit(eventName, isHealthy);
    }
}

/**
 * Emit complete health status to clients
 */
function emitHealthStatus() {
    // Skip if Socket.io is not available
    if (!healthState.io) return;
    
    // Create health status object
    const status = {
        binance: healthState.status.binanceAPI.healthy,
        database: healthState.status.database.healthy,
        telegram: healthState.status.telegram.healthy,
        websocket: healthState.status.binanceWSS.healthy,
        frontend: healthState.status.frontendSocket.healthy,
        overall: healthState.status.overall.healthy,
        timestamp: Date.now()
    };
    
    // Emit status update
    healthState.io.emit('health-status', status);
}

/**
 * Register a listener for health status changes
 * @param {Function} listener - Callback function for health status changes
 * @returns {Function} Function to remove the listener
 */
function registerStatusListener(listener) {
    if (typeof listener !== 'function') {
        throw new Error('Listener must be a function');
    }
    
    healthState.listeners.push(listener);
    
    // Return function to remove the listener
    return function() {
        const index = healthState.listeners.indexOf(listener);
        if (index !== -1) {
            healthState.listeners.splice(index, 1);
        }
    };
}

/**
 * Get current health status
 * @returns {Object} Health status object
 */
function getHealthStatus() {
    // Create a simplified status object for external consumption
    return {
        binanceAPI: healthState.status.binanceAPI.healthy,
        binanceWSS: healthState.status.binanceWSS.healthy,
        database: healthState.status.database.healthy,
        telegram: healthState.status.telegram.healthy,
        frontend: healthState.status.frontendSocket.healthy,
        overall: healthState.status.overall.healthy,
        lastUpdated: {
            binanceAPI: healthState.status.binanceAPI.lastChecked,
            binanceWSS: healthState.status.binanceWSS.lastChecked,
            database: healthState.status.database.lastChecked,
            telegram: healthState.status.telegram.lastChecked,
            frontend: healthState.status.frontendSocket.lastChecked,
            overall: healthState.status.overall.lastChecked
        },
        details: {
            binanceAPI: healthState.status.binanceAPI.details,
            binanceWSS: healthState.status.binanceWSS.details,
            database: healthState.status.database.details,
            telegram: healthState.status.telegram.details,
            frontend: healthState.status.frontendSocket.details,
            overall: healthState.status.overall.details
        }
    };
}

/**
 * Get detailed health status (including internal state)
 * @returns {Object} Detailed health status object
 */
function getDetailedHealthStatus() {
    return {
        status: JSON.parse(JSON.stringify(healthState.status)), // Deep copy
        config: HEALTH_CONFIG,
        lastNotification: { ...healthState.lastNotification },
        listenerCount: healthState.listeners.length
    };
}

// Export all functions
module.exports = {
    initialize,
    startHealthChecks,
    stopHealthChecks,
    checkBinanceAPIHealth,
    checkBinanceWebSocketHealth,
    checkDatabaseHealth,
    checkTelegramHealth,
    checkFrontendSocketHealth,
    checkOverallHealth,
    registerStatusListener,
    getHealthStatus,
    getDetailedHealthStatus
};