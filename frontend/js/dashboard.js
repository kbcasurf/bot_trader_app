// Get socket instance from main.js
import { socket } from '../main.js';

// Track trading status
let tradingActive = false;

/**
 * WebSocket Monitor Component
 * Provides UI elements to monitor and control WebSocket connections
 */
class WebSocketMonitor {
    constructor(containerId = 'websocket-monitor') {
        this.containerId = containerId;
        this.container = null;
        this.statusUpdateInterval = null;
        
        // Initialize the component
        this.init();
    }
    
    /**
     * Initialize the component
     */
    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupMonitor());
        } else {
            this.setupMonitor();
        }
    }
    
    /**
     * Set up the monitor component
     */
    setupMonitor() {
        // Create container if it doesn't exist
        this.createContainer();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Start status update interval
        this.startStatusUpdates();
    }
    
    /**
     * Create the container for the WebSocket monitor
     */
    createContainer() {
        // Check if container already exists
        let container = document.getElementById(this.containerId);
        
        if (!container) {
            // Create a new container
            container = document.createElement('div');
            container.id = this.containerId;
            container.className = 'websocket-monitor';
            
            // Add basic styles (you can move these to your CSS file)
            container.style.backgroundColor = '#f8f9fa';
            container.style.border = '1px solid #dee2e6';
            container.style.borderRadius = '4px';
            container.style.padding = '15px';
            container.style.marginBottom = '20px';
            
            // Create initial content
            container.innerHTML = `
                <h3>WebSocket Monitor</h3>
                <div class="status-section">
                    <div class="status-row">
                        <span class="status-label">Connection Status:</span>
                        <span class="status-value" id="ws-connection-status">Unknown</span>
                    </div>
                    <div class="status-row">
                        <span class="status-label">Connection Age:</span>
                        <span class="status-value" id="ws-connection-age">0 hours</span>
                    </div>
                    <div class="status-row">
                        <span class="status-label">Polling Status:</span>
                        <span class="status-value" id="ws-polling-status">Inactive</span>
                    </div>
                </div>
                <div class="actions-section">
                    <button id="ws-check-status" class="action-btn">Check Status</button>
                    <button id="ws-renew-connection" class="action-btn">Renew Connection</button>
                </div>
                <div class="details-section" id="ws-details">
                    <p>No details available</p>
                </div>
            `;
            
            // Add to page - look for a specific element to append to
            const targetElement = document.querySelector('.status-section') || document.body;
            if (targetElement) {
                targetElement.after(container);
            } else {
                document.body.appendChild(container);
            }
        }
        
        this.container = container;
    }
    
    /**
     * Set up event listeners for the component
     */
    setupEventListeners() {
        // Listen for button clicks
        const checkStatusBtn = document.getElementById('ws-check-status');
        const renewConnectionBtn = document.getElementById('ws-renew-connection');
        
        if (checkStatusBtn) {
            checkStatusBtn.addEventListener('click', () => this.checkStatus());
        }
        
        if (renewConnectionBtn) {
            renewConnectionBtn.addEventListener('click', () => this.renewConnection());
        }
        
        // Listen for WebSocket status updates from server
        socket.on('websocket-status', (status) => {
            this.updateStatusDisplay(status);
        });
        
        // Listen for detailed status response
        socket.on('websocket-status-details', (response) => {
            this.updateDetailsDisplay(response);
        });
        
        // Listen for renewal result
        socket.on('renew-websocket-result', (result) => {
            this.handleRenewalResult(result);
        });
    }
    
    /**
     * Start periodic status updates
     */
    startStatusUpdates() {
        // Clear any existing interval
        if (this.statusUpdateInterval) {
            clearInterval(this.statusUpdateInterval);
        }
        
        // Check status immediately
        this.checkStatus();
        
        // Set up interval (every 5 minutes)
        this.statusUpdateInterval = setInterval(() => {
            this.checkStatus();
        }, 5 * 60 * 1000);
    }
    
    /**
     * Check WebSocket status
     */
    checkStatus() {
        // Emit event to request status
        socket.emit('get-websocket-status');
    }
    
    /**
     * Manually renew WebSocket connection
     */
    renewConnection() {
        // Show confirmation dialog
        if (confirm('Are you sure you want to renew the WebSocket connection? This will temporarily interrupt real-time updates.')) {
            // Emit event to request renewal
            socket.emit('renew-websocket');
        }
    }
    
    /**
     * Update status display
     * @param {Object} status WebSocket status object
     */
    updateStatusDisplay(status) {
        const connectionStatusEl = document.getElementById('ws-connection-status');
        const pollingStatusEl = document.getElementById('ws-polling-status');
        
        if (connectionStatusEl) {
            if (status.connected) {
                connectionStatusEl.textContent = 'Connected';
                connectionStatusEl.style.color = '#28a745'; // green
            } else if (status.reconnecting) {
                connectionStatusEl.textContent = `Reconnecting (Attempt ${status.attempt || 1})`;
                connectionStatusEl.style.color = '#ffc107'; // yellow
            } else {
                connectionStatusEl.textContent = 'Disconnected';
                connectionStatusEl.style.color = '#dc3545'; // red
            }
        }
        
        if (pollingStatusEl) {
            if (status.pollingActive) {
                pollingStatusEl.textContent = 'Active (Fallback Mode)';
                pollingStatusEl.style.color = '#ffc107'; // yellow
            } else {
                pollingStatusEl.textContent = 'Inactive';
                pollingStatusEl.style.color = '#6c757d'; // gray
            }
        }
    }
    
    /**
     * Update details display
     * @param {Object} response Response from the server
     */
    updateDetailsDisplay(response) {
        const detailsEl = document.getElementById('ws-details');
        const ageEl = document.getElementById('ws-connection-age');
        
        if (!detailsEl) return;
        
        if (response.success && response.status) {
            const status = response.status;
            
            // Update connection age
            if (ageEl) {
                ageEl.textContent = `${status.connectionAge || 0} hours`;
                
                // Highlight connection age if approaching 24 hours
                if (status.connectionAge >= 20) {
                    ageEl.style.color = '#dc3545'; // red
                } else if (status.connectionAge >= 18) {
                    ageEl.style.color = '#ffc107'; // yellow
                } else {
                    ageEl.style.color = '#28a745'; // green
                }
            }
            
            // Format details as HTML
            let detailsHtml = `
                <h4>WebSocket Details</h4>
                <div class="details-info">
                    <p><strong>Total Connections:</strong> ${status.totalConnections}</p>
                    <p><strong>Reconnect Attempt:</strong> ${status.reconnectAttempt}</p>
                    <p><strong>Polling Active:</strong> ${status.pollingActive ? 'Yes' : 'No'}</p>
                </div>
            `;
            
            // Add connection details if there are any
            if (Object.keys(status.connections || {}).length > 0) {
                detailsHtml += '<h4>Active Connections</h4>';
                detailsHtml += '<div class="connections-list">';
                
                for (const [key, conn] of Object.entries(status.connections)) {
                    detailsHtml += `
                        <div class="connection-item">
                            <p><strong>Symbols:</strong> ${conn.symbols.join(', ')}</p>
                            <p><strong>Status:</strong> ${conn.isOpen ? 'Open' : 'Closed'}</p>
                            <p><strong>Age:</strong> ${conn.connectionAge} hours</p>
                        </div>
                    `;
                }
                
                detailsHtml += '</div>';
            }
            
            detailsEl.innerHTML = detailsHtml;
        } else {
            detailsEl.innerHTML = `<p class="error">Error getting WebSocket details: ${response.error || 'Unknown error'}</p>`;
        }
    }
    
    /**
     * Handle WebSocket renewal result
     * @param {Object} result Result from the renewal request
     */
    handleRenewalResult(result) {
        if (result.success) {
            alert('WebSocket renewal initiated successfully. Connection will be re-established shortly.');
        } else {
            alert(`WebSocket renewal failed: ${result.error || 'Unknown error'}`);
        }
    }
}

