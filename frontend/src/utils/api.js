import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Create axios instance with base configuration
const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// API utility functions
export const api = {
  // Trading pairs
  getTradingPairs: () => {
    return apiClient.get('/trading-pairs');
  },
  
  // Holdings
  getHoldings: (tradingPairId) => {
    return apiClient.get(`/holdings/${tradingPairId}`);
  },
  
  // Transactions
  getTransactions: (tradingPairId) => {
    return apiClient.get(`/transactions/${tradingPairId}`);
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
    return apiClient.get(`/prices/${symbol}`);
  },
  
  // Trading algorithm controls
  getTradingStatus: () => {
    return apiClient.get('/trading/status');
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
    return apiClient.get('/websocket/status');
  },
  
  restartWebSockets: () => {
    return apiClient.post('/websocket/restart');
  },
  
  // Telegram notifications
  sendTestNotification: (message) => {
    return apiClient.post('/telegram/test', { message });
  }
};