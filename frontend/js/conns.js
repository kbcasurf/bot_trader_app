// frontend/js/conns.js
// Connection Management Module
// Handles WebSocket and HTTP connections to the backend

// Import socket.io client
import { io } from 'socket.io-client';

// Configuration for connections
const CONN_CONFIG = {
    // Connection settings
    SOCKET_URL: window.location.origin,
    SOCKET_OPTIONS: {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 10000,
        autoConnect: true,
        path: '/socket.io'
    },
    
    // Retry settings
    MAX_RECONNECT_ATTEMPTS: 5,
    RECONNECT_DELAY_MS: 3000
};

// Socket instance (will be initialized)
let socket = null;

// Connection state tracking
const connState = {
    isConnected: false,
    isConnecting: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    connectionListeners: []
};

/**
 * Initialize connection module
 * @returns {boolean} Whether initialization was successful
 */
function initialize() {
    // Check if already initialized
    if (socket) {
        console.warn('Connection already initialized');
        return true;
    }
    
    console.log('Initializing connections...');
    
    try {
        // Create socket instance
        socket = io(CONN_CONFIG.SOCKET_URL, CONN_CONFIG.SOCKET_OPTIONS);
        
        // Set up event handlers
        setupSocketEventHandlers();
        
        console.log('Connection initialized successfully');
        return true;
    } catch (error) {
        console.error('Error initializing connection:', error);
        return false;
    }
}

/**
 * Set up socket event handlers
 */
function setupSocketEventHandlers() {
    // Connection events
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('reconnect', handleReconnect);
    
    // Heartbeat/ping to keep connection alive
    socket.on('heartbeat', (data) => {
        // Respond to heartbeat to confirm client is alive
        socket.emit('pong', { received: data, timestamp: Date.now() });
    });
    
    // Add handler to window for cleanup on unload
    window.addEventListener('beforeunload', cleanup);
}

/**
 * Handle successful connection
 */
function handleConnect() {
    console.log('Socket connected successfully');
    
    // Update connection state
    connState.isConnected = true;
    connState.isConnecting = false;
    connState.reconnectAttempts = 0;
    
    // Clear any reconnect timer
    if (connState.reconnectTimer) {
        clearTimeout(connState.reconnectTimer);
        connState.reconnectTimer = null;
    }
    
    // Notify app initialization if not already done
    if (typeof window.appInitialized === 'function') {
        window.appInitialized();
    }
}

/**
 * Handle connection loss
 */
function handleDisconnect(reason) {
    console.warn('Socket disconnected:', reason);
    
    // Update connection state
    connState.isConnected = false;
    
    // Restart connection if not closing the page
    if (reason !== 'io client disconnect' && !connState.isConnecting) {
        attemptReconnection();
    }
}

/**
 * Handle connection error
 */
function handleConnectError(error) {
    console.error('Socket connection error:', error.message);
    
    // Update connection state
    connState.isConnected = false;
    
    // Restart connection if not already trying
    if (!connState.isConnecting) {
        attemptReconnection();
    }
    
    // If maximum attempts reached, notify app of initialization failure
    if (connState.reconnectAttempts >= CONN_CONFIG.MAX_RECONNECT_ATTEMPTS) {
        if (typeof window.appInitializationFailed === 'function') {
            window.appInitializationFailed('Unable to connect to server after multiple attempts');
        }
    }
}

/**
 * Handle successful reconnection
 */
function handleReconnect(attemptNumber) {
    console.log(`Socket reconnected after ${attemptNumber} attempts`);
    
    // Update connection state
    connState.isConnected = true;
    connState.isConnecting = false;
    connState.reconnectAttempts = 0;
    
    // Clear any reconnect timer
    if (connState.reconnectTimer) {
        clearTimeout(connState.reconnectTimer);
        connState.reconnectTimer = null;
    }
    
    // Request system status update
    requestSystemStatus();
}

/**
 * Attempt to reconnect to the server
 */