/**
 * Function to update transaction history
 * @param {string} symbol Cryptocurrency symbol
 * @param {Array} transactions List of transactions
 */
function updateTransactionHistory(symbol, transactions) {
    const historyElement = document.getElementById(`${symbol.toLowerCase()}-history`);
    
    if (!historyElement) {
        console.error(`Could not find history element for ${symbol}`);
        return;
    }
    
    // Clear existing entries
    historyElement.innerHTML = '';
    
    if (!transactions || transactions.length === 0) {
        const noTransactionsItem = document.createElement('li');
        noTransactionsItem.classList.add('no-transactions');
        noTransactionsItem.textContent = 'No transactions yet';
        historyElement.appendChild(noTransactionsItem);
        return;
    }
    
    console.log(`Updating transaction history for ${symbol} with ${transactions.length} transactions`);
    
    // Add transactions to the history list
    transactions.forEach(transaction => {
        const listItem = document.createElement('li');
        listItem.classList.add(transaction.type.toLowerCase());
        
        // Format the transaction information
        const date = new Date(transaction.timestamp);
        const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        
        // Format price and quantity with proper precision
        const price = parseFloat(transaction.price).toFixed(2);
        const quantity = parseFloat(transaction.quantity).toFixed(6);
        
        listItem.textContent = `${transaction.type}: ${quantity} ${symbol} at $${price} (${formattedDate})`;
        
        historyElement.appendChild(listItem);
    });
}

