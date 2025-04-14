// frontend/js/dashboard.js
// Dashboard Management Module
// Responsible for coordinating UI modules and managing overall application state

// Import modules
import * as Cards from './cards.js';
import * as Connections from './conns.js';

// Dashboard configuration
const DASHBOARD_CONFIG = {
  // Refresh intervals in milliseconds
  AUTO_REFRESH_INTERVAL: 30000,     // 30 seconds (reduced from 60000)
  STAGGERED_LOAD_DELAY: 100,        // 100ms between loading each card's data (reduced from 200)
  HISTORY_ITEMS_LIMIT: 10,          // Limit number of history items to load initially
  
  // Element selectors
  SELECTORS: {
    CRYPTO_GRID: '.crypto-grid',
    TEST_ACTIONS: '.test-actions',
    THEME_TOGGLE: '#theme-toggle',
    DEBUG_PANEL: '#debug-panel',
    TOGGLE_DEBUG: '#toggle-debug',
    WEBSOCKET_MONITOR: '#websocket-monitor'
  }
};

// Dashboard state
const dashboardState = {
  initialized: false,
  autoRefreshInterval: null,
  socket: null,
  darkMode: false,
  usdtBalance: 0,
  debug: false,
  serverStatus: {
    connected: false,
    binanceConnected: false,
    autoTradingEnabled: false
  }
};

/**
 * Initialize dashboard module
 * @returns {boolean} Initialization status
 */
function initialize() {
  console.log('Initializing dashboard...');
  
  if (dashboardState.initialized) {
    console.warn('Dashboard already initialized');
    return true;
  }
  
  try {
    // Initialize socket.io connection
    initializeSocketConnection();
    
    // Set up UI components
    setupUI();
    
    // Load initial data with a slight delay to ensure connections are established
    setTimeout(loadInitialData, 1000);
    
    // Set up auto-refresh
    setupAutoRefresh();
    
    // Set up theme toggle
    setupThemeToggle();
    
    // Set up debug panel if in development
    setupDebugPanel();
    
    // Set up notification system
    setupNotificationSystem();
    
    // Mark as initialized
    dashboardState.initialized = true;
    
    console.log('Dashboard initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing dashboard:', error);
    return false;
  }
}

/**
 * Initialize the Socket.IO connection to the backend
 */
function initializeSocketConnection() {
  // Determine the backend URL - use import.meta.env for Vite environment variables
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
  console.log('Connecting to backend WebSocket at:', backendUrl);
  
  // Create the Socket.IO connection with optimized parameters
  dashboardState.socket = io(backendUrl, {
    reconnectionDelayMax: 5000,     // Reduced from 10000 for faster reconnection
    reconnectionAttempts: 10,       // Limit reconnection attempts
    timeout: 10000,                 // Connection timeout in ms
    transports: ['websocket', 'polling'] // Add polling as fallback for better compatibility
  });
  
  // Initialize Cards module with socket connection
  Cards.initialize(dashboardState.socket);
  
  // Set up Socket.IO event handlers
  dashboardState.socket.on('connect', () => {
    console.log('Connected to backend server');
    updateConnectionStatus(true);
    
    // Request initial data after connection
    requestSystemStatus();
  });
  
  dashboardState.socket.on('disconnect', () => {
    console.log('Disconnected from backend server');
    updateConnectionStatus(false);
  });
  
  dashboardState.socket.on('system-status', (data) => {
    updateSystemStatus(data);
  });
  
  dashboardState.socket.on('binance-connection', (data) => {
    updateBinanceStatus(data.connected);
  });
  
  dashboardState.socket.on('account-info', (data) => {
    handleAccountInfoUpdate(data);
  });
  
  dashboardState.socket.on('auto-trading-status', (data) => {
    updateAutoTradingStatus(data.enabled);
    
    // Display error message if auto-trading failed to enable/disable
    if (data.error) {
      showNotification(`Auto-trading error: ${data.error}`, 'error');
    } else if (data.success) {
      showNotification(`Auto-trading ${data.enabled ? 'enabled' : 'disabled'} successfully`, 'success');
    }
  });
  
  // Listen for auto-trading execution events
  dashboardState.socket.on('auto-trading-executed', (data) => {
    const { symbol, action, price } = data;
    const formattedPrice = parseFloat(price).toFixed(2);
    
    // Show notification for auto-trading execution
    showNotification(`Auto-trading ${action.toUpperCase()} executed for ${symbol} at $${formattedPrice}`, 'success');
    
    // Show activity indicator briefly
    showAutoTradingActivity();
    
    // Request updated data with a short delay
    setTimeout(() => {
      requestAccountInfo();
      
      // Request data for all symbols to update UI
      const symbols = Cards.CARD_CONFIG.SUPPORTED_CRYPTOS.map(crypto => 
        `${crypto.symbol.toUpperCase()}USDT`
      );
      dashboardState.socket.emit('batch-get-data', { symbols });
    }, 2000);
  });
  
  // Custom event for auto-trading activity/checks
  dashboardState.socket.on('auto-trading-check', () => {
    // Show brief indicator that auto-trading check is occurring
    showAutoTradingActivity();
  });
}

