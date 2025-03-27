const crypto = require('crypto');
const axios = require('axios');
const querystring = require('querystring');
const logger = require('../utils/logger');

// Environment variables
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const BASE_URL = process.env.BINANCE_API_URL;
const RECV_WINDOW = process.env.BINANCE_RECV_WINDOW;

/**
 * Creates a signature for a request using HMAC SHA256
 * @param {string} queryString - The query string to sign
 * @returns {string} - The hexadecimal digest of the HMAC
 */
const createSignature = (queryString) => {
  return crypto
    .createHmac('sha256', API_SECRET)
    .update(queryString)
    .digest('hex');
};

/**
 * Adds timestamp and signature to parameters
 * @param {Object} params - The parameters to sign
 * @returns {Object} - The signed parameters
 */
const signRequest = (params = {}) => {
  // Add timestamp if not present
  if (!params.timestamp) {
    params.timestamp = Date.now();
  }
  
  // Add recvWindow if not present
  if (!params.recvWindow) {
    params.recvWindow = RECV_WINDOW;
  }
  
  // Convert params to query string
  const queryString = querystring.stringify(params);
  
  // Generate signature
  const signature = createSignature(queryString);
  
  // Add signature to params
  params.signature = signature;
  
  return params;
};

/**
 * Makes a secure API request to Binance
 * @param {string} method - The HTTP method
 * @param {string} endpoint - The API endpoint
 * @param {Object} params - The request parameters
 * @returns {Promise} - The request promise
 */
const makeRequest = async (method, endpoint, params = {}) => {
  // Determine if this is a secure endpoint
  const isSecureEndpoint = 
    endpoint.includes('/api/v3/account') || 
    endpoint.includes('/api/v3/order') ||
    endpoint.includes('/api/v3/myTrades');
  
  // For secure endpoints, sign the request
  const requestParams = isSecureEndpoint ? signRequest(params) : params;
  
  // Prepare headers
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  
  // Add API key header for secure endpoints
  if (isSecureEndpoint) {
    headers['X-MBX-APIKEY'] = API_KEY;
  }
  
  try {
    let response;
    const url = `${BASE_URL}${endpoint}`;
    
    // Make request based on method
    if (method === 'GET') {
      response = await axios.get(url, { 
        params: requestParams,
        headers 
      });
    } else if (method === 'POST') {
      response = await axios.post(url, querystring.stringify(requestParams), { headers });
    } else if (method === 'DELETE') {
      response = await axios.delete(url, { 
        params: requestParams,
        headers 
      });
    }
    
    return response.data;
  } catch (error) {
    // Handle specific Binance error codes
    if (error.response) {
      const { status, data } = error.response;
      
      if (status === 401) {
        logger.error('Binance API authentication error: Invalid API key');
      } else if (status === 403) {
        logger.error('Binance API authorization error: WAF limit violated');
      } else if (status === 418) {
        logger.error('Binance API IP auto-ban: Too many requests after 429');
      } else if (status === 429) {
        logger.error('Binance API rate limit exceeded', { 
          retryAfter: error.response.headers['retry-after'] 
        });
      }
      
      throw {
        status,
        code: data.code,
        message: data.msg,
        url: endpoint,
        params: requestParams
      };
    }
    
    throw error;
  }
};

// API methods
const binanceAPI = {
  // Market Data endpoints
  getExchangeInfo: () => makeRequest('GET', '/api/v3/exchangeInfo'),
  
  getTicker: (symbol) => makeRequest('GET', '/api/v3/ticker/price', { symbol }),
  
  getKlines: (symbol, interval, options = {}) => makeRequest(
    'GET', 
    '/api/v3/klines', 
    { symbol, interval, ...options }
  ),
  
  // Account endpoints (SIGNED)
  getAccountInfo: () => makeRequest('GET', '/api/v3/account'),
  
  // Order endpoints (SIGNED)
  createOrder: (orderParams) => makeRequest('POST', '/api/v3/order', orderParams),
  
  queryOrder: (symbol, orderId) => makeRequest(
    'GET', 
    '/api/v3/order', 
    { symbol, orderId }
  ),
  
  cancelOrder: (symbol, orderId) => makeRequest(
    'DELETE', 
    '/api/v3/order', 
    { symbol, orderId }
  ),
  
  getOpenOrders: (symbol) => makeRequest(
    'GET', 
    '/api/v3/openOrders', 
    symbol ? { symbol } : {}
  ),
  
  // Test functions
  testConnectivity: () => makeRequest('GET', '/api/v3/ping'),
  
  testOrder: (orderParams) => makeRequest('POST', '/api/v3/order/test', orderParams)
};

module.exports = binanceAPI;