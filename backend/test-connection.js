// Save this as test-connection.js in the backend directory
const http = require('http');
const socketIo = require('socket.io');
const express = require('express');
const cors = require('cors');

// Create a simple Express app for testing
const app = express();
const server = http.createServer(app);

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Add a simple endpoint
app.get('/', (req, res) => {
    res.send('Backend is running!');
});

// Initialize Socket.IO
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: false
    },
    transports: ['websocket', 'polling']
});

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Send a test event
    socket.emit('test-event', { message: 'Connection successful!' });
    
    // Handle test event from client
    socket.on('test-request', (data) => {
        console.log('Received test request:', data);
        socket.emit('test-response', { 
            received: data,
            serverTime: new Date().toISOString() 
        });
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Start server
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Test server running on port ${PORT}`);
    console.log(`Socket.IO endpoint: http://0.0.0.0:${PORT}/socket.io/`);
});