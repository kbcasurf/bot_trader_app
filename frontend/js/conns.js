// frontend/js/conns.js
// Socket.IO connection module
// Handles communication with the backend server

// Module state
const connectionState = {
  socket: null,
  isConnected: false,
  eventHandlers: new Map(), // Event name -> handlers array
  queuedMessages: [] // Messages queued while disconnected
};

/**
 * Initialize socket connection to the backend
 * @returns {Object} Socket.io instance
 */
function initialize() {
  // If already initialized, return existing socket
  if (connectionState.socket) {
    return connectionState.socket;
  }
  
  // Use configured backend URL if available, otherwise fallback to origin
  const backendUrl = import.meta.env.VITE_BACKEND_URL || window.location.origin;
  console.log('Connecting to backend WebSocket at:', backendUrl);
  
  // Create socket connection
  connectionState.socket = io(backendUrl, {
    reconnectionDelayMax: 10000,
    transports: ['websocket', 'polling'], // Allow fallback to polling if WebSocket fails
    path: '/socket.io'
  });
  
  // Set up event handlers
  connectionState.socket.on('connect', () => {
    console.log('Socket.io connected to backend');
    connectionState.isConnected = true;
    
    // Emit any queued messages
    while (connectionState.queuedMessages.length > 0) {
      const { event, data } = connectionState.queuedMessages.shift();
      connectionState.socket.emit(event, data);
    }
    
    // Notify connection handlers
    notifyEventHandlers('connection', true);
  });
  
  connectionState.socket.on('disconnect', () => {
    console.log('Socket.io disconnected from backend');
    connectionState.isConnected = false;
    
    // Notify connection handlers
    notifyEventHandlers('connection', false);
  });
  
  connectionState.socket.on('connect_error', (error) => {
    console.error('Socket.io connection error:', error);
    connectionState.isConnected = false;
    
    // Notify connection handlers
    notifyEventHandlers('connection', false);
  });
  
  return connectionState.socket;
}

/**
 * Get the socket.io instance
 * @returns {Object} Socket.io instance
 */
function getSocket() {
  // Initialize if not initialized
  if (!connectionState.socket) {
    return initialize();
  }
  return connectionState.socket;
}

/**
 * Check if the socket is connected
 * @returns {boolean} True if connected
 */
function isConnected() {
  return connectionState.isConnected;
}

/**
 * Get the connection state information
 * @returns {Object} Connection state
 */
function getConnectionState() {
  return { 
    isConnected: connectionState.isConnected,
    socket: connectionState.socket !== null
  };
}

/**
 * Register an event handler
 * @param {string} event - The event name
 * @param {Function} handler - The event handler
 */
function on(event, handler) {
  if (typeof handler !== 'function') {
    console.warn('Invalid handler provided for event:', event);
    return;
  }
  
  // Create handlers array if it doesn't exist
  if (!connectionState.eventHandlers.has(event)) {
    connectionState.eventHandlers.set(event, []);
  }
  
  // Add handler to array
  connectionState.eventHandlers.get(event).push(handler);
  
  // Register handler with socket.io if socket exists
  if (connectionState.socket) {
    connectionState.socket.on(event, handler);
  }
}

/**
 * Remove an event handler
 * @param {string} event - The event name
 * @param {Function} handler - The event handler
 */
function off(event, handler) {
  if (!connectionState.eventHandlers.has(event)) {
    return;
  }
  
  const handlers = connectionState.eventHandlers.get(event);
  const index = handlers.indexOf(handler);
  
  if (index !== -1) {
    handlers.splice(index, 1);
  }
  
  // Remove handler from socket.io if socket exists
  if (connectionState.socket) {
    connectionState.socket.off(event, handler);
  }
}

/**
 * Emit an event to the server
 * @param {string} event - The event name
 * @param {any} data - The event data
 */
function emit(event, data) {
  // Initialize if not initialized
  if (!connectionState.socket) {
    initialize();
  }
  
  // If not connected, queue the message
  if (!connectionState.isConnected) {
    connectionState.queuedMessages.push({ event, data });
    return;
  }
  
  // Emit the event
  connectionState.socket.emit(event, data);
}

/**
 * Request system status from the server
 */
function requestSystemStatus() {
  emit('get-system-status');
}

/**
 * Notify handlers for a given event
 * @param {string} event - The event name
 * @param {any} data - The event data
 */
function notifyEventHandlers(event, data) {
  if (!connectionState.eventHandlers.has(event)) {
    return;
  }
  
  // Call all registered handlers
  connectionState.eventHandlers.get(event).forEach(handler => {
    try {
      handler(data);
    } catch (error) {
      console.error(`Error in ${event} handler:`, error);
    }
  });
}

// Initialize the socket connection when this module is imported
initialize();

// Export public API
export {
  initialize,
  getSocket,
  isConnected,
  getConnectionState,
  on,
  off,
  emit,
  requestSystemStatus
};