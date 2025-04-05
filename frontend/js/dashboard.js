// frontend/js/dashboard.js
// Dashboard Management Module
// Responsible for coordinating UI modules and managing overall application state

// Import our custom modules
import * as Connections from './conns.js';
import * as Cards from './cards.js';
import * as Monitor from './monitor.js';

// Dashboard configuration
const DASHBOARD_CONFIG = {
    // Refresh intervals in milliseconds
    AUTO_REFRESH_INTERVAL: 60000,     // 1 minute
    STAGGERED_LOAD_DELAY: 200,        // 200ms between loading each card's data
    
    // Element selectors
    SELECTORS: {
        CRYPTO_GRID: '.crypto-grid',
        TEST_ACTIONS: '.test-actions',
        THEME_TOGGLE: '#theme-toggle'
    }
};

// Dashboard state
const dashboardState = {
    initialized: false,
    autoRefreshInterval: null,
    darkMode: false
};

/**
 * Initialize dashboard module
 */
function initialize() {
    console.log('Initializing dashboard...');
    
    if (dashboardState.initialized) {
        console.warn('Dashboard already initialized');
        return;
    }
    
    try {
        // Initialize connection module first
        Connections.initialize();
        
        // Initialize card module
        Cards.initialize();
        
        // Initialize monitor module
        Monitor.initialize();
        
        // Set up UI components
        setupUI();
        
        // Load initial data with a slight delay to ensure connections are established
        setTimeout(loadInitialData, 500);
        
        // Set up auto-refresh
        setupAutoRefresh();
        
        // Set up theme toggle
        setupThemeToggle();
        
        // Mark as initialized
        dashboardState.initialized = true;
        
        console.log('Dashboard initialized successfully');
    } catch (error) {
        console.error('Error initializing dashboard:', error);
    }
}

/**
 * Set up UI components
 */
function setupUI() {
    // Get crypto grid element
    const cryptoGrid = document.querySelector(DASHBOARD_CONFIG.SELECTORS.CRYPTO_GRID);
    
    if (!cryptoGrid) {
        console.error('Crypto grid not found');
        return;
    }
    
    // Create all crypto cards
    const cards = Cards.createAllCards();
    
    // Add all cards to the grid
    cards.forEach(card => {
        cryptoGrid.appendChild(card);
    });
    
    // Add test action buttons if in development mode
    if (process.env.NODE_ENV === 'development') {
        setupTestActions();
    }
    
    // Register for status changes to update UI
    Monitor.registerStatusListener(handleStatusChange);
}

/**
 * Set up test action buttons (development mode only)
 */
function setupTestActions() {
    // Check if test actions section exists
    let testActions = document.querySelector(DASHBOARD_CONFIG.SELECTORS.TEST_ACTIONS);
    
    // If not, create it
    if (!testActions) {
        testActions = document.createElement('div');
        testActions.className = 'test-actions';
        testActions.innerHTML = `
            <h3>Development Tools</h3>
            <div class="test-buttons">
                <button id="test-connection">Test Connection</button>
                <button id="test-websocket">Test Binance WebSocket</button>
                <button id="refresh-data">Refresh All Data</button>
            </div>
        `;
        
        // Add to body
        document.body.appendChild(testActions);
    }
    
    // Set up event handlers
    const testConnectionBtn = document.getElementById('test-connection');
    const testWebSocketBtn = document.getElementById('test-websocket');
    const refreshDataBtn = document.getElementById('refresh-data');
    
    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', () => {
            Connections.requestSystemStatus();
        });
    }
    
    if (testWebSocketBtn) {
        testWebSocketBtn.addEventListener('click', () => {
            Connections.testBinanceStream();
        });
    }
    
    if (refreshDataBtn) {
        refreshDataBtn.addEventListener('click', () => {
            loadAllData();
        });
    }
}

/**
 * Load initial data for all cryptocurrencies
 */
function loadInitialData() {
    // First request system status
    Connections.requestSystemStatus();
    
    // Then request batch data for all cryptocurrencies
    setTimeout(() => {
        // Get all symbols
        const symbols = Cards.CARD_CONFIG.SUPPORTED_CRYPTOS.map(crypto => crypto.symbol);
        
        // Request batch data (more efficient than individual requests)
        Connections.socket.emit('batch-get-data', { symbols });
    }, 1000);
}

/**
 * Load all data (used for manual refresh)
 */
function loadAllData() {
    // Request system status
    Connections.requestSystemStatus();
    
    // Request batch data for all cryptocurrencies
    const symbols = Cards.CARD_CONFIG.SUPPORTED_CRYPTOS.map(crypto => crypto.symbol);
    Connections.socket.emit('batch-get-data', { symbols });
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
 * Handle status change events from the monitor
 * @param {string} service - Service that changed
 * @param {*} status - New status
 */
function handleStatusChange(service, status) {
    // For 'overall' status changes, update UI accordingly
    if (service === 'overall') {
        // If system is healthy, ensure auto-refresh is running
        if (status === true && !dashboardState.autoRefreshInterval) {
            setupAutoRefresh();
        } 
        // If system is unhealthy, maybe reduce refresh frequency
        else if (status === false && dashboardState.autoRefreshInterval) {
            // Don't completely stop, but could reduce frequency if desired
            // For now, we'll keep the refresh going even if system is degraded
        }
    }
    
    // For trading status changes, update card interactivity
    if (service === 'trading') {
        // status will be an object with enabled and circuitBreaker properties
        const tradingEnabled = status.enabled && !status.circuitBreaker;
        
        // Let the monitor handle the UI updates
        Monitor.toggleTradingAvailability(tradingEnabled);
    }
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
    
    console.log('Dashboard resources cleaned up');
}

// Register cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Export public API
export {
    initialize,
    loadAllData
};