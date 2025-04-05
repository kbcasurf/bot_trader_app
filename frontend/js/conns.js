// frontend/js/conns.js
// Connection Module
// Handles Socket.io connections and API communication

// Use require instead of import
const io = require('socket.io-client');

// Connection configuration
const CONNECTION_CONFIG = {
    // Automatically determine backend URL based on environment
    BACKEND_URL: window.VITE_BACKEND_URL || window.location.origin,
    
    // Reconnection settings
    RECONNECTION: true,
    RECONNECTION_ATTEMPTS: 10,
    RECONNECTION_DELAY: 1000,
    RECONNECTION_DELAY_MAX: 10000,
    
    // Request timeout in milliseconds
    REQUEST_TIMEOUT: 10000,
    
    // Debug mode (enabled in development)
    DEBUG: process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost'
};

// Connection state tracking
const connectionState = {
    socket: null,
    isConnected: false,
    isConnecting: false,
    reconnectAttempts: 0,
    eventListeners: {},
    lastConnectedTime: 0,
    heartbeatInterval: null,
    messageQueue: []
};

/**
 * Initialize connection module
 * @returns {boolean} Success status
 */
function initialize() {
    console.log('Initializing socket.io connections...');
    
    // Skip if already initialized
    if (connectionState.socket) {
        console.warn('Socket connections already initialized');
        return true;
    }
    
    try {
        // Create Socket.io connection
        connectionState.socket = io(CONNECTION_CONFIG.BACKEND_URL, {
            reconnection: CONNECTION_CONFIG.RECONNECTION,
            reconnectionAttempts: CONNECTION_CONFIG.RECONNECTION_ATTEMPTS,
            reconnectionDelay: CONNECTION_CONFIG.RECONNECTION_DELAY,
            reconnectionDelayMax: CONNECTION_CONFIG.RECONNECTION_DELAY_MAX,
            timeout: CONNECTION_CONFIG.REQUEST_TIMEOUT,
            transports: ['websocket', 'polling']
        });
        
        // Register for socket events
        connectionState.socket.on('connect', handleConnect);
        connectionState.socket.on('disconnect', handleDisconnect);
        connectionState.socket.on('connect_error', handleConnectionError);
        connectionState.socket.on('error', handleError);
        
        // Set connecting state
        connectionState.isConnecting = true;
        
        // Register for heartbeat responses
        connectionState.socket.on('pong', handleHeartbeatResponse);
        
        // Debug event logging
        if (CONNECTION_CONFIG.DEBUG) {
            enableDebugLogging();
        }
        
        console.log('Socket.io connections initialized successfully');
        return true;
    } catch (error) {
        console.error('Error initializing socket.io connections:', error);
        return false;
    }
}

/**
 * Enable debug logging for Socket.io events
 */
function enableDebugLogging() {
    // Log all emitted events
    const originalEmit = connectionState.socket.emit;
    connectionState.socket.emit = function(event, ...args) {
        if (event !== 'ping') { // Don't log heartbeat pings
            console.debug(`Socket.io EMIT: ${event}`, args.length > 0 ? args[0] : '');
        }
        return originalEmit.apply(this, [event, ...args]);
    };
    
    // Create wrapper to log all events
    const debugEvents = [
        'price-update', 'transaction-update', 'holdings-update', 'websocket-status',
        'database-status', 'binance-status', 'telegram-status', 'trading-status',
        'batch-data-update', 'health-status'
    ];
    
    // Register debug listeners
    debugEvents.forEach(event => {
        connectionState.socket.on(event, (data) => {
            console.debug(`Socket.io RECEIVE: ${event}`, data);
        });
    });
}

/**
 * Handle successful connection
 */
function handleConnect() {
    console.log('Socket.io connected to backend');
    
    // Update state
    connectionState.isConnected = true;
    connectionState.isConnecting = false;
    connectionState.reconnectAttempts = 0;
    connectionState.lastConnectedTime = Date.now();
    
    // Send any queued messages
    if (connectionState.messageQueue.length > 0) {
        console.log(`Sending ${connectionState.messageQueue.length} queued messages`);
        
        // Process queue
        while (connectionState.messageQueue.length > 0) {
            const { event, data, callback } = connectionState.messageQueue.shift();
            connectionState.socket.emit(event, data, callback);
        }
    }
    
    // Emit event to listeners
    emitEvent('connect');
    
    // Start heartbeat checks
    startHeartbeat();
}

/**
 * Handle disconnection
 * @param {string} reason - Disconnect reason
 */
function handleDisconnect(reason) {
    console.log('Socket.io disconnected:', reason);
    
    // Update state
    connectionState.isConnected = false;
    
    // Stop heartbeat
    if (connectionState.heartbeatInterval) {
        clearInterval(connectionState.heartbeatInterval);
        connectionState.heartbeatInterval = null;
    }
    
    // Emit event to listeners
    emitEvent('disconnect', reason);
}

/**
 * Handle connection error
 * @param {Error} error - Connection error
 */
function handleConnectionError(error) {
    console.error('Socket.io connection error:', error);
    
    // Update reconnect attempts
    connectionState.reconnectAttempts++;
    
    // If max attempts reached, emit critical event
    if (connectionState.reconnectAttempts >= CONNECTION_CONFIG.RECONNECTION_ATTEMPTS) {
        emitEvent('connection_failure', error);
    }
    
    // Emit event to listeners
    emitEvent('connect_error', error);
}

/**
 * Handle general socket error
 * @param {Error} error - Socket error
 */
function handleError(error) {
    console.error('Socket.io error:', error);
    
    // Emit event to listeners
    emitEvent('error', error);
}

/**
 * Handle heartbeat response
 * @param {Object} response - Heartbeat response
 */
