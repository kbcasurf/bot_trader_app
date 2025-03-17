import axios from 'axios';

// Get API URL from environment variables or use default
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
console.log('Using API URL:', API_URL);

// WebSocket connection
let socket = null;
let isConnected = false;
let reconnectTimeout = null;

// Initialize WebSocket connection
export const initWebSocket = () => {
  if (socket) {
    socket.close();
  }
  
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.hostname}:4000/ws`;
  console.log('Connecting to WebSocket:', wsUrl);
  
  socket = new WebSocket(wsUrl);
  
  socket.onopen = () => {
    console.log('WebSocket connection established');
    isConnected = true;
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
    }, 3000);
  };
  
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
};

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Add request interceptor for logging
api.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('API Request Error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for logging
api.interceptors.response.use(
  (response) => {
    console.log('API Response:', response.status);
    return response;
  },
  (error) => {
    // Don't log aborted requests as errors - they're often just timeouts
    if (error.code === 'ECONNABORTED') {
      console.warn(`Request timeout for ${error.config?.url}`);
    } else {
      console.error('API Response Error:', error.response?.status, error.response?.data || error.message);
    }
    return Promise.reject(error);
  }
);

// Helper function to retry failed requests
const retryRequest = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    
    // Only retry on timeout or network errors
    if (error.code === 'ECONNABORTED' || error.message.includes('Network Error')) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryRequest(fn, retries - 1, delay);
    }
    
    throw error;
  }
};

export const fetchCryptoData = async (symbol) => {
  return retryRequest(async () => {
    try {
      const response = await api.get(`/api/binance/price/${symbol}`);
      return response.data;
    } catch (error) {
      // If we still get an error after retries, provide a fallback
      if (error.code === 'ECONNABORTED') {
        console.warn(`Using cached/fallback data for ${symbol} due to timeout`);
        return { symbol, price: '0.00', fallback: true };
      }
      throw error;
    }
  });
};

export const startTrading = async (symbol, amount) => {
  try {
    const response = await api.post('/api/binance/trade', { symbol, amount });
    return response.data;
  } catch (error) {
    console.error(`Error starting trade for ${symbol}:`, error);
    throw error;
  }
};

export const getSettings = async () => {
  try {
    const response = await api.get('/api/binance/settings');
    // Ensure we return an array
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.error('Error fetching settings:', error);
    // Return default settings as an array
    return [
      { setting_key: 'profit_threshold', value: '5' },
      { setting_key: 'loss_threshold', value: '5' },
      { setting_key: 'additional_purchase_amount', value: '50' },
      { setting_key: 'max_investment_per_symbol', value: '200' }
    ];
  }
};

export const updateSettings = async (settings) => {
  try {
    const response = await api.post('/api/binance/settings', settings);
    return response.data;
  } catch (error) {
    console.error('Error updating settings:', error);
    throw error;
  }
};

export const getActiveSessions = async () => {
  try {
    const response = await api.get('/api/binance/sessions');
    return response.data;
  } catch (error) {
    console.error('Error fetching active sessions:', error);
    throw error;
  }
};

// Add this function to your existing API service

export const sellAllCrypto = async (symbol) => {
  try {
    const response = await api.post(`/api/binance/session/sell-all`, { symbol });
    return response.data;
  } catch (error) {
    console.error(`Error selling all ${symbol}:`, error);
    throw error;
  }
};

export const startTrade = async (symbol, amount) => {
  try {
    const response = await axios.post('/api/binance/session/start', { symbol, amount });
    return response.data;
  } catch (error) {
    console.error('Error starting trade:', error);
    throw error;
  }
};

export default api;