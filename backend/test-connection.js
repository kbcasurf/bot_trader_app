// Backend test script for Binance WebSocket connection
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// Create a test server
const app = express();
const server = http.createServer(app);

// Configure CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Basic route for health check
app.get('/', (req, res) => {
    res.send('Binance WebSocket Test Server is running');
});

// Set up Socket.IO
const io = socketIO(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: false
    },
    transports: ['polling', 'websocket']
});

// Binance API config (load from env or use test values)
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const BASE_URL = process.env.BINANCE_API_URL; 
const WS_BASE_URL = process.env.BINANCE_WEBSOCKET_URL;

// Track WebSocket connections
const socketConnections = {};

// Import Socket.IO client for connecting to Binance
const { io: ioClient } = require('socket.io-client');

// Connection status tracking
let binanceConnected = false;

// Function to subscribe to ticker stream
function subscribeToTickerStream(symbols, callback) {
    const symbolsKey = symbols.join('-');
    
    // Use Socket.io client to connect to Binance WebSocket
    if (!socketConnections[symbolsKey]) {
        // Format symbols for stream
        const streams = symbols.map(symbol => `${symbol.toLowerCase()}@bookTicker`).join('/');
        const socketUrl = `${WS_BASE_URL}/stream?streams=${streams}`;
        
        console.log(`[TEST] Attempting to connect to Binance WebSocket for ${symbols.join(', ')}`);
        
        // We'll use a custom implementation with Socket.io client to connect to Binance WebSocket
        // and then forward the data to our Socket.io server
        const socket = ioClient(socketUrl, {
            transports: ['websocket'],
            forceNew: true,
            reconnection: true,
            reconnectionDelay: 5000,
            reconnectionAttempts: 10
        });
        
        socket.on('connect', () => {
            console.log(`[TEST] Socket.io client connected to Binance WebSocket for ${symbols.join(', ')}`);
            binanceConnected = true;
            
            // Emit a 'websocket-status' event when connected
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { connected: true, symbols });
            }
        });
        
        socket.on('message', (data) => {
            try {
                const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                if (parsedData.data) {
                    // If callback is a Socket.io socket, emit the data
                    if (typeof callback === 'object' && callback.emit) {
                        callback.emit('price-update', parsedData.data);
                    } 
                    // If callback is a function, call it with the data
                    else if (typeof callback === 'function') {
                        callback(parsedData.data);
                    }
                }
            } catch (error) {
                console.error('[TEST] Error handling WebSocket message:', error);
            }
        });
        
        socket.on('error', (error) => {
            console.error('[TEST] Socket.io client error:', error);
            binanceConnected = false;
            
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { connected: false, error: error.message, symbols });
            }
        });
        
        socket.on('disconnect', (reason) => {
            console.log(`[TEST] Socket.io client disconnected from Binance WebSocket for ${symbols.join(', ')}. Reason: ${reason}`);
            binanceConnected = false;
            
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { connected: false, symbols });
            }
            
            // Attempt to reconnect immediately, then on increasing delay if it continues to fail
            const attemptReconnect = () => {
                console.log(`[TEST] Attempting to reconnect to Binance WebSocket for ${symbols.join(', ')}`);
                
                // Remove the old connection before attempting to reconnect
                if (socketConnections[symbolsKey]) {
                    delete socketConnections[symbolsKey];
                }
                
                // Create a new connection
                const newSocket = subscribeToTickerStream(symbols, callback);
                socketConnections[symbolsKey] = newSocket;
            };
            
            // Attempt to reconnect after a delay
            setTimeout(attemptReconnect, 5000);
        });
        
        // Store connection reference
        socketConnections[symbolsKey] = socket;
    }
    
    return socketConnections[symbolsKey];
}

// Unsubscribe from ticker stream
function unsubscribeFromTickerStream(symbols) {
    const symbolsKey = symbols.join('-');
    const connection = socketConnections[symbolsKey];
    
    if (connection) {
        connection.disconnect();
        delete socketConnections[symbolsKey];
        console.log(`[TEST] Unsubscribed from ticker stream for ${symbols.join(', ')}`);
        return true;
    }
    
    return false;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('[TEST] Client connected to test server:', socket.id);
    
    // Send initial connection status
    socket.emit('connection-status', { 
        server: true,
        binance: binanceConnected
    });
    
    // Handle test Binance connection request
    socket.on('test-binance-connection', (data) => {
        console.log('[TEST] Testing Binance connection with symbols:', data.symbols);
        try {
            // Subscribe to ticker updates
            subscribeToTickerStream(data.symbols, socket);
            
            socket.emit('test-result', { 
                success: true, 
                message: 'Connection attempt initiated' 
            });
        } catch (err) {
            console.error('[TEST] Error initiating Binance connection:', err);
            socket.emit('test-result', { 
                success: false, 
                error: err.message 
            });
        }
    });
    
    // Handle manual disconnect request
    socket.on('disconnect-binance', (data) => {
        console.log('[TEST] Manually disconnecting from Binance for symbols:', data.symbols);
        
        const result = unsubscribeFromTickerStream(data.symbols);
        socket.emit('disconnect-result', {
            success: result,
            message: result 
                ? 'Successfully disconnected from Binance WebSocket' 
                : 'No active connection found to disconnect'
        });
    });
    
    // Forward WebSocket status updates to client
    socket.on('websocket-status', (status) => {
        console.log('[TEST] WebSocket status update:', status);
        io.emit('trading-status', { active: status.connected });
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('[TEST] Client disconnected from test server:', socket.id);
    });
});

// Start the server
const PORT = process.env.TEST_PORT || 3030;
server.listen(PORT, () => {
    console.log(`[TEST] Binance WebSocket test server running on port ${PORT}`);
});