/**
 * Function to update trading button states based on WebSocket connection
 */
function updateTradingButtonsState() {
    const tradingButtons = document.querySelectorAll('.first-purchase, .sell-all');
    
    if (tradingActive) {
        tradingButtons.forEach(button => {
            button.disabled = false;
            button.classList.remove('disabled');
        });
    } else {
        tradingButtons.forEach(button => {
            button.disabled = true;
            button.classList.add('disabled');
        });
    }
}

// Initialize the WebSocket monitor when DOM is ready
let wsMonitor;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        wsMonitor = new WebSocketMonitor();
    });
} else {
    wsMonitor = new WebSocketMonitor();
}

// Listen for transaction updates
socket.on('transaction-update', (data) => {
    const { symbol, transactions } = data;
    console.log(`Received transaction update for ${symbol}:`, transactions);
    updateTransactionHistory(symbol, transactions);
});

// Listen for holdings updates
socket.on('holdings-update', (data) => {
    const { symbol, amount, profitLossPercent } = data;
    console.log(`Received holdings update for ${symbol}: ${amount} (${profitLossPercent}%)`);
    
    // Update holdings display
    const holdingsElement = document.getElementById(`${symbol.toLowerCase()}-holdings`);
    if (holdingsElement) {
        // Format the holdings amount with 6 decimal places for cryptocurrencies
        holdingsElement.textContent = `${parseFloat(amount).toFixed(6)} ${symbol}`;
    } else {
        console.error(`Holdings element not found for ${symbol}`);
    }
    
    // Update profit/loss bar and text
    const barElement = document.getElementById(`${symbol.toLowerCase()}-profit-bar`);
    const textElement = document.getElementById(`${symbol.toLowerCase()}-profit-text`);
    
    if (barElement && textElement) {
        // Calculate bar width (50% is neutral, 0% is -10% or worse, 100% is +10% or better)
        const barWidth = Math.min(Math.max((profitLossPercent + 10) * 5, 0), 100);
        barElement.style.width = `${barWidth}%`;
        
        // Update text with profit/loss percentage
        textElement.textContent = `${profitLossPercent.toFixed(2)}%`;
        
        // Add color classes based on profit/loss
        if (profitLossPercent > 0) {
            textElement.classList.add('profit');
            textElement.classList.remove('loss');
        } else if (profitLossPercent < 0) {
            textElement.classList.add('loss');
            textElement.classList.remove('profit');
        } else {
            textElement.classList.remove('profit', 'loss');
        }
    } else {
        console.error(`Profit/loss elements not found for ${symbol}`);
    }
});

// Listen for trading status updates
socket.on('trading-status', (status) => {
    tradingActive = status.active;
    updateTradingButtonsState();
});

export {
    updateTransactionHistory,
    updateTradingButtonsState,
    WebSocketMonitor
};