// frontend/js/monitor.js
// Connection Monitor Module
// Handles connection status monitoring and display updates

// Import socket connection
import * as Connections from './conns.js';

// Configuration for monitoring
const MONITOR_CONFIG = {
    // Update intervals in milliseconds
    STATUS_UPDATE_INTERVAL: 30000, // 30 seconds
    
    // Status display text and colors
    STATUS: {
        CONNECTED: {
            className: 'connected',
            text: 'Connected'
        },
        DISCONNECTED: {
            className: 'disconnected',
            text: 'Disconnected'
        },
        CONNECTING: {
            className: 'connecting',
            text: 'Connecting...'
        },
        DEGRADED: {
            className: 'degraded',
            text: 'Degraded'
        }
    },
    
    // Critical services (those required for trading)
    CRITICAL_SERVICES: ['backend', 'database', 'binance'],
    
    // Status indicators elements (will be filled during initialization)
    INDICATORS: {}
};

// Status state tracking
const monitorState = {
    // Connection states
    connection: {
        backend: false,
        database: false,
        binance: false,
        telegram: false,
        websocket: false
    },
    
    // Trading state
    tradingEnabled: false,
    circuitBreakerTripped: false,
    
    // Last update timestamps
    lastUpdated: {
        backend: 0,
        database: 0,
        binance: 0,
        telegram: 0,
        websocket: 0,
        overall: 0
    },
    
    // Update interval reference
    updateInterval: null,
    
    // Listeners for status changes
    listeners: []
};

/**
 * Initialize the monitor module
 * @returns {boolean} Success status
 */
function initialize() {
    console.log('Initializing connection monitor...');
    
    try {
        // Get references to all status indicators
        findStatusIndicators();
        
        // Register for connection events
        registerConnectionEvents();
        
        // Start automatic status updates
        startStatusUpdates();
        
        console.log('Connection monitor initialized successfully');
        return true;
    } catch (error) {
        console.error('Error initializing connection monitor:', error);
        return false;
    }
}

/**
 * Find all status indicator elements in the DOM
 */
function findStatusIndicators() {
    MONITOR_CONFIG.INDICATORS = {
        backend: {
            dot: document.getElementById('backend-status-dot'),
            text: document.getElementById('backend-status-text')
        },
        database: {
            dot: document.getElementById('db-status-dot'),
            text: document.getElementById('db-status-text')
        },
        binance: {
            dot: document.getElementById('binance-status-dot'),
            text: document.getElementById('binance-status-text')
        },
        telegram: {
            dot: document.getElementById('telegram-status-dot'),
            text: document.getElementById('telegram-status-text')
        },
        websocket: {
            container: document.getElementById('websocket-monitor'),
            value: document.getElementById('ws-connection-status')
        }
    };
}

/**
 * Register for connection status events
 */
function registerConnectionEvents() {
    // Connection events
    Connections.on('connect', () => updateBackendStatus(true));
    Connections.on('disconnect', () => updateBackendStatus(false));
    
    // Service status events
    Connections.on('database-status', updateDatabaseStatus);
    Connections.on('binance-status', updateBinanceStatus);
    Connections.on('telegram-status', updateTelegramStatus);
    Connections.on('websocket-status', updateWebSocketStatus);
    Connections.on('trading-status', updateTradingStatus);
    
    // Combined health status event
    Connections.on('health-status', updateHealthStatus);
}

/**
 * Start automatic status updates
 */
function startStatusUpdates() {
    // Clear any existing interval
    if (monitorState.updateInterval) {
        clearInterval(monitorState.updateInterval);
    }
    
    // Request initial status
    requestSystemStatus();
    
    // Set interval for periodic updates
    monitorState.updateInterval = setInterval(() => {
        requestSystemStatus();
    }, MONITOR_CONFIG.STATUS_UPDATE_INTERVAL);
    
    console.log(`Status updates started with interval: ${MONITOR_CONFIG.STATUS_UPDATE_INTERVAL}ms`);
}

/**
 * Request system status from backend
 */
function requestSystemStatus() {
    Connections.requestSystemStatus();
}

/**
 * Update backend connection status
 * @param {boolean} isConnected - Whether backend is connected
 */
function updateBackendStatus(isConnected) {
    // Update state
    monitorState.connection.backend = isConnected;
    monitorState.lastUpdated.backend = Date.now();
    
    // Update display
    updateStatusDisplay('backend', isConnected);
    
    // Check overall system health
    checkOverallHealth();
    
    // Notify listeners
    notifyStatusListeners('backend', isConnected);
}

/**
 * Update database connection status
 * @param {boolean} isConnected - Whether database is connected
 */
function updateDatabaseStatus(isConnected) {
    // Update state
    monitorState.connection.database = isConnected;
    monitorState.lastUpdated.database = Date.now();
    
    // Update display
    updateStatusDisplay('database', isConnected);
    
    // Check overall system health
    checkOverallHealth();
    
    // Notify listeners
    notifyStatusListeners('database', isConnected);
}