function attemptReconnection() {
    // Skip if already at max attempts
    if (connState.reconnectAttempts >= CONN_CONFIG.MAX_RECONNECT_ATTEMPTS) {
        console.error('Maximum reconnection attempts reached');
        return;
    }
    
    // Skip if already trying to reconnect
    if (connState.isConnecting) {
        return;
    }
    
    // Update state
    connState.isConnecting = true;
    connState.reconnectAttempts++;
    
    console.log(`Attempting to reconnect (${connState.reconnectAttempts}/${CONN_CONFIG.MAX_RECONNECT_ATTEMPTS})...`);
    
    // Set timer to reconnect
    connState.reconnectTimer = setTimeout(() => {
        // Skip if connection was restored in the meantime
        if (connState.isConnected) {
            connState.isConnecting = false;
            return;
        }
        
        // Try to reconnect
        if (socket) {
            try {
                socket.connect();
            } catch (error) {
                console.error('Error during reconnection attempt:', error);
                
                // If still not connected, try again
                if (!connState.isConnected) {
                    connState.isConnecting = false;
                    attemptReconnection();
                }
            }
        } else {
            // If socket was destroyed, reinitialize
            initialize();
        }
    }, CONN_CONFIG.RECONNECT_DELAY_MS);
}

/**
 * Register event handler for socket events
 * @param {string} event - Event name
 * @param {Function} handler - Event handler
 */
function on(event, handler) {
    if (socket) {
        socket.on(event, handler);
    } else {
        console.warn(`Cannot add listener for event "${event}": Socket not initialized`);
    }
}

/**
 * Remove event handler for socket events
 * @param {string} event - Event name
 * @param {Function} handler - Event handler to remove
 */
function off(event, handler) {
    if (socket) {
        socket.off(event, handler);
    }
}

/**
 * Send a message to the server
 * @param {string} event - Event name
 * @param {*} data - Event data
 * @param {Function} callback - Callback for acknowledgement
 */
function emit(event, data, callback) {
    if (socket && connState.isConnected) {
        socket.emit(event, data, callback);
    } else {
        console.warn(`Cannot emit event "${event}": Socket not connected`);
    }
}

/**
 * Request system status from the server
 */
function requestSystemStatus() {
    if (socket && connState.isConnected) {
        socket.emit('get-system-status');
    }
}

/**
 * Test Binance WebSocket connection
 */
function testBinanceStream() {
    if (socket && connState.isConnected) {
        socket.emit('test-binance-stream');
    } else {
        console.warn('Cannot test Binance stream: Socket not connected');
    }
}

/**
 * Execute buy order
 * @param {string} symbol - Cryptocurrency symbol
 * @param {number} amount - Investment amount in USDT
 */
function executeBuyOrder(symbol, amount) {
    if (socket && connState.isConnected) {
        socket.emit('first-purchase', {
            symbol: symbol.toUpperCase() + 'USDT',
            investment: amount
        });
    } else {
        console.warn('Cannot execute buy order: Socket not connected');
    }
}

/**
 * Execute sell order
 * @param {string} symbol - Cryptocurrency symbol
 */
function executeSellOrder(symbol) {
    if (socket && connState.isConnected) {
        socket.emit('sell-all', {
            symbol: symbol.toUpperCase() + 'USDT'
        });
    } else {
        console.warn('Cannot execute sell order: Socket not connected');
    }
}

/**
 * Clean up resources when page is unloaded
 */
function cleanup() {
    if (socket) {
        // Attempt clean disconnect
        socket.disconnect();
        socket = null;
    }
    
    // Clear any reconnect timer
    if (connState.reconnectTimer) {
        clearTimeout(connState.reconnectTimer);
        connState.reconnectTimer = null;
    }
    
    console.log('Connection resources cleaned up');
}

/**
 * Get current connection state
 * @returns {Object} Connection state
 */
function getConnectionState() {
    return {
        isConnected: connState.isConnected,
        isConnecting: connState.isConnecting,
        reconnectAttempts: connState.reconnectAttempts
    };
}

// Export public API
export {
    initialize,
    on,
    off,
    emit,
    requestSystemStatus,
    testBinanceStream,
    executeBuyOrder,
    executeSellOrder,
    getConnectionState,
    socket
};