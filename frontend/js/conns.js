// conns.js - Connection Management Module
// Responsible for backend communication, WebSocket connections and data flow

// Import socket.io client
import { io } from 'socket.io-client';

// We won't import Dashboard directly to avoid circular dependencies
// Instead, we'll use callback functions that Dashboard will register

// Self-initialization when script is loaded
let isInitialized = false;

// Auto-initialize after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Short delay to ensure all HTML elements are rendered
    setTimeout(() => {
        // Only initialize once
        if (!isInitialized) {
            initialize();
            isInitialized = true;
            console.log('Connection module auto-initialized');
        }
    }, 500);
});

// Create and configure socket connection
const socket = io({
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 15,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 60000,
    autoConnect: true,
    forceNew: true
});

// Event callbacks registry - this allows dashboard.js to register callbacks
const eventCallbacks = {
    // Connection events
    'connect': [],
    'disconnect': [],
    'connect_error': [],
    
    // Status events
    'database-status': [],
    'binance-status': [],
    'telegram-status': [],
    'trading-status': [],
    'websocket-status': [],
    
    // Data events
    'price-update': [],
    'transaction-update': [],
    'holdings-update': [],
    'account-info': [],
    
    // Order result events
    'buy-result': [],
    'sell-result': [],
    'first-purchase-result': [],
    'sell-all-result': []
};

// System status tracking
const systemStatus = {
    backend: false,
    database: false,
    binance: false,
    telegram: false,
    websocket: false,
    lastBackendResponse: Date.now(),
    reconnectAttempts: 0,
    lastPriceUpdates: {
        btc: 0,
        sol: 0,
        xrp: 0,
        doge: 0,
        near: 0,
        pendle: 0
    }
};

// Interval references for monitoring
let connectionMonitorInterval = null;
let priceMonitorInterval = null;
let reconnectTimeout = null;

// Initialize monitoring of connections and price updates
function initializeMonitoring() {
    // Clear any existing intervals first
    if (connectionMonitorInterval) clearInterval(connectionMonitorInterval);
    if (priceMonitorInterval) clearInterval(priceMonitorInterval);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    
    // Monitor backend connection health every 10 seconds
    connectionMonitorInterval = setInterval(() => {
        const now = Date.now();
        const timeSinceLastResponse = now - systemStatus.lastBackendResponse;
        
        // If no response for 10 seconds, backend might be disconnected
        if (timeSinceLastResponse > 10000) {
            console.warn('No backend response for 10 seconds');
            
            // If socket claims to be connected, test with a ping
            if (socket.connected) {
                console.log('Testing connection with ping...');
                socket.emit('ping', { timestamp: Date.now() }, (response) => {
                    if (response && response.pong) {
                        console.log('Ping successful, connection is alive');
                        systemStatus.lastBackendResponse = Date.now();
                        updateConnectionStatus(true);
                    } else {
                        console.error('Ping failed, trying to reconnect');
                        socket.disconnect();
                        scheduleReconnect();
                    }
                });
                
                // Give it 5 seconds to respond
                setTimeout(() => {
                    const newTimeSinceResponse = Date.now() - systemStatus.lastBackendResponse;
                    if (newTimeSinceResponse > 15000) {
                        console.error('Connection test failed - marking backend as disconnected');
                        updateConnectionStatus(false);
                        socket.disconnect();
                        scheduleReconnect();
                    }
                }, 5000);
            } else {
                // Socket knows it's disconnected, try to reconnect
                scheduleReconnect();
            }
        }
    }, 10000);
    
    // Monitor price updates every 5 seconds
    priceMonitorInterval = setInterval(() => {
        const now = Date.now();
        let anyRecentPriceUpdates = false;
        
        // Check if any cryptocurrency has received a price update in the last 20 seconds
        Object.values(systemStatus.lastPriceUpdates).forEach(timestamp => {
            if (timestamp > 0 && now - timestamp < 20000) {
                anyRecentPriceUpdates = true;
            }
        });
        
        // Update the websocket status based on recent price updates
        if (systemStatus.websocket !== anyRecentPriceUpdates) {
            systemStatus.websocket = anyRecentPriceUpdates;
            
            // Log the status change
            console.log(`WebSocket price flow status changed: ${anyRecentPriceUpdates ? 'ACTIVE' : 'INACTIVE'}`);
            
            // Notify any registered callbacks
            triggerCallbacks('websocket-status', { connected: anyRecentPriceUpdates });
        }
    }, 5000);
}