/**
 * Set up UI components
 */
function setupUI() {
  // Get crypto grid element
  const cryptoGrid = document.querySelector(DASHBOARD_CONFIG.SELECTORS.CRYPTO_GRID);
  
  if (!cryptoGrid) {
    console.error('Crypto grid element not found');
    throw new Error('Crypto grid element not found');
  }
  
  // Create all crypto cards
  const cards = Cards.createAllCards();
  
  // Add all cards to the grid
  cards.forEach(card => {
    cryptoGrid.appendChild(card);
  });
  
  // Set up WebSocket monitor
  setupWebSocketMonitor();
  
  // Set up test action buttons if in development mode
  const isDevMode = window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1';
  
  if (isDevMode) {
    setupTestActions();
  }
  
  // Create and add USDT balance display
  setupUsdtBalanceDisplay();

  // Set up disclaimer modal events
  setupDisclaimerModal();
}

/**
 * Set up WebSocket connection monitor
 */
function setupWebSocketMonitor() {
  const monitorContainer = document.createElement('div');
  monitorContainer.id = 'websocket-monitor';
  monitorContainer.className = 'status-monitor';
  
  monitorContainer.innerHTML = `
    <div class="status-section">
      <div class="status-item">
        <span class="status-label">Server Connection:</span>
        <span class="status-indicator" id="server-status">Disconnected</span>
      </div>
      <div class="status-item">
        <span class="status-label">Binance API:</span>
        <span class="status-indicator" id="binance-status">Disconnected</span>
      </div>
      <div class="status-item">
        <span class="status-label">Auto-Trading:</span>
        <span class="status-indicator" id="auto-trading-status">Disabled</span>
        <button id="toggle-auto-trading" class="small-button">Enable</button>
        <span id="auto-trading-activity" class="activity-indicator" style="display: none;">⚡</span>
      </div>
    </div>
  `;
  
  // Add to page - add at the end of main container, before the disclaimer
  const mainContainer = document.querySelector('main') || document.body;
  const disclaimerLink = document.querySelector('.disclaimer-link');
  if (disclaimerLink) {
    mainContainer.insertBefore(monitorContainer, disclaimerLink);
  } else {
    mainContainer.appendChild(monitorContainer);
  }
  
  // Set up auto-trading toggle button
  const toggleButton = document.getElementById('toggle-auto-trading');
  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      const newStatus = !dashboardState.serverStatus.autoTradingEnabled;
      dashboardState.socket.emit('set-auto-trading', { enabled: newStatus });
    });
  }
}

/**
 * Update WebSocket connection status display
 * @param {boolean} connected - Whether the connection is established
 */
