// frontend/js/conns.js
// Socket Connection Module
// Handles WebSocket communication with the backend

import { io } from 'socket.io-client';

// Connection state
const state = {
    socket: null,
    isConnected: false,
    lastConnected: null,
    reconnectAttempts: 0,
    eventListeners: {},
    connectionListeners: [],
    pendingRequests: []
};

// Configuration
const CONFIG = {
    RECONNECT_ATTEMPTS: 10,
    RECONNECT_DELAY: 1000,
    RECONNECT_DELAY_MAX: 5000,
    TIMEOUT: 20000,
    HEARTBEAT_INTERVAL: 30000,
    DEBUG: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
};

/**
 * Initialize socket connection
 * @returns {boolean} Initialization status
 */
function initialize() {
    console.log('Initializing socket connections module...');
    
    if (state.socket) {
        console.warn('Socket connection already initialized');
        return true;
    }
    
    try {
        // Create socket connection
        const socket = io({
            reconnection: true,
            reconnectionAttempts: CONFIG.RECONNECT_ATTEMPTS,
            reconnectionDelay: CONFIG.RECONNECT_DELAY,
            reconnectionDelayMax: CONFIG.RECONNECT_DELAY_MAX,
            timeout: CONFIG.TIMEOUT,
            autoConnect: true
        });
        
        // Store socket instance
        state.socket = socket;
        
        // Set up event handlers
        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);
        socket.on('connect_error', handleConnectError);
        socket.on('error', handleError);
        
        // Set up heartbeat for connection monitoring
        setupHeartbeat();
        
        console.log('Socket connections module initialized');
        return true;
    } catch (error) {
        console.error('Error initializing socket connections:', error);
        return false;
    }
}

/**
 * Handle socket connection event
 */
function handleConnect() {
    console.log('Connected to server');
    state.isConnected = true;
    state.lastConnected = Date.now();
    state.reconnectAttempts = 0;
    
    // Notify connection listeners
    state.connectionListeners.forEach(callback => {
        try {
            callback(true);
        } catch (error) {
            console.error('Error in connection listener:', error);
        }
    });
    
    // Process any pending requests
    if (state.pendingRequests.length > 0) {
        console.log(`Processing ${state.pendingRequests.length} pending requests`);
        
        // Copy and clear pending requests
        const requests = [...state.pendingRequests];
        state.pendingRequests = [];
        
        // Execute each request
        requests.forEach(req => {
            emit(req.event, req.data, req.callback);
        });
    }
    
    // Request initial system status
    requestSystemStatus();
}

/**
 * Handle socket disconnect event
 * @param {string} reason - Disconnect reason
 */
function handleDisconnect(reason) {
    console.log('Disconnected from server:', reason);
    state.isConnected = false;
    
    // Notify connection listeners
    state.connectionListeners.forEach(callback => {
        try {
            callback(false, reason);
        } catch (error) {
            console.error('Error in connection listener:', error);
        }
    });
}

/**
 * Handle connection error
 * @param {Error} error - Connection error
 */
function handleConnectError(error) {
    console.error('Connection error:', error);
    state.reconnectAttempts++;
    
    // Log for debugging
    if (CONFIG.DEBUG) {
        console.log(`Reconnect attempt ${state.reconnectAttempts}/${CONFIG.RECONNECT_ATTEMPTS}`);
    }
}

/**
 * Handle general socket error
 * @param {Error} error - Socket error
 */
function handleError(error) {
    console.error('Socket error:', error);
}

/**
 * Set up heartbeat to ensure connection stays alive
 */
function setupHeartbeat() {
    setInterval(() => {
        if (state.isConnected) {
            emit('ping', { timestamp: Date.now() }, (response) => {
                // Log response in debug mode
                if (CONFIG.DEBUG && response) {
                    console.log('Heartbeat response:', response);
                }
            });
        }
    }, CONFIG.HEARTBEAT_INTERVAL);
}

