// WebSocket service for real-time price updates
let socket = null;
let isConnected = false;
let reconnectTimeout = null;
const reconnectDelay = 3000; // 3 seconds

// Initialize WebSocket connection
export const initWebSocket = () => {
  if (socket) {
    socket.close();
  }
  
  const wsUrl = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:4000`;
  console.log('Connecting to WebSocket:', wsUrl);
  
  socket = new WebSocket(wsUrl);
  
  socket.onopen = () => {
    console.log('WebSocket connection established');
    isConnected = true;
    
    // Clear any reconnect timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };
  
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'price') {
        // Dispatch custom event for components to listen to
        window.dispatchEvent(new CustomEvent('PRICE_UPDATE', {
          detail: {
            symbol: data.symbol,
            price: data.price
          }
        }));
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  };
  
  socket.onclose = () => {
    console.log('WebSocket connection closed');
    isConnected = false;
    
    // Attempt to reconnect after delay
    reconnectTimeout = setTimeout(() => {
      console.log('Attempting to reconnect WebSocket...');
      initWebSocket();
    }, reconnectDelay);
  };
  
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
};

// Check if WebSocket is connected
export const isWebSocketConnected = () => isConnected;

// Close WebSocket connection
export const closeWebSocket = () => {
  if (socket) {
    socket.close();
    socket = null;
  }
  
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  isConnected = false;
};