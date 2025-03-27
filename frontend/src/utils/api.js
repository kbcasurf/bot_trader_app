import axios from 'axios';

// Get API URL from environment variables or use default fallback
const API_URL = import.meta.env.VITE_API_URL;

// Create axios instance with base configuration
const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Add request interceptor for logging
apiClient.interceptors.request.use(
  config => {
    console.log(`API Request: ${config.method.toUpperCase()} ${config.url}`);
    return config;
  },
  error => {
    console.error('API Request Error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for handling errors
apiClient.interceptors.response.use(
  response => {
    // Log successful responses if needed
    if (import.meta.env.DEV) {
      console.log(`API Response (${response.status}):`, 
        response.config.url.includes('status') ? 'Status data...' : response.data);
    }
    return response;
  },
  error => {
    if (error.response) {
      // Server responded with an error status
      console.error(`API Error ${error.response.status}:`, error.response.data);
    } else if (error.request) {
      // Request was made but no response
      console.error('API No Response Error:', error.request);
    } else {
      // Something else happened
      console.error('API Error:', error.message);
    }
    return Promise.reject(error);
  }
);

/**
 * Retry a failed API call
 * @param {Function} apiCall - Function that returns a promise
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delay - Initial delay in milliseconds
 * @returns {Promise} - The API call result or error after retries
 */
const retryRequest = async (apiCall, maxRetries = 3, delay = 1000) => {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      return await apiCall();
    } catch (error) {
      retries++;
      if (retries >= maxRetries) {
        throw error;
      }
      console.log(`Retrying request (${retries}/${maxRetries}) after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      // Increase delay for next retry (exponential backoff)
      delay *= 2;
    }
  }
};

// API utility functions
export const api = {
  // Trading pairs
  getTradingPairs: () => {
    return retryRequest(() => apiClient.get('/trading-pairs'));
  },
  
  // Holdings
  getHoldings: (tradingPairId) => {
    return retryRequest(() => apiClient.get(`/holdings/${tradingPairId}`));
  },
  
  // Transactions
  getTransactions: (tradingPairId) => {
    return retryRequest(() => apiClient.get(`/transactions/${tradingPairId}`));
  },
  
  // Trading operations
  makeFirstPurchase: (tradingPairId, amount) => {
    return apiClient.post('/transactions/buy', {
      tradingPairId,
      amount
    });
  },
  
  sellAll: (tradingPairId) => {
    return apiClient.post('/transactions/sell-all', {
      tradingPairId
    });
  },
  
  // Price data
  getCurrentPrice: (symbol) => {
    return retryRequest(() => apiClient.get(`/prices/${symbol}`));
  },
  
  // Trading algorithm controls
  getTradingStatus: () => {
    return retryRequest(() => apiClient.get('/trading/status'));
  },
  
  startTrading: (tradingPairId, initialInvestment) => {
    return apiClient.post('/trading/start', {
      tradingPairId,
      initialInvestment
    });
  },
  
  stopTrading: (tradingPairId) => {
    return apiClient.post('/trading/stop', {
      tradingPairId
    });
  },
  
  // WebSocket management
  getWebSocketStatus: () => {
    return retryRequest(() => apiClient.get('/websocket/status'));
  },
  
  restartWebSockets: () => {
    return apiClient.post('/websocket/restart');
  },
  
  // Telegram notifications
  sendTestNotification: (message) => {
    return apiClient.post('/telegram/test', { message });
  },
  
  // General health check
  getHealth: () => {
    return apiClient.get('/health');
  },
  
  // System status
  getSystemStatus: () => {
    return retryRequest(() => apiClient.get('/status'));
  }
};