// Schedule a reconnection attempt with exponential backoff
function scheduleReconnect() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    
    // Calculate backoff delay
    const baseDelay = 2000; // 2 seconds base
    const maxDelay = 60000; // Maximum 60 seconds
    systemStatus.reconnectAttempts += 1;
    
    // Calculate delay with exponential backoff and some randomization
    let delay = Math.min(baseDelay * Math.pow(1.5, Math.min(systemStatus.reconnectAttempts, 10)), maxDelay);
    delay = delay * (0.8 + Math.random() * 0.4); // Add 20% randomization
    
    console.log(`Scheduling reconnection attempt ${systemStatus.reconnectAttempts} in ${Math.round(delay / 1000)} seconds`);
    
    reconnectTimeout = setTimeout(() => {
        console.log('Attempting to reconnect...');
        
        // If reconnect succeeds, this will trigger the 'connect' event
        // which will reset reconnectAttempts
        if (socket.disconnected) {
            try {
                socket.connect();
            } catch (error) {
                console.error('Error during reconnect attempt:', error);
                scheduleReconnect(); // Try again
            }
        }
    }, delay);
}

// Update connection status
function updateConnectionStatus(isConnected) {
    // Update system status
    systemStatus.backend = isConnected;
    systemStatus.lastBackendResponse = Date.now();
    
    // If backend disconnects, all other services should be marked as disconnected
    if (!isConnected) {
        systemStatus.database = false;
        systemStatus.binance = false;
        systemStatus.telegram = false;
        systemStatus.websocket = false;
        
        // Notify callbacks of all services being disconnected
        triggerCallbacks('database-status', false);
        triggerCallbacks('binance-status', false);
        triggerCallbacks('telegram-status', false);
        triggerCallbacks('websocket-status', { connected: false });
    }
    
    // Notify any registered connect/disconnect callbacks
    if (isConnected) {
        triggerCallbacks('connect');
    } else {
        triggerCallbacks('disconnect', 'Backend connection lost');
    }
}

