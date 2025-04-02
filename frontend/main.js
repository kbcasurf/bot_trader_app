// main.js - Application Entry Point
// This file is the bootstrapper that initializes both modules

import * as Connections from './js/conns.js';
import * as Dashboard from './js/dashboard.js';

// Helper function for when DOM is ready
function whenDomReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback);
    } else {
        callback();
    }
}

// Flag to track initialization
let isInitialized = false;

// Initialize application
function initializeApp() {
    if (isInitialized) return;
    isInitialized = true;
    
    console.log('Initializing Crypto Trading Bot application...');
    
    // Initialize connection module
    Connections.initialize();
    
    // Initialize dashboard module after a slight delay
    setTimeout(() => {
        Dashboard.initialize();
    }, 300);
    
    console.log('Application initialization complete');
}

// Start the application when DOM is ready
whenDomReady(() => {
    // Short delay to ensure all HTML elements are rendered
    setTimeout(initializeApp, 500);
});

// Export the socket for compatibility with any code that might be importing it
export { Connections };