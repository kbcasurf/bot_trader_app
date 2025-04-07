// frontend/main.js
// Main entry point for the frontend application

// Import module dependencies
import './style.css';
import * as Dashboard from './js/dashboard.js';

// Main application initialization function
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing application...');
  
  // Initialize dashboard
  Dashboard.initialize();
  
  // Global notification function for use by other modules
  window.showNotification = Dashboard.showNotification;
});

// Export any functions needed for global access
window.reloadData = () => {
  console.log('Manual reload requested');
  Dashboard.loadAllData();
};