function updateConnectionStatus(connected) {
  const statusElement = document.getElementById('server-status');
  if (statusElement) {
    statusElement.textContent = connected ? 'Connected' : 'Disconnected';
    statusElement.className = connected ? 'status-indicator connected' : 'status-indicator disconnected';
  }
  
  dashboardState.serverStatus.connected = connected;
}

/**
 * Update Binance API connection status display
 * @param {boolean} connected - Whether the connection is established
 */
function updateBinanceStatus(connected) {
  const statusElement = document.getElementById('binance-status');
  if (statusElement) {
    statusElement.textContent = connected ? 'Connected' : 'Disconnected';
    statusElement.className = connected ? 'status-indicator connected' : 'status-indicator disconnected';
  }
  
  dashboardState.serverStatus.binanceConnected = connected;
}

/**
 * Update auto-trading status display
 * @param {boolean} enabled - Whether auto-trading is enabled
 */
function updateAutoTradingStatus(enabled) {
  const statusElement = document.getElementById('auto-trading-status');
  const toggleButton = document.getElementById('toggle-auto-trading');
  
  if (statusElement) {
    statusElement.textContent = enabled ? 'Enabled' : 'Disabled';
    statusElement.className = enabled ? 'status-indicator enabled' : 'status-indicator disabled';
  }
  
  if (toggleButton) {
    toggleButton.textContent = enabled ? 'Disable' : 'Enable';
  }
  
  dashboardState.serverStatus.autoTradingEnabled = enabled;
}

/**
 * Show auto-trading activity indicator briefly
 * Used to indicate when auto-trading checks or executions are happening
 */
function showAutoTradingActivity() {
  const activityIndicator = document.getElementById('auto-trading-activity');
  if (activityIndicator) {
    // Show the indicator
    activityIndicator.style.display = 'inline';
    
    // Hide after a short delay
    setTimeout(() => {
      activityIndicator.style.display = 'none';
    }, 2000); // Show for 2 seconds
  }
}

/**
 * Update system status information
 * @param {Object} statusData - System status data from the server
 */
function updateSystemStatus(statusData) {
  if (!statusData) return;
  
  // Update connection statuses
  updateConnectionStatus(true); // We received status, so we're connected
  updateBinanceStatus(statusData.binanceConnected);
  updateAutoTradingStatus(statusData.autoTradingEnabled);
}

/**
 * Set up disclaimer modal events
 */
function setupDisclaimerModal() {
  const showDisclaimer = document.getElementById('show-disclaimer');
  const disclaimerModal = document.getElementById('disclaimer-modal');
  const closeModal = document.querySelector('.close-modal');
  
  if (showDisclaimer && disclaimerModal && closeModal) {
    // Show modal when clicking disclaimer link
    showDisclaimer.addEventListener('click', (e) => {
      e.preventDefault();
      disclaimerModal.style.display = 'block';
    });
    
    // Close modal when clicking the X
    closeModal.addEventListener('click', () => {
      disclaimerModal.style.display = 'none';
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
      if (event.target === disclaimerModal) {
        disclaimerModal.style.display = 'none';
      }
    });
  }
}

/**
 * Set up test action buttons (development mode only)
 */
