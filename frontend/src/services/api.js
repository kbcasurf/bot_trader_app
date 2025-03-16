import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
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
    console.log('API Response:', response.status, response.data);
    return response;
  },
  (error) => {
    console.error('API Response Error:', error.response?.status, error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export const fetchCryptoData = async (symbol) => {
  try {
    const response = await api.get(`/api/binance/price/${symbol}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching data for ${symbol}:`, error);
    throw error;
  }
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
    return response.data;
  } catch (error) {
    console.error('Error fetching settings:', error);
    throw error;
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

export default api;