/**
 * Update Binance API connection status
 * @param {boolean} isConnected - Whether Binance API is connected
 */
function updateBinanceStatus(isConnected) {
    // Update state
    monitorState.connection.binance = isConnected;
    monitorState.lastUpdated.binance = Date.now();
    
    // Update display
    updateStatusDisplay('binance', isConnected);
    
    // Check overall system health
    checkOverallHealth();
    
    // Notify listeners
    notifyStatusListeners('binance', isConnected);
}

/**
 * Update Telegram bot connection status
 * @param {boolean} isConnected - Whether Telegram bot is connected
 */
function updateTelegramStatus(isConnected) {
    // Update state
    monitorState.connection.telegram = isConnected;
    monitorState.lastUpdated.telegram = Date.now();
    
    // Update display
    updateStatusDisplay('telegram', isConnected);
    
    // Telegram is not critical, so no need to check overall health
    
    // Notify listeners
    notifyStatusListeners('telegram', isConnected);
}

/**
 * Update WebSocket connection status
 * @param {Object} status - WebSocket status object
 */
function updateWebSocketStatus(status) {
    // Update state
    monitorState.connection.websocket = status.connected || false;
    monitorState.lastUpdated.websocket = Date.now();
    
    // Update WebSocket display
    const wsContainer = MONITOR_CONFIG.INDICATORS.websocket?.container;
    const wsValue = MONITOR_CONFIG.INDICATORS.websocket?.value;
    
    if (wsContainer && wsValue) {
        // Show the WebSocket monitor
        wsContainer.style.display = 'block';
        
        // Update status text and class
        wsValue.textContent = status.connected ? 
            MONITOR_CONFIG.STATUS.CONNECTED.text : 
            MONITOR_CONFIG.STATUS.DISCONNECTED.text;
        
        wsValue.className = 'status-value ' + (status.connected ? 
            MONITOR_CONFIG.STATUS.CONNECTED.className : 
            MONITOR_CONFIG.STATUS.DISCONNECTED.className);
    }
    
    // WebSocket is important but not critical, so no need to check overall health
    
    // Notify listeners
    notifyStatusListeners('websocket', status.connected);
}

/**
 * Update trading status
 * @param {Object} status - Trading status object
 */
function updateTradingStatus(status) {
    // Update state
    monitorState.tradingEnabled = status.active || false;
    monitorState.circuitBreakerTripped = status.circuitBreaker || false;
    
    // Update trading availability based on status
    toggleTradingAvailability(monitorState.tradingEnabled && !monitorState.circuitBreakerTripped);
    
    // Notify listeners
    notifyStatusListeners('trading', {
        enabled: monitorState.tradingEnabled,
        circuitBreaker: monitorState.circuitBreakerTripped
    });
}

/**
 * Update combined health status
 * @param {Object} status - Health status object
 */
function updateHealthStatus(status) {
    // Update all connection states at once
    monitorState.connection.backend = status.backend || false;
    monitorState.connection.database = status.database || false;
    monitorState.connection.binance = status.binance || false;
    monitorState.connection.telegram = status.telegram || false;
    monitorState.connection.websocket = status.websocket || false;
    
    // Update all displays
    updateStatusDisplay('backend', monitorState.connection.backend);
    updateStatusDisplay('database', monitorState.connection.database);
    updateStatusDisplay('binance', monitorState.connection.binance);
    updateStatusDisplay('telegram', monitorState.connection.telegram);
    
    // Update WebSocket display
    updateWebSocketStatus({ connected: monitorState.connection.websocket });
    
    // Update last update timestamps
    Object.keys(monitorState.connection).forEach(service => {
        monitorState.lastUpdated[service] = Date.now();
    });
    
    // Check overall health
    checkOverallHealth();
    
    // Notify listeners of the combined update
    notifyStatusListeners('health', status);
}

/**
 * Update status display for a service
 * @param {string} service - Service name
 * @param {boolean} isConnected - Whether service is connected
 */
function updateStatusDisplay(service, isConnected) {
    const indicators = MONITOR_CONFIG.INDICATORS[service];
    if (!indicators) return;
    
    // Update dot status
    if (indicators.dot) {
        indicators.dot.className = 'status-dot ' + (isConnected ? 
            MONITOR_CONFIG.STATUS.CONNECTED.className : 
            MONITOR_CONFIG.STATUS.DISCONNECTED.className);
    }
    
    // Update text status
    if (indicators.text) {
        const serviceName = service.charAt(0).toUpperCase() + service.slice(1);
        indicators.text.textContent = `${serviceName}: ${isConnected ? 
            MONITOR_CONFIG.STATUS.CONNECTED.text : 
            MONITOR_CONFIG.STATUS.DISCONNECTED.text}`;
    }
}

/**
 * Check overall system health and update trading availability
 */
