// frontend/js/dashboard.js
// Dashboard Management Module
// Responsible for coordinating UI modules and managing overall application state

// Import socket connection from connections module
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
        THEME_TOGGLE: '#theme-toggle',
        DEBUG_PANEL: '#debug-panel',
        TOGGLE_DEBUG: '#toggle-debug'
    }
};

// Dashboard state
const dashboardState = {
    initialized: false,
    autoRefreshInterval: null,
    darkMode: false,
    usdtBalance: 0,
    debug: false
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
        
        // Mark as initialized
        dashboardState.initialized = true;
        
        // Notify any global handlers that the app is ready
        if (typeof window.appInitialized === 'function') {
            window.appInitialized();
        }
        
        console.log('Dashboard initialized successfully');
        return true;
    } catch (error) {
        console.error('Error initializing dashboard:', error);
        
        // Notify any global error handlers
        if (typeof window.appInitializationFailed === 'function') {
            window.appInitializationFailed(error.message);
        }
        
        return false;
    }
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
    
    // Set up test action buttons if in development mode
    const isDevMode = window.location.hostname === 'localhost' || 
                     window.location.hostname === '127.0.0.1';
    
    if (isDevMode) {
        setupTestActions();
    }
    
    // Create and add USDT balance display
    setupUsdtBalanceDisplay();

    // Register for status changes to update UI
    Monitor.registerStatusListener(handleStatusChange);
    
    // Set up disclaimer modal events
    setupDisclaimerModal();
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
    // Check if test actions section exists
    const testActions = document.querySelector(DASHBOARD_CONFIG.SELECTORS.TEST_ACTIONS);
    
    if (testActions) {
        // Set up event handlers
        const testConnectionBtn = document.getElementById('test-connection');
        const testWebSocketBtn = document.getElementById('test-websocket');
        const refreshDataBtn = document.getElementById('refresh-data');
        const toggleDebugBtn = document.getElementById('toggle-debug');
        
        if (testConnectionBtn) {
            testConnectionBtn.addEventListener('click', () => {
                Connections.requestSystemStatus();
            });
        }
        
        if (testWebSocketBtn) {
            testWebSocketBtn.addEventListener('click', () => {
                Connections.emit('test-binance-stream');
            });
        }
        
        if (refreshDataBtn) {
            refreshDataBtn.addEventListener('click', () => {
                loadAllData();
            });
        }
        
        if (toggleDebugBtn) {
            toggleDebugBtn.addEventListener('click', () => {
                toggleDebugPanel();
            });
        }
    }
}

/**
 * Set up debug panel
 */
function setupDebugPanel() {
    const debugPanel = document.querySelector(DASHBOARD_CONFIG.SELECTORS.DEBUG_PANEL);
    
    if (debugPanel) {
        // Add debug information refresh
        setInterval(() => {
            if (dashboardState.debug) {
                updateDebugInfo();
            }
        }, 5000);
    }
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
    const connectionState = Connections.getConnectionState ? Connections.getConnectionState() : { isConnected: false };
    
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
        info.prices[symbol] = Cards.getPrice ? Cards.getPrice(symbol) : 'N/A';
        info.holdings[symbol] = Cards.getHolding ? Cards.getHolding(symbol) : 'N/A';
    });
    
    // Output as formatted JSON
    debugContent.innerHTML = `<pre>${JSON.stringify(info, null, 2)}</pre>`;
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
        const symbols = Cards.CARD_CONFIG.SUPPORTED_CRYPTOS.map(crypto => 
            `${crypto.symbol.toUpperCase()}USDT`
        );
        
        // Request batch data (more efficient than individual requests)
        Connections.emit('batch-get-data', { symbols });
        
        // Request account info for USDT balance
        requestAccountInfo();
    }, 1000);
}

/**
 * Load all data (used for manual refresh)
 */
function loadAllData() {
    // Request system status
    Connections.requestSystemStatus();
    
    // Request batch data for all cryptocurrencies
    const symbols = Cards.CARD_CONFIG.SUPPORTED_CRYPTOS.map(crypto => 
        `${crypto.symbol.toUpperCase()}USDT`
    );
    
    Connections.emit('batch-get-data', { symbols });
    
    // Also refresh account info
    requestAccountInfo();
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

    // Register for account info updates
    Connections.on('account-info', handleAccountInfoUpdate);
  
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
    
    if (data.balances && Array.isArray(data.balances)) {
        const usdtAsset = data.balances.find(b => b.asset === 'USDT');
        if (usdtAsset) {
            usdtBalance = parseFloat(usdtAsset.free) || 0;
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
    if (Connections.isConnected && Connections.isConnected()) {
        Connections.emit('get-account-info');
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
        const tradingEnabled = typeof status === 'object' 
            ? (status.enabled && !status.circuitBreaker)
            : Boolean(status);
        
        Monitor.toggleTradingAvailability(tradingEnabled);
    }
    
    // Update status banner if needed
    updateStatusBanner(service, status);
}

/**
 * Update status banner based on service status changes
 * @param {string} service - Service that changed
 * @param {*} status - New status
 */
function updateStatusBanner(service, status) {
    const banner = document.getElementById('system-status-banner');
    const message = document.getElementById('status-message');
    
    if (!banner || !message) return;
    
    // Only show banner for significant issues
    if (service === 'overall' && status === false) {
        message.textContent = 'System is currently experiencing issues. Some features may be unavailable.';
        banner.style.display = 'flex';
    } else if (service === 'binance' && status === false) {
        message.textContent = 'Unable to connect to Binance. Trading features may be unavailable.';
        banner.style.display = 'flex';
    } else if (service === 'database' && status === false) {
        message.textContent = 'Database connection issues. Some data may be unavailable.';
        banner.style.display = 'flex';
    }
}

/**
 * Show a temporary notification to the user
 * @param {string} message - Message to display
 * @param {string} type - Notification type ('success', 'error', 'info')
 */
function showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('notification');
    
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        notification.className = 'notification';
        document.body.appendChild(notification);
    }
    
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