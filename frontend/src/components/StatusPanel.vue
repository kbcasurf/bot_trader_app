<template>
  <div class="status-panel">
    <div class="panel-header">
      <h2>Trading Bot Status</h2>
      <div class="status-indicator" :class="{ 'status-online': isOnline }">
        {{ isOnline ? 'Online' : 'Offline' }}
      </div>
    </div>
    
    <div class="panel-content">
      <div v-if="loading" class="loading">Loading status...</div>
      
      <div v-else>
        <div class="status-section">
          <h3>WebSocket Connections</h3>
          <div v-if="!websocketStatus || Object.keys(websocketStatus).length === 0" class="empty-state">
            No active WebSocket connections
          </div>
          <div v-else class="status-grid">
            <div v-for="(status, symbol) in websocketStatus" :key="symbol" class="ws-status-item">
              <div class="symbol">{{ symbol }}</div>
              <div class="connection-status" :class="`status-${status.status}`">
                {{ status.status }}
              </div>
            </div>
          </div>
          
          <button @click="restartWebSockets" :disabled="isLoading" class="action-button restart-btn">
            {{ isLoading ? 'Restarting...' : 'Restart WebSockets' }}
          </button>
        </div>
        
        <div class="status-section">
          <h3>Active Trading</h3>
          <div v-if="!tradingStatus || tradingStatus.length === 0" class="empty-state">
            No active trading configurations
          </div>
          <div v-else class="trading-grid">
            <div v-for="pair in tradingStatus" :key="pair.id" class="trading-status-item">
              <div class="pair-info">
                <span class="pair-name">{{ pair.display_name }}</span>
                <span class="trading-active" :class="{ active: pair.active }">
                  {{ pair.active ? 'Active' : 'Inactive' }}
                </span>
              </div>
              <div class="pair-details">
                <div class="detail-row">
                  <span class="detail-label">Initial Investment:</span>
                  <span class="detail-value">${{ pair.initial_investment || '0.00' }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Current Holdings:</span>
                  <span class="detail-value">{{ pair.quantity || '0.00000000' }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Current Price:</span>
                  <span class="detail-value">${{ pair.current_price ? Number(pair.current_price).toFixed(2) : '0.00' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="connection-status-section status-section">
          <h3>Connection Status</h3>
          <div class="connection-info">
            <div class="connection-type">
              <span class="detail-label">Type:</span>
              <span class="detail-value status-indicator" :class="{ 'status-active': socketConnected, 'status-error': !socketConnected }">
                {{ socketConnected ? 'WebSocket' : 'HTTP Polling' }}
              </span>
            </div>
            <div class="last-update">
              <span class="detail-label">Last Update:</span>
              <span class="detail-value">{{ lastUpdateTime }}</span>
            </div>
          </div>
        </div>
        
        <div class="status-section">
          <h3>Telegram Notifications</h3>
          <div class="notification-test">
            <input 
              type="text" 
              v-model="testMessage" 
              placeholder="Enter test message" 
              class="notification-input"
            />
            <button 
              @click="sendTestNotification" 
              :disabled="isSendingNotification" 
              class="action-button notification-btn"
            >
              {{ isSendingNotification ? 'Sending...' : 'Send Test Message' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { api } from '../utils/api';
import { io } from 'socket.io-client';

export default {
  name: 'StatusPanel',
  data() {
    return {
      websocketStatus: {},
      tradingStatus: [],
      isOnline: false,
      loading: true,
      isLoading: false,
      isSendingNotification: false,
      testMessage: 'Test notification from Trading Bot',
      statusInterval: null,
      socket: null,
      socketConnected: false,
      lastUpdateTime: 'Never'
    };
  },
  created() {
    this.fetchStatus();
    this.connectToWebSocket();
    this.setupStatusInterval();
  },
  beforeUnmount() {
    this.clearStatusInterval();
    this.disconnectFromWebSocket();
  },
  methods: {
    // Fetch initial status
    async fetchStatus() {
      this.loading = true;
      try {
        // Fetch WebSocket status
        const wsResponse = await api.getWebSocketStatus();
        this.websocketStatus = wsResponse.data;
        
        // Fetch trading status
        const tradingResponse = await api.getTradingStatus();
        this.tradingStatus = tradingResponse.data;
        
        // If we got data, the server is online
        this.isOnline = true;
        this.lastUpdateTime = new Date().toLocaleTimeString();
      } catch (error) {
        console.error('Error fetching status:', error);
        this.isOnline = false;
      } finally {
        this.loading = false;
      }
    },
    
    // Connect to WebSocket for real-time updates
    connectToWebSocket() {
      try {
        // Get WebSocket URL from environment or construct it based on API URL
        this.socket = io('/', {
          transports: ['websocket', 'polling'],
          path: '/socket.io'
        });
        
        // Handle global status updates
        this.socket.on('statusUpdate', (data) => {
          // Update relevant parts of the status
          if (data.websocketStatus) {
            this.websocketStatus = data.websocketStatus;
          }
          
          if (data.tradingStatus) {
            this.tradingStatus = data.tradingStatus;
          }
          
          // Set online status
          this.isOnline = true;
          this.lastUpdateTime = new Date().toLocaleTimeString();
        });
        
        // Handle connection/disconnection
        this.socket.on('connect', () => {
          this.isOnline = true;
          this.socketConnected = true;
          console.log('WebSocket connected for StatusPanel');
          this.stopStatusPolling(); // Stop polling if it was active
          this.lastUpdateTime = new Date().toLocaleTimeString() + ' (connected)';
        });
        
        this.socket.on('disconnect', (reason) => {
          this.isOnline = false;
          this.socketConnected = false;
          console.warn('WebSocket disconnected for StatusPanel. Reason:', reason);
          this.startStatusPolling(); // Start polling on disconnect
          this.lastUpdateTime = new Date().toLocaleTimeString() + ' (disconnected)';
        });
        
        // Handle connection error
        this.socket.on('connect_error', (error) => {
          this.isOnline = false;
          this.socketConnected = false;
          console.error('WebSocket connection error for StatusPanel:', error);
          this.startStatusPolling(); // Start polling on error
          this.lastUpdateTime = new Date().toLocaleTimeString() + ' (error)';
        });
      } catch (error) {
        console.error('Error initializing WebSocket for StatusPanel:', error);
        this.startStatusPolling(); // Start polling if initialization fails
      }
    },
    
    // Start polling if WebSocket fails
    startStatusPolling() {
      // Check if polling is enabled (with fallback to true if not set)
      const enableFallback = import.meta.env.VITE_ENABLE_FALLBACK_POLLING;
      if (!enableFallback) return;
      
      console.log('Starting status polling fallback');
      
      // Clear any existing interval
      this.clearStatusInterval();
      
      // Set up status polling interval
      const interval = parseInt(import.meta.env.VITE_STATUS_REFRESH_INTERVAL);
      this.statusInterval = setInterval(() => {
        this.fetchStatus();
      }, interval);
      
      // Fetch immediately
      this.fetchStatus();
    },
    
    // Stop polling when WebSocket reconnects
    stopStatusPolling() {
      if (this.statusInterval) {
        clearInterval(this.statusInterval);
        this.statusInterval = null;
        console.log('Status polling stopped, WebSocket connected');
      }
    },
    
    // Set up interval to refresh status
    setupStatusInterval() {
      const interval = parseInt(import.meta.env.VITE_STATUS_REFRESH_INTERVAL);
      this.statusInterval = setInterval(() => {
        if (!this.socketConnected) {
          this.fetchStatus();
        }
      }, interval);
    },
    
    // Clear status refresh interval
    clearStatusInterval() {
      if (this.statusInterval) {
        clearInterval(this.statusInterval);
        this.statusInterval = null;
      }
    },
    
    // Restart WebSockets
    async restartWebSockets() {
      this.isLoading = true;
      try {
        const response = await api.restartWebSockets();
        console.log('WebSockets restarted:', response.data);
        
        // Refresh status after restart
        setTimeout(() => {
          this.fetchStatus();
        }, 2000);
        
        this.lastUpdateTime = new Date().toLocaleTimeString() + ' (restarted)';
      } catch (error) {
        console.error('Error restarting WebSockets:', error);
      } finally {
        this.isLoading = false;
      }
    },
    
    // Send test notification
    async sendTestNotification() {
      if (!this.testMessage) return;
      
      this.isSendingNotification = true;
      try {
        const response = await api.sendTestNotification(this.testMessage);
        console.log('Test notification sent:', response.data);
        
        // Clear message on success
        this.testMessage = '';
      } catch (error) {
        console.error('Error sending test notification:', error);
      } finally {
        this.isSendingNotification = false;
      }
    },
    
    // Disconnect from WebSocket
    disconnectFromWebSocket() {
      if (this.socket) {
        // Remove all event listeners
        this.socket.off('statusUpdate');
        this.socket.off('connect');
        this.socket.off('disconnect');
        this.socket.off('connect_error');
        
        // Disconnect socket
        this.socket.disconnect();
        this.socket = null;
        this.socketConnected = false;
      }
    }
  }
};
</script>

<style scoped>
.status-panel {
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  margin-bottom: 20px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  background-color: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.panel-header h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.status-indicator {
  padding: 5px 10px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  background-color: #f1f5f9;
  color: #64748b;
}

.status-online {
  background-color: #dcfce7;
  color: #15803d;
}

.status-error {
  background-color: #fee2e2;
  color: #dc2626;
}

.panel-content {
  padding: 20px;
}

.loading {
  text-align: center;
  padding: 20px;
  color: #64748b;
}

.status-section {
  margin-bottom: 30px;
}

.status-section h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 15px 0;
  color: #334155;
}

.empty-state {
  padding: 20px;
  text-align: center;
  background-color: #f8fafc;
  border-radius: 6px;
  color: #64748b;
  font-style: italic;
  margin-bottom: 15px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 15px;
}

.ws-status-item {
  background-color: #f8fafc;
  border-radius: 6px;
  padding: 10px;
  display: flex;
  flex-direction: column;
}

.ws-status-item .symbol {
  font-weight: 500;
  margin-bottom: 5px;
}

.connection-status {
  font-size: 12px;
  font-weight: 500;
  padding: 3px 6px;
  border-radius: 4px;
  align-self: flex-start;
}

.status-connected {
  background-color: #dcfce7;
  color: #15803d;
}

.status-reconnecting {
  background-color: #fef9c3;
  color: #854d0e;
}

.status-error, .status-closed {
  background-color: #fee2e2;
  color: #dc2626;
}

.trading-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 15px;
  margin-bottom: 15px;
}

.trading-status-item {
  background-color: #f8fafc;
  border-radius: 6px;
  padding: 15px;
}

.pair-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.pair-name {
  font-weight: 600;
}

.trading-active {
  font-size: 12px;
  font-weight: 500;
  padding: 3px 6px;
  border-radius: 4px;
  background-color: #f1f5f9;
  color: #64748b;
}

.trading-active.active {
  background-color: #dcfce7;
  color: #15803d;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 14px;
}

.detail-label {
  color: #64748b;
}

.detail-value {
  font-weight: 500;
}

.connection-status-section {
  background-color: #f8fafc;
  border-radius: 6px;
  padding: 15px;
}

.connection-info {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.connection-type, .last-update {
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-button {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.action-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.restart-btn {
  background-color: #93c5fd;
  color: #1e40af;
}

.restart-btn:hover:not(:disabled) {
  background-color: #60a5fa;
}

.notification-test {
  display: flex;
  gap: 10px;
}

.notification-input {
  flex: 1;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
}

.notification-btn {
  background-color: #c4b5fd;
  color: #5b21b6;
  flex: 0 0 auto;
}

.notification-btn:hover:not(:disabled) {
  background-color: #a78bfa;
}
</style>