function setupTestActions() {
  // Create test actions section if it doesn't exist
  let testActions = document.querySelector(DASHBOARD_CONFIG.SELECTORS.TEST_ACTIONS);
  
  if (!testActions) {
    testActions = document.createElement('div');
    testActions.className = 'test-actions';
    
    testActions.innerHTML = `
      <div class="test-buttons">
        <h3>Development Tools</h3>
        <button id="test-connection" class="test-button">Test Server Connection</button>
        <button id="test-websocket" class="test-button">Test Binance Stream</button>
        <button id="refresh-data" class="test-button">Refresh All Data</button>
        <button id="toggle-debug" class="test-button">Toggle Debug Panel</button>
      </div>
    `;
    
    // Add to page
    const mainContainer = document.querySelector('main') || document.body;
    mainContainer.appendChild(testActions);
  }
  
  // Set up event handlers
  const testConnectionBtn = document.getElementById('test-connection');
  const testWebSocketBtn = document.getElementById('test-websocket');
  const refreshDataBtn = document.getElementById('refresh-data');
  const toggleDebugBtn = document.getElementById('toggle-debug');
  
  if (testConnectionBtn) {
    testConnectionBtn.addEventListener('click', () => {
      requestSystemStatus();
      showNotification('Requesting system status...', 'info');
    });
  }
  
  if (testWebSocketBtn) {
    testWebSocketBtn.addEventListener('click', () => {
      dashboardState.socket.emit('test-binance-stream');
      
      dashboardState.socket.once('binance-stream-test', (result) => {
        if (result.success) {
          const priceInfo = Object.entries(result.prices)
            .map(([symbol, price]) => `${symbol}: $${price.toFixed(2)}`)
            .join(', ');
          
          showNotification(`Binance stream test: ${result.connected ? 'Connected' : 'Disconnected'}\n${priceInfo}`, 'info');
        } else {
          showNotification(`Binance stream test failed: ${result.error}`, 'error');
        }
      });
    });
  }
  
  if (refreshDataBtn) {
    refreshDataBtn.addEventListener('click', () => {
      loadAllData();
      showNotification('Refreshing all data...', 'info');
    });
  }
  
  if (toggleDebugBtn) {
    toggleDebugBtn.addEventListener('click', () => {
      toggleDebugPanel();
    });
  }
}

/**
 * Set up debug panel
 */
function setupDebugPanel() {
  // Create debug panel if it doesn't exist
  let debugPanel = document.querySelector(DASHBOARD_CONFIG.SELECTORS.DEBUG_PANEL);
  
  if (!debugPanel) {
    debugPanel = document.createElement('div');
    debugPanel.id = 'debug-panel';
    debugPanel.className = 'debug-panel';
    debugPanel.style.display = 'none';
    
    debugPanel.innerHTML = `
      <h3>Debug Information</h3>
      <div id="debug-content" class="debug-content"></div>
    `;
    
    // Add to page
    document.body.appendChild(debugPanel);
  }
  
  // Add debug information refresh
  setInterval(() => {
    if (dashboardState.debug) {
      updateDebugInfo();
    }
  }, 5000);
}

/**
 * Toggle debug panel visibility
 */
function toggleDebugPanel() {
  const debugPanel = document.querySelector(DASHBOARD_CONFIG.SELECTORS.DEBUG_PANEL);
  
  if (debugPanel) {
    dashboardState.debug = !dashboardState.debug;
    debugPanel.style.display = dashboardState.debug ? 'block' : 'none';
    
    if (dashboardState.debug) {
      updateDebugInfo();
    }
  }
}

/**
 * Update debug information
 */
function updateDebugInfo() {
  const debugContent = document.getElementById('debug-content');
  
  if (!debugContent) return;
  
  // Get current app state
  const connectionState = {
    isConnected: dashboardState.serverStatus.connected,
    binanceConnected: dashboardState.serverStatus.binanceConnected,
    autoTradingEnabled: dashboardState.serverStatus.autoTradingEnabled,
  };
  
  // Create debug output
  const info = {
    timestamp: new Date().toISOString(),
    darkMode: dashboardState.darkMode,
    connection: connectionState,
    autoRefresh: Boolean(dashboardState.autoRefreshInterval),
    prices: {},
    holdings: {},
    usdtBalance: dashboardState.usdtBalance
  };
  
  // Add crypto prices and holdings
  Cards.CARD_CONFIG.SUPPORTED_CRYPTOS.forEach(crypto => {
    const symbol = crypto.symbol;
    info.prices[symbol] = Cards.getPrice(symbol);
    info.holdings[symbol] = Cards.getHolding(symbol);
  });
  
  // Output as formatted JSON
  debugContent.innerHTML = `<pre>${JSON.stringify(info, null, 2)}</pre>`;
}

