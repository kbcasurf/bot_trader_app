// frontend/main.js
// Application Entry Point
// This file is the bootstrapper that initializes all modules in the correct order

// Import all modules using ES module imports
import * as Connections from './js/conns.js';
import * as Dashboard from './js/dashboard.js';
import * as Cards from './js/cards.js';
import * as Monitor from './js/monitor.js';

// Track initialization status
const initStatus = {
    connections: false,
    cards: false,
    monitor: false,
    dashboard: false
};

// Store any initialization errors
const initErrors = {
    connections: null,
    cards: null,
    monitor: null,
    dashboard: null
};

/**
 * Initialize the application in the correct sequence
 * - First establish connections
 * - Then initialize UI components
 * - Finally start dashboard coordination
 */
function initializeApp() {
    console.log('Initializing Crypto Trading Bot application...');
    
    // Start with a clean console in development mode
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.clear();
    }
    
    // Step 1: Initialize connections module (most critical)
    try {
        Connections.initialize();
        initStatus.connections = true;
        console.log('✅ Connections module initialized');
    } catch (error) {
        console.error('❌ Failed to initialize connections module:', error);
        initErrors.connections = error;
        
        // Even with connection failure, continue initialization
        // so we can show proper error UI
    }
    
    // Step 2: Initialize Cards module (UI components)
    try {
        Cards.initialize();
        initStatus.cards = true;
        console.log('✅ Cards module initialized');
    } catch (error) {
        console.error('❌ Failed to initialize cards module:', error);
        initErrors.cards = error;
    }
    
    // Step 3: Initialize Monitor module (connection status displays)
    try {
        Monitor.initialize();
        initStatus.monitor = true;
        console.log('✅ Monitor module initialized');
    } catch (error) {
        console.error('❌ Failed to initialize monitor module:', error);
        initErrors.monitor = error;
    }
    
    // Step 4: Initialize Dashboard module (coordinates everything)
    // Only if critical components are ready
    if (initStatus.connections && initStatus.cards && initStatus.monitor) {
        try {
            Dashboard.initialize();
            initStatus.dashboard = true;
            console.log('✅ Dashboard module initialized');
        } catch (error) {
            console.error('❌ Failed to initialize dashboard module:', error);
            initErrors.dashboard = error;
        }
    } else {
        console.warn('⚠️ Skipping dashboard initialization due to missing dependencies');
        
        // Even with partial initialization, try to display something
        handlePartialInitialization();
    }
    
    // Log overall status
    const allInitialized = Object.values(initStatus).every(Boolean);
    if (allInitialized) {
        console.log('✅ Application initialization complete');
    } else {
        console.warn('⚠️ Application initialized with errors:', 
            Object.entries(initStatus)
                .filter(([_, status]) => !status)
                .map(([module]) => module)
                .join(', ')
        );
    }
    
    // Register global error handler
    registerGlobalErrorHandler();
}

/**
 * Handle partial initialization by displaying appropriate error messages
 */
function handlePartialInitialization() {
    // If we have the monitor module, use it to show connection status
    if (initStatus.monitor) {
        // Force disconnected status for failed components
        if (!initStatus.connections) {
            Monitor.updateBackendStatus(false);
        }
    } else {
        // If monitor isn't available, create a basic error banner
        createErrorBanner();
    }
    
    // If we have cards but not dashboard, try to render empty cards
    if (initStatus.cards && !initStatus.dashboard) {
        try {
            // Get container element
            const container = document.querySelector('.crypto-grid');
            if (container) {
                // Create basic cards without data
                const cards = Cards.createAllCards();
                cards.forEach(card => container.appendChild(card));
            }
        } catch (error) {
            console.error('Failed to render fallback cards:', error);
        }
    }

    // Tell the app we're done initializing, but with errors
    if (typeof window.appInitializationFailed === 'function') {
        const errorMessage = Object.values(initErrors)
            .filter(err => err !== null)
            .map(err => err.message)
            .join('; ');
        
        window.appInitializationFailed(
            errorMessage || 'Failed to initialize application components'
        );
    }
}

/**
 * Create a basic error banner for critical initialization failures
 */
function createErrorBanner() {
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.innerHTML = `
        <h3>⚠️ Application Error</h3>
        <p>There was a problem initializing the application. Please try refreshing the page.</p>
        <button id="refresh-app">Refresh</button>
    `;
    
    // Add to document
    document.body.insertBefore(banner, document.body.firstChild);
    
    // Add refresh button handler
    const refreshButton = document.getElementById('refresh-app');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            window.location.reload();
        });
    }
}

/**
 * Register global error handler for uncaught errors
 */
function registerGlobalErrorHandler() {
    window.addEventListener('error', (event) => {
        console.error('Uncaught error:', event.error);
        
        // Send these errors to the backend for logging
        if (initStatus.connections && Connections.isConnected && Connections.isConnected()) {
            Connections.emit('client-error', {
                message: event.error?.message || 'Unknown error',
                stack: event.error?.stack,
                location: window.location.href,
                timestamp: new Date().toISOString()
            });
        }
    });
    
    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
        
        // Send these errors to the backend for logging
        if (initStatus.connections && Connections.isConnected && Connections.isConnected()) {
            Connections.emit('client-error', {
                message: event.reason?.message || 'Unhandled promise rejection',
                stack: event.reason?.stack,
                location: window.location.href,
                timestamp: new Date().toISOString()
            });
        }
    });
}

/**
 * Helper function for when DOM is ready
 * @param {Function} callback - Function to call when DOM is ready
 */
function whenDomReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback);
    } else {
        callback();
    }
}

// Start the application when DOM is ready
whenDomReady(() => {
    // Short delay to ensure all HTML elements are rendered
    setTimeout(initializeApp, 100);
});

// Expose modules to the global scope for browser access
window.CryptoTradingBot = {
    Connections,
    Dashboard,
    Cards,
    Monitor,
    initStatus
};

// Export functions for potential reuse in other modules
export {
    initializeApp,
    initStatus,
    initErrors
};