function checkOverallHealth() {
    // Check if all critical services are connected
    const allCriticalConnected = MONITOR_CONFIG.CRITICAL_SERVICES.every(
        service => monitorState.connection[service]
    );
    
    // Update last check timestamp
    monitorState.lastUpdated.overall = Date.now();
    
    // Toggle trading availability based on system health
    toggleTradingAvailability(
        allCriticalConnected && 
        monitorState.tradingEnabled && 
        !monitorState.circuitBreakerTripped
    );
    
    // Update monitor container if present
    const monitorContainer = document.querySelector('.status-section');
    if (monitorContainer) {
        if (allCriticalConnected) {
            monitorContainer.classList.remove('degraded', 'critical');
        } else {
            // Add appropriate class based on which services are down
            const criticalDown = MONITOR_CONFIG.CRITICAL_SERVICES.some(
                service => !monitorState.connection[service]
            );
            
            if (criticalDown) {
                monitorContainer.classList.add('critical');
                monitorContainer.classList.remove('degraded');
            } else {
                monitorContainer.classList.add('degraded');
                monitorContainer.classList.remove('critical');
            }
        }
    }
    
    // Notify listeners of overall health change
    notifyStatusListeners('overall', allCriticalConnected);
    
    return allCriticalConnected;
}

/**
 * Toggle trading availability based on system health
 * @param {boolean} available - Whether trading should be available
 */
function toggleTradingAvailability(available) {
    // Find all buy/sell buttons
    const buyButtons = document.querySelectorAll('.action-btn.first-purchase');
    const sellButtons = document.querySelectorAll('.action-btn.sell-all');
    
    // Update button states
    if (available) {
        // Enable buttons
        buyButtons.forEach(btn => {
            btn.classList.remove('disabled');
            btn.disabled = false;
        });
        
        sellButtons.forEach(btn => {
            btn.classList.remove('disabled');
            btn.disabled = false;
        });
        
        // Update notification banner if exists
        const banner = document.getElementById('system-status-banner');
        if (banner) {
            banner.style.display = 'none';
        }
    } else {
        // Disable buttons
        buyButtons.forEach(btn => {
            btn.classList.add('disabled');
            btn.disabled = true;
        });
        
        sellButtons.forEach(btn => {
            btn.classList.add('disabled');
            btn.disabled = true;
        });
        
        // Update notification banner if exists
        const banner = document.getElementById('system-status-banner');
        if (banner) {
            banner.style.display = 'block';
            banner.textContent = monitorState.circuitBreakerTripped ?
                'Trading is currently suspended due to system errors. Please try again later.' :
                'Trading is unavailable due to connection issues. Please wait for services to reconnect.';
        } else {
            // Create a banner if it doesn't exist
            createStatusBanner(monitorState.circuitBreakerTripped ?
                'Trading is currently suspended due to system errors. Please try again later.' :
                'Trading is unavailable due to connection issues. Please wait for services to reconnect.'
            );
        }
    }
    
    // Return current availability state
    return available;
}

/**
 * Create a status notification banner
 * @param {string} message - Banner message
 * @returns {HTMLElement} Banner element
 */
function createStatusBanner(message) {
    // Create banner element
    const banner = document.createElement('div');
    banner.id = 'system-status-banner';
    banner.className = 'status-banner';
    banner.textContent = message;
    
    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-banner';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
        banner.style.display = 'none';
    });
    
    // Add button to banner
    banner.appendChild(closeBtn);
    
    // Add banner to page
    document.body.insertBefore(banner, document.body.firstChild);
    
    return banner;
}

/**
 * Register a listener for connection status changes
 * @param {Function} listener - Callback function
 * @returns {Function} Function to remove the listener
 */
function registerStatusListener(listener) {
    if (typeof listener !== 'function') {
        throw new Error('Listener must be a function');
    }
    
    monitorState.listeners.push(listener);
    
    // Return function to unregister the listener
    return function() {
        const index = monitorState.listeners.indexOf(listener);
        if (index !== -1) {
            monitorState.listeners.splice(index, 1);
        }
    };
}

/**
 * Notify all registered listeners of a status change
 * @param {string} service - Service that changed status
 * @param {*} status - New status value
 */
function notifyStatusListeners(service, status) {
    monitorState.listeners.forEach(listener => {
        try {
            listener(service, status);
        } catch (error) {
            console.error('Error in status listener:', error);
        }
    });
}

/**
 * Get current connection status
 * @returns {Object} Connection status object
 */
function getConnectionStatus() {
    return {
        ...monitorState.connection,
        trading: {
            enabled: monitorState.tradingEnabled,
            circuitBreaker: monitorState.circuitBreakerTripped
        },
        lastUpdated: { ...monitorState.lastUpdated },
        overall: checkOverallHealth()
    };
}

/**
 * Manually refresh all status indicators
 */
function refreshStatus() {
    requestSystemStatus();
}

// Export public API
export {
    initialize,
    updateBackendStatus,
    updateDatabaseStatus,
    updateBinanceStatus,
    updateTelegramStatus,
    updateWebSocketStatus,
    updateTradingStatus,
    toggleTradingAvailability,
    getConnectionStatus,
    refreshStatus,
    registerStatusListener
};