/**
 * Load initial data for all cryptocurrencies
 */
function loadInitialData() {
  // First request system status
  requestSystemStatus();
  
  // Then request batch data for all cryptocurrencies
  setTimeout(() => {
    // Get all symbols
    const symbols = Cards.CARD_CONFIG.SUPPORTED_CRYPTOS.map(crypto => 
      `${crypto.symbol.toUpperCase()}USDT`
    );
    
    // Request batch data with history limit for faster initial load
    dashboardState.socket.emit('batch-get-data', { 
      symbols,
      historyLimit: DASHBOARD_CONFIG.HISTORY_ITEMS_LIMIT // Limit history items
    });
    
    // Request account info for USDT balance
    requestAccountInfo();
  }, 500); // Reduced from 1000ms
}

/**
 * Load all data (used for manual refresh)
 */
function loadAllData() {
  // Request system status
  requestSystemStatus();
  
  // Request batch data for all cryptocurrencies
  const symbols = Cards.CARD_CONFIG.SUPPORTED_CRYPTOS.map(crypto => 
    `${crypto.symbol.toUpperCase()}USDT`
  );
  
  // Include history limit like we do for initial load
  dashboardState.socket.emit('batch-get-data', { 
    symbols,
    historyLimit: DASHBOARD_CONFIG.HISTORY_ITEMS_LIMIT
  });
  
  // Also refresh account info
  requestAccountInfo();
}

/**
 * Request system status from the server
 */
function requestSystemStatus() {
  if (dashboardState.socket && dashboardState.socket.connected) {
    dashboardState.socket.emit('get-system-status');
  }
}

/**
 * Set up automatic data refresh
 */
function setupAutoRefresh() {
  // Clear any existing interval
  if (dashboardState.autoRefreshInterval) {
    clearInterval(dashboardState.autoRefreshInterval);
  }
  
  // Set up new interval
  dashboardState.autoRefreshInterval = setInterval(() => {
    console.log('Auto-refreshing data...');
    loadAllData();
  }, DASHBOARD_CONFIG.AUTO_REFRESH_INTERVAL);
  
  console.log(`Auto-refresh set up with interval: ${DASHBOARD_CONFIG.AUTO_REFRESH_INTERVAL}ms`);
}

/**
 * Create and set up USDT balance display
 */
function setupUsdtBalanceDisplay() {
  // Create balance display container if it doesn't exist
  let balanceContainer = document.getElementById('usdt-balance-container');
  
  if (!balanceContainer) {
    balanceContainer = document.createElement('div');
    balanceContainer.id = 'usdt-balance-container';
    balanceContainer.className = 'usdt-balance-container';
    balanceContainer.innerHTML = `
      <span class="balance-label">USDT Balance: </span>
      <span class="balance-value" id="usdt-balance-value">0.00</span>
    `;
    
    // Find the websocket monitor to insert after it
    const wsMonitor = document.getElementById('websocket-monitor');
    if (wsMonitor && wsMonitor.parentNode) {
      wsMonitor.parentNode.insertBefore(balanceContainer, wsMonitor.nextSibling);
    } else {
      // Fallback: add to status section
      const statusSection = document.querySelector('.status-section');
      if (statusSection) {
        statusSection.parentNode.insertBefore(balanceContainer, statusSection.nextSibling);
      }
    }
  }

  // Request initial account info
  setTimeout(() => {
    requestAccountInfo();
  }, 2000); // Short delay after connections are established
}

/**
 * Handle account info updates from the server
 * @param {Object} data - Account information
 */
