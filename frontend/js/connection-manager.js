// Create a new file in your frontend/js directory called connection-manager.js

// Connection Manager for robust backend connectivity
class ConnectionManager {
    constructor(socket, options = {}) {
        this.socket = socket;
        this.options = {
            pingInterval: options.pingInterval || 20000,
            reconnectAttempts: options.reconnectAttempts || 5,
            reconnectDelay: options.reconnectDelay || 5000,
            maxReconnectDelay: options.maxReconnectDelay || 30000,
            healthCheckUrl: options.healthCheckUrl || '/health',
            statusCallback: options.statusCallback || function() {}
        };
        
        this.connected = false;
        this.reconnectAttempt = 0;
        this.pingIntervalId = null;
        this.statusCheckIntervalId = null;
        this.lastPongTime = 0;
        
        // Initialize
        this.init();
    }
    
    init() {
        // Listen for socket events
        this.socket.on('connect', this.handleConnect.bind(this));
        this.socket.on('disconnect', this.handleDisconnect.bind(this));
        this.socket.on('connect_error', this.handleError.bind(this));
        this.socket.on('error', this.handleError.bind(this));
        this.socket.on('pong', this.handlePong.bind(this));
        this.socket.on('heartbeat', this.handleHeartbeat.bind(this));
        
        // Start ping interval
        this.startPing();
        
        // Start status checking
        this.startStatusCheck();
    }
    
    handleConnect() {
        console.log('[ConnectionManager] Socket connected');
        this.connected = true;
        this.reconnectAttempt = 0;
        this.options.statusCallback('connected');
    }
    
    handleDisconnect(reason) {
        console.log(`[ConnectionManager] Socket disconnected: ${reason}`);
        this.connected = false;
        this.options.statusCallback('disconnected');
        
        // If this wasn't an intentional disconnect, try to reconnect
        if (reason !== 'io client disconnect') {
            this.attemptReconnect();
        }
    }
    
    handleError(error) {
        console.error('[ConnectionManager] Socket error:', error);
        this.options.statusCallback('error', error);
        this.attemptReconnect();
    }
    
    handlePong(data) {
        // Record the time we received a pong
        this.lastPongTime = Date.now();
    }
    
    handleHeartbeat(data) {
        // Record the time we received a heartbeat
        this.lastPongTime = Date.now();
    }
    
    startPing() {
        // Clear any existing interval
        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId);
        }
        
        // Start new ping interval
        this.pingIntervalId = setInterval(() => {
            if (this.socket.connected) {
                // Simple ping with timestamp
                this.socket.emit('ping', { timestamp: Date.now() });
                
                // Schedule a check for the pong response
                setTimeout(() => {
                    const now = Date.now();
                    const timeSinceLastPong = now - this.lastPongTime;
                    
                    // If we haven't had a pong response in twice the ping interval,
                    // consider the connection unhealthy
                    if (timeSinceLastPong > this.options.pingInterval * 2) {
                        console.warn('[ConnectionManager] No pong received for a while, connection might be unhealthy');
                        this.checkHealth();
                    }
                }, this.options.pingInterval);
            }
        }, this.options.pingInterval);
    }
    
    startStatusCheck() {
        // Clear any existing interval
        if (this.statusCheckIntervalId) {
            clearInterval(this.statusCheckIntervalId);
        }
        
        // Start new status check interval
        this.statusCheckIntervalId = setInterval(() => {
            this.checkHealth();
        }, this.options.pingInterval * 2);
    }
    
    checkHealth() {
        // Make a direct HTTP request to the health endpoint
        fetch(this.options.healthCheckUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Health check failed with status: ${response.status}`);
                }
                return response.json();
            })
            .then(health => {
                console.log('[ConnectionManager] Health check successful', health);
                
                // If our socket says disconnected but health check passed,
                // the socket might be in a wrong state
                if (!this.socket.connected) {
                    console.warn('[ConnectionManager] Socket reports disconnected but health check passed, reconnecting...');
                    this.attemptReconnect();
                }
            })
            .catch(error => {
                console.error('[ConnectionManager] Health check failed:', error);
                
                // If health check fails, try to reconnect
                if (this.socket.connected) {
                    console.warn('[ConnectionManager] Socket reports connected but health check failed');
                    this.socket.disconnect();
                }
                this.attemptReconnect();
            });
    }
    
    attemptReconnect() {
        // Only attempt reconnect if we're not already connected
        if (this.socket.connected) {
            return;
        }
        
        // If we've exceeded max attempts, notify but don't retry
        if (this.reconnectAttempt >= this.options.reconnectAttempts) {
            console.error(`[ConnectionManager] Max reconnect attempts (${this.options.reconnectAttempts}) reached`);
            this.options.statusCallback('max_attempts_reached');
            return;
        }
        
        // Calculate exponential backoff delay
        const delay = Math.min(
            this.options.reconnectDelay * Math.pow(1.5, this.reconnectAttempt),
            this.options.maxReconnectDelay
        );
        
        this.reconnectAttempt++;
        console.log(`[ConnectionManager] Attempting reconnect ${this.reconnectAttempt}/${this.options.reconnectAttempts} in ${delay}ms`);
        
        // Notify about reconnection attempt
        this.options.statusCallback('reconnecting', {
            attempt: this.reconnectAttempt,
            maxAttempts: this.options.reconnectAttempts,
            delay
        });
        
        // Schedule reconnection
        setTimeout(() => {
            console.log('[ConnectionManager] Reconnecting now...');
            
            // Try to reconnect
            if (!this.socket.connected) {
                this.socket.connect();
            }
        }, delay);
    }
    
    // Call this to manually reconnect
    reconnect() {
        if (this.socket.connected) {
            this.socket.disconnect();
        }
        
        // Reset reconnect attempt counter for manual reconnect
        this.reconnectAttempt = 0;
        
        // Try to reconnect immediately
        this.socket.connect();
    }
    
    // Call this when cleaning up
    cleanup() {
        // Clear intervals
        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId);
        }
        if (this.statusCheckIntervalId) {
            clearInterval(this.statusCheckIntervalId);
        }
        
        // Remove all event listeners
        this.socket.off('connect');
        this.socket.off('disconnect');
        this.socket.off('connect_error');
        this.socket.off('error');
        this.socket.off('pong');
        this.socket.off('heartbeat');
    }
}

// Export the connection manager
export default ConnectionManager;