function handleHeartbeatResponse(response) {
    if (CONNECTION_CONFIG.DEBUG) {
        const latency = Date.now() - (response.received?.timestamp || Date.now());
        console.debug(`Heartbeat response received. Latency: ${latency}ms`);
    }
    
    // Heartbeat successful, connection is good
    connectionState.lastHeartbeatSuccess = Date.now();
}

/**
 * Start heartbeat to verify connection
 */
function startHeartbeat() {
    // Clear any existing interval
    if (connectionState.heartbeatInterval) {
        clearInterval(connectionState.heartbeatInterval);
    }
    
    // Start new interval
    connectionState.heartbeatInterval = setInterval(() => {
        if (!connectionState.socket || !connectionState.isConnected) {
            return;
        }
        
        // Send ping with timestamp
        connectionState.socket.emit('ping', { timestamp: Date.now() }, (response) => {
            if (response && response.pong) {
                // Connection is still good
                connectionState.lastHeartbeatSuccess = Date.now();
            } else {
                // No response, connection might be bad
                const timeSinceLastSuccess = Date.now() - (connectionState.lastHeartbeatSuccess || 0);
                
                if (timeSinceLastSuccess > 60000) { // 1 minute
                    console.warn('No heartbeat response for 1 minute, reconnecting socket');
                    
                    // Force reconnection
                    if (connectionState.socket) {
                        connectionState.socket.disconnect();
                        connectionState.socket.connect();
                    }
                }
            }
        });
    }, 30000); // 30 seconds
}

/**
 * Register event listener
 * @param {string} event - Event name
 * @param {Function} callback - Event callback
 */
function on(event, callback) {
    if (typeof callback !== 'function') {
        throw new Error('Callback must be a function');
    }
    
    // If this is the first listener for this event, initialize array
    if (!connectionState.eventListeners[event]) {
        connectionState.eventListeners[event] = [];
        
        // Also register on socket if it exists
        if (connectionState.socket) {
            connectionState.socket.on(event, (...args) => {
                emitEvent(event, ...args);
            });
        }
    }
    
    // Add to listeners
    connectionState.eventListeners[event].push(callback);
}

/**
 * Emit event to registered listeners
 * @param {string} event - Event name
 * @param {...any} args - Event arguments
 */
function emitEvent(event, ...args) {
    const listeners = connectionState.eventListeners[event] || [];
    
    listeners.forEach(listener => {
        try {
            listener(...args);
        } catch (error) {
            console.error(`Error in ${event} listener:`, error);
        }
    });
}

/**
 * Get connection state
 * @returns {Object} Connection state
 */
function getConnectionState() {
    return {
        isConnected: connectionState.isConnected,
        isConnecting: connectionState.isConnecting,
        reconnectAttempts: connectionState.reconnectAttempts,
        lastConnectedTime: connectionState.lastConnectedTime,
        queuedMessages: connectionState.messageQueue.length
    };
}

/**
 * Emit event to server
 * @param {string} event - Event name
 * @param {*} data - Event data
 * @param {Function} callback - Response callback
 * @returns {boolean} Success status
 */
function emit(event, data, callback) {
    // If socket is not initialized, queue the message
    if (!connectionState.socket || !connectionState.isConnected) {
        console.warn(`Socket not connected, queuing message: ${event}`);
        
        // Add to queue
        connectionState.messageQueue.push({
            event,
            data,
            callback
        });
        
        // If we're initializing, try to connect now
        if (!connectionState.socket) {
            initialize();
        }
        
        return false;
    }
    
    // Send message
    connectionState.socket.emit(event, data, callback);
    return true;
}

/**
 * Request system status
 */
function requestSystemStatus() {
    emit('get-system-status');
}

/**
 * Execute buy order
 * @param {string} symbol - Cryptocurrency symbol
 * @param {number} amount - Investment amount
 */
function executeBuyOrder(symbol, amount) {
    emit('first-purchase', { symbol, investment: amount });
}

/**
 * Execute sell order
 * @param {string} symbol - Cryptocurrency symbol
 */
function executeSellOrder(symbol) {
    emit('sell-all', { symbol });
}

/**
 * Test Binance WebSocket connection
 */
function testBinanceStream() {
    emit('test-binance-stream');
}

/**
 * Manually connect socket if disconnected
 * @returns {boolean} Whether connection attempt was made
 */
function connect() {
    if (connectionState.socket && !connectionState.isConnected && !connectionState.isConnecting) {
        console.log('Manually reconnecting socket.io');
        connectionState.socket.connect();
        return true;
    }
    return false;
}

/**
 * Manually disconnect socket
 * @returns {boolean} Whether disconnect was successful
 */
function disconnect() {
    if (connectionState.socket && connectionState.isConnected) {
        console.log('Manually disconnecting socket.io');
        connectionState.socket.disconnect();
        return true;
    }
    return false;
}

/**
 * Clean up resources
 */
function cleanup() {
    // Stop heartbeat
    if (connectionState.heartbeatInterval) {
        clearInterval(connectionState.heartbeatInterval);
        connectionState.heartbeatInterval = null;
    }
    
    // Disconnect socket
    if (connectionState.socket) {
        connectionState.socket.disconnect();
        connectionState.socket = null;
    }
    
    // Clear state
    connectionState.isConnected = false;
    connectionState.isConnecting = false;
    connectionState.eventListeners = {};
    connectionState.messageQueue = [];
    
    console.log('Socket.io connections cleaned up');
}

// Register cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Export public API using CommonJS syntax
module.exports = {
    initialize,
    on,
    emit,
    getConnectionState,
    requestSystemStatus,
    executeBuyOrder,
    executeSellOrder,
    testBinanceStream,
    connect,
    disconnect,
    cleanup,
    // For access in other modules
    socket: connectionState
};