/**
 * Register event listener
 * @param {string} event - Event name
 * @param {Function} callback - Callback function
 */
function on(event, callback) {
    if (!event || typeof callback !== 'function') {
        console.error('Invalid event registration parameters');
        return;
    }
    
    // Register with socket.io
    if (state.socket) {
        state.socket.on(event, callback);
    }
    
    // Store in event listeners for reconnection
    if (!state.eventListeners[event]) {
        state.eventListeners[event] = [];
    }
    
    state.eventListeners[event].push(callback);
}

/**
 * Register one-time event listener
 * @param {string} event - Event name
 * @param {Function} callback - Callback function
 */
function once(event, callback) {
    if (!event || typeof callback !== 'function') {
        console.error('Invalid event registration parameters');
        return;
    }
    
    // Register with socket.io
    if (state.socket) {
        state.socket.once(event, callback);
    }
}

/**
 * Remove event listener
 * @param {string} event - Event name
 * @param {Function} callback - Callback function (optional, removes all if not provided)
 */
function off(event, callback) {
    if (!event) {
        console.error('Event name is required');
        return;
    }
    
    // Remove from socket.io
    if (state.socket) {
        if (callback) {
            state.socket.off(event, callback);
        } else {
            state.socket.off(event);
        }
    }
    
    // Remove from event listeners
    if (state.eventListeners[event]) {
        if (callback) {
            state.eventListeners[event] = state.eventListeners[event].filter(cb => cb !== callback);
        } else {
            delete state.eventListeners[event];
        }
    }
}

/**
 * Send event to server
 * @param {string} event - Event name
 * @param {*} data - Event data
 * @param {Function} callback - Optional callback
 */
function emit(event, data, callback) {
    if (!event) {
        console.error('Event name is required');
        return;
    }
    
    // If not connected, queue for later
    if (!state.isConnected || !state.socket) {
        console.warn(`Not connected, queuing '${event}' event for later`);
        state.pendingRequests.push({ event, data, callback });
        return;
    }
    
    // Send via socket.io
    if (callback) {
        state.socket.emit(event, data, callback);
    } else {
        state.socket.emit(event, data);
    }
}

/**
 * Register connection status listener
 * @param {Function} callback - Callback function(isConnected, reason)
 */
function onConnectionChange(callback) {
    if (typeof callback !== 'function') {
        console.error('Callback must be a function');
        return;
    }
    
    state.connectionListeners.push(callback);
    
    // Immediately call with current status
    callback(state.isConnected);
}

/**
 * Request system status from server
 */
function requestSystemStatus() {
    emit('get-system-status');
}

/**
 * Check if socket is connected
 * @returns {boolean} Connection status
 */
function isConnected() {
    return state.isConnected;
}

/**
 * Get current connection state
 * @returns {Object} Connection state object
 */
function getConnectionState() {
    return {
        isConnected: state.isConnected,
        lastConnected: state.lastConnected,
        reconnectAttempts: state.reconnectAttempts,
        pendingRequests: state.pendingRequests.length
    };
}

/**
 * Force reconnection attempt
 */
function reconnect() {
    if (state.socket) {
        if (!state.isConnected) {
            console.log('Attempting to reconnect...');
            state.socket.connect();
        } else {
            console.log('Already connected');
        }
    } else {
        console.warn('Socket not initialized, initializing now...');
        initialize();
    }
}

/**
 * Clean up resources
 */
function cleanup() {
    if (state.socket) {
        // Remove all listeners and disconnect
        state.socket.offAny();
        state.socket.disconnect();
        state.socket = null;
    }
    
    // Reset state
    state.isConnected = false;
    state.eventListeners = {};
    state.connectionListeners = [];
    
    console.log('Connections module cleaned up');
}

// Export all functions that are referenced in other files
export {
    initialize,
    on,
    once,
    off,
    emit,
    onConnectionChange,
    requestSystemStatus,
    isConnected,
    getConnectionState,
    reconnect,
    cleanup
};