function handleAccountInfoUpdate(data) {
  if (!data || data.error) {
    console.error('Error updating account balance:', data?.error || 'Unknown error');
    return;
  }
  
  // Extract USDT balance from account info
  let usdtBalance = 0;
  
  // First, check for database balances which are more reliable
  if (data.databaseBalances && data.databaseBalances.USDT !== undefined) {
    usdtBalance = parseFloat(data.databaseBalances.USDT) || 0;
    console.log('Using USDT balance from database:', usdtBalance);
  }
  // Fallback to direct Binance API data if database balance isn't available
  else if (data.balances && Array.isArray(data.balances)) {
    const usdtAsset = data.balances.find(b => b.asset === 'USDT');
    if (usdtAsset) {
      usdtBalance = parseFloat(usdtAsset.free) || 0;
      console.log('Using USDT balance from Binance API:', usdtBalance);
    }
  }
  
  dashboardState.usdtBalance = usdtBalance;
  
  // Update display
  updateBalanceDisplay();
}

/**
 * Update the USDT balance display
 */
function updateBalanceDisplay() {
  const balanceEl = document.getElementById('usdt-balance-value');
  if (balanceEl) {
    // Format balance with 2 decimal places
    const formattedBalance = dashboardState.usdtBalance.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    
    balanceEl.textContent = formattedBalance;
  }
}

/**
 * Request account info from the server
 */
function requestAccountInfo() {
  // Only request if connection is established
  if (dashboardState.socket && dashboardState.socket.connected) {
    dashboardState.socket.emit('get-account-info');
  }
}

/**
 * Set up theme toggle functionality
 */
function setupThemeToggle() {
  const themeToggle = document.querySelector(DASHBOARD_CONFIG.SELECTORS.THEME_TOGGLE);
  
  if (!themeToggle) {
    console.warn('Theme toggle not found');
    return;
  }
  
  // Check for saved theme preference
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    themeToggle.checked = true;
    dashboardState.darkMode = true;
  }
  
  // Add event listener for theme toggle
  themeToggle.addEventListener('change', () => {
    if (themeToggle.checked) {
      document.body.classList.add('dark-mode');
      localStorage.setItem('theme', 'dark');
      dashboardState.darkMode = true;
    } else {
      document.body.classList.remove('dark-mode');
      localStorage.setItem('theme', 'light');
      dashboardState.darkMode = false;
    }
  });
}

/**
 * Set up the notification system
 */
function setupNotificationSystem() {
  // Create notification element if it doesn't exist
  let notification = document.getElementById('notification');
  
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'notification';
    notification.className = 'notification';
    notification.style.display = 'none';
    document.body.appendChild(notification);
  }
  
  // Listen for notification events
  document.addEventListener('showNotification', (event) => {
    if (event.detail) {
      showNotification(event.detail.message, event.detail.type);
    }
  });
  
  // Listen for USDT balance update events from cards.js
  document.addEventListener('usdt-balance-update', (event) => {
    if (event.detail && typeof event.detail.balance === 'number') {
      dashboardState.usdtBalance = event.detail.balance;
      updateBalanceDisplay();
    }
  });
}

/**
 * Show a temporary notification to the user
 * @param {string} message - Message to display
 * @param {string} type - Notification type ('success', 'error', 'info')
 */
function showNotification(message, type = 'info') {
  // Get notification element
  const notification = document.getElementById('notification');
  
  if (!notification) return;
  
  // Set content and type
  notification.textContent = message;
  notification.className = `notification ${type}`;
  
  // Show notification
  notification.style.display = 'block';
  
  // Hide after 3 seconds
  setTimeout(() => {
    notification.style.display = 'none';
  }, 3000);
}

/**
 * Clean up resources when page is unloaded
 */
function cleanup() {
  // Clear auto-refresh interval
  if (dashboardState.autoRefreshInterval) {
    clearInterval(dashboardState.autoRefreshInterval);
    dashboardState.autoRefreshInterval = null;
  }
  
  // Close socket connection
  if (dashboardState.socket) {
    dashboardState.socket.close();
  }
  
  console.log('Dashboard resources cleaned up');
}

// Register cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Export public API
export {
  initialize,
  loadAllData,
  requestAccountInfo,
  showNotification
};