// Helper function to trigger event callbacks
function triggerCallbacks(event, data) {
    if (eventCallbacks[event]) {
        eventCallbacks[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in ${event} callback:`, error);
            }
        });
    }
}

// Register a callback for an event
function on(event, callback) {
    if (eventCallbacks[event]) {
        eventCallbacks[event].push(callback);
    } else {
        console.warn(`Unknown event: ${event}`);
    }
}

// Remove a callback for an event
function off(event, callback) {
    if (eventCallbacks[event]) {
        const index = eventCallbacks[event].indexOf(callback);
        if (index !== -1) {
            eventCallbacks[event].splice(index, 1);
        }
    }
}

// Request system status from the backend
function requestSystemStatus() {
    socket.emit('get-system-status');
}

// Request transactions for a specific symbol
function requestTransactions(symbol) {
    // Ensure symbol is properly formatted for Binance API (uppercase)
    const formattedSymbol = formatSymbol(symbol);
    socket.emit('get-transactions', { symbol: formattedSymbol });
}

// Request account info
function requestAccountInfo() {
    socket.emit('get-account-info');
}

// Test Binance stream
function testBinanceStream() {
    socket.emit('test-binance-stream');
}

// Execute buy order
function executeBuyOrder(symbol, amount) {
    // Ensure symbol is properly formatted for Binance API (uppercase)
    const formattedSymbol = formatSymbol(symbol);
    socket.emit('first-purchase', {
        symbol: formattedSymbol,
        investment: amount
    });
}

// Execute sell order
function executeSellOrder(symbol) {
    // Ensure symbol is properly formatted for Binance API (uppercase)
    const formattedSymbol = formatSymbol(symbol);
    socket.emit('sell-all', {
        symbol: formattedSymbol
    });
}

// Helper function to ensure proper symbol format for Binance API
function formatSymbol(symbol) {
    // Extract base symbol without USDT
    let baseSymbol = symbol;
    if (symbol.toUpperCase().endsWith('USDT')) {
        baseSymbol = symbol.slice(0, -4);
    }
    
    // Return in proper format: uppercase base symbol + uppercase USDT
    return baseSymbol.toUpperCase() + 'USDT';
}

// Function to get current system status
function getSystemStatus() {
    return { ...systemStatus };
}

// Initialize socket event listeners
function initializeSocketListeners() {
    // Socket connection events
    socket.on('connect', () => {
        console.log('Socket connected successfully with ID:', socket.id);
        
        // Reset reconnect counter
        systemStatus.reconnectAttempts = 0;
        
        // Mark response received
        systemStatus.lastBackendResponse = Date.now();
        
        // Request system status
        requestSystemStatus();
        
        // Trigger any registered connect callbacks
        triggerCallbacks('connect');
        
        // Update connection status
        updateConnectionStatus(true);
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Socket disconnected. Reason:', reason);
        
        // Update system status
        updateConnectionStatus(false);
        
        // Schedule reconnection
        scheduleReconnect();
        
        // Trigger any registered disconnect callbacks
        triggerCallbacks('disconnect', reason);
    });
    
    socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error.message);
        
        // Update system status
        updateConnectionStatus(false);
        
        // Trigger any registered connect_error callbacks
        triggerCallbacks('connect_error', error);
        
        // Try to reconnect with polling if WebSocket fails
        if (socket.io.opts.transports[0] === 'websocket') {
            console.log('WebSocket connection failed, falling back to polling');
            socket.io.opts.transports = ['polling', 'websocket'];
            
            // Schedule reconnection
            scheduleReconnect();
        }
    });
    
    // Backend service status events
    socket.on('database-status', (isConnected) => {
        systemStatus.database = isConnected;
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('database-status', isConnected);
    });
    
    socket.on('binance-status', (isConnected) => {
        systemStatus.binance = isConnected;
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('binance-status', isConnected);
    });
    
    socket.on('telegram-status', (isConnected) => {
        systemStatus.telegram = isConnected;
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('telegram-status', isConnected);
    });
    
    socket.on('trading-status', (status) => {
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('trading-status', status);
    });
    
    socket.on('websocket-status', (status) => {
        systemStatus.websocket = status.connected || false;
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('websocket-status', status);
    });
    
    // Price updates
    socket.on('price-update', (data) => {
        if (!data) {
            console.warn('Received empty price update data');
            return;
        }
        
        // Handle different possible symbol formats
        let symbol = '';
        let price = 0;
        
        if (data.symbol) {
            symbol = data.symbol;
        } else if (data.s) {
            symbol = data.s;
        } else {
            console.warn('Price update missing symbol:', data);
            return;
        }
        
        if (data.price) {
            price = data.price;
        } else if (data.p) {
            price = data.p;
        } else if (data.a) {
            price = data.a; // Use ask price from bookTicker
        } else if (data.b) {
            price = data.b; // Use bid price from bookTicker
        } else if (data.c) {
            price = data.c; // Use close price from ticker
        } else {
            console.warn('Price update missing price value:', data);
            return;
        }
        
        // Normalize symbol format (remove USDT if it exists)
        const baseSymbol = symbol.replace('USDT', '').toLowerCase();
        
        // Track this price update time
        if (systemStatus.lastPriceUpdates.hasOwnProperty(baseSymbol)) {
            systemStatus.lastPriceUpdates[baseSymbol] = Date.now();
            
            // Make sure websocket status is true when receiving price updates
            if (!systemStatus.websocket) {
                systemStatus.websocket = true;
                triggerCallbacks('websocket-status', { connected: true });
            }
        }
        
        // Ensure backend is marked as connected when we get price updates
        if (!systemStatus.backend) {
            updateConnectionStatus(true);
        }
        
        // Mark response received
        systemStatus.lastBackendResponse = Date.now();
        
        // Trigger price update callbacks
        triggerCallbacks('price-update', {
            symbol: baseSymbol,
            price: parseFloat(price)
        });
    });
    
    // Account info
    socket.on('account-info', (accountInfo) => {
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('account-info', accountInfo);
    });
    
    // Transaction updates
    socket.on('transaction-update', (data) => {
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('transaction-update', data);
    });
    
    // Holdings updates
    socket.on('holdings-update', (data) => {
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('holdings-update', data);
    });
    
    // Order results
    socket.on('buy-result', (result) => {
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('buy-result', result);
        
        // Request updated account info if successful
        if (result.success) {
            requestAccountInfo();
        }
    });
    
    socket.on('sell-result', (result) => {
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('sell-result', result);
        
        // Request updated account info if successful
        if (result.success) {
            requestAccountInfo();
        }
    });
    
    socket.on('first-purchase-result', (result) => {
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('first-purchase-result', result);
    });
    
    socket.on('sell-all-result', (result) => {
        systemStatus.lastBackendResponse = Date.now();
        triggerCallbacks('sell-all-result', result);
    });
    
    // Ping/pong for connection health check
    socket.on('pong', (data) => {
        systemStatus.lastBackendResponse = Date.now();
        console.log('Received pong response:', data);
    });
    
    // Heartbeat events to keep connection alive
    socket.on('heartbeat', () => {
        systemStatus.lastBackendResponse = Date.now();
    });
    
    // Any other events from server
    socket.onAny((eventName) => {
        systemStatus.lastBackendResponse = Date.now();
    });
}

// Initialize the connection module
function initialize() {
    initializeSocketListeners();
    initializeMonitoring();
    console.log('Connection module initialized');
}

// Export public API
export {
    initialize,
    on,
    off,
    socket,
    requestSystemStatus,
    requestTransactions,
    requestAccountInfo,
    executeBuyOrder,
    executeSellOrder,
    testBinanceStream,
    getSystemStatus
};