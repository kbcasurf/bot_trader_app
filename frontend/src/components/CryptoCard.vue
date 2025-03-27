<template>
  <div class="crypto-card" :class="{'card-inactive': !socketConnected}">
    <div class="crypto-card-header">
      <img :src="logoPath" :alt="tradingPair.displayName" class="crypto-logo">
      <div class="name-price">
        <h3 class="crypto-name">{{ tradingPair.displayName }}</h3>
        <div class="price-display" v-if="socketConnected">
          <span :class="{'price-up': priceChange > 0, 'price-down': priceChange < 0}">
            ${{ currentPrice.toFixed(2) }}
          </span>
          <small :class="{'price-up': priceChange > 0, 'price-down': priceChange < 0}">
            {{ priceChange > 0 ? '+' : '' }}{{ priceChange.toFixed(2) }}
          </small>
        </div>
        <div class="price-display" v-else>
          <span class="price-unavailable">Price unavailable</span>
        </div>
      </div>
    </div>

    <div class="connection-status">
      <span class="status-indicator" :class="{ 'status-connected': socketConnected, 'status-disconnected': !socketConnected }">
        {{ socketConnected ? 'WebSocket Connected' : 'WebSocket Disconnected' }}
      </span>
      <span class="last-update" v-if="socketConnected">
        Last update: {{ lastUpdateTime }}
      </span>
    </div>

    <div class="crypto-stats">
      <div class="stat-row">
        <span class="stat-label">Holdings:</span>
        <span class="stat-value">{{ holdings.quantity || 0 }} {{ tradingPair.symbol.replace('USDT', '') }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Avg. Buy Price:</span>
        <span class="stat-value">${{ holdings.averageBuyPrice ? holdings.averageBuyPrice.toFixed(2) : '0.00' }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Current Value:</span>
        <span class="stat-value">${{ currentValue.toFixed(2) }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Profit/Loss:</span>
        <span class="stat-value" :class="{'profit-positive': profitLoss > 0, 'profit-negative': profitLoss < 0}">
          {{ profitLoss > 0 ? '+' : '' }}{{ profitLoss.toFixed(2) }}%
        </span>
      </div>
      <div class="stat-row" v-if="tradingStatus">
        <span class="stat-label">Trading Status:</span>
        <span class="status-indicator" :class="{ 'status-active': tradingStatus.active }">
          {{ tradingStatus.active ? 'Active' : 'Inactive' }}
        </span>
      </div>
    </div>

    <div class="profit-bar">
      <div 
        class="profit-indicator" 
        :class="{'profit-positive': profitLoss > 0, 'profit-negative': profitLoss < 0}"
        :style="{width: `${Math.min(Math.abs(profitLoss), 100)}%`}"
      ></div>
    </div>

    <div class="investment-control" v-if="!hasHoldings">
      <label for="investment-amount">Investment Amount (USDT)</label>
      <input 
        id="investment-amount" 
        type="number" 
        v-model="investmentAmount" 
        min="10" 
        max="1000" 
        step="10" 
        class="investment-input"
      >
      <div class="slider-container">
        <input 
          type="range" 
          v-model="investmentAmount" 
          min="10" 
          max="1000" 
          step="10" 
          class="slider"
        >
      </div>
      <div class="presets">
        <button 
          v-for="preset in presets" 
          :key="preset" 
          @click="investmentAmount = preset"
          class="preset-btn"
          :class="{active: investmentAmount === preset}"
        >
          ${{ preset }}
        </button>
      </div>
    </div>

    <div class="action-container">
      <button 
        v-if="hasHoldings" 
        @click="handleSellAll" 
        class="action-button sell-btn"
        :disabled="isLoading || !socketConnected"
      >
        <span v-if="isLoading">Processing...</span>
        <span v-else-if="!socketConnected">Waiting for connection...</span>
        <span v-else>Sell All</span>
      </button>
      <button 
        v-else 
        @click="handleBuy" 
        class="action-button purchase-btn"
        :disabled="isLoading || !socketConnected"
      >
        <span v-if="isLoading">Processing...</span>
        <span v-else-if="!socketConnected">Waiting for connection...</span>
        <span v-else>Buy for ${{ investmentAmount }}</span>
      </button>
      
      <div class="websocket-warning" v-if="!socketConnected">
        <i class="warning-icon">⚠️</i>
        <span>WebSocket disconnected. Trading unavailable until connection is restored.</span>
      </div>
    </div>

    <div class="transaction-history" v-if="transactions.length > 0">
      <h4>Recent Transactions</h4>
      <div v-for="transaction in recentTransactions" :key="transaction.id" class="transaction-item">
        <span :class="{'transaction-buy': transaction.type === 'BUY', 'transaction-sell': transaction.type === 'SELL'}">
          {{ transaction.type }}
        </span>
        <span>{{ formatDate(transaction.timestamp) }}</span>
        <span>${{ transaction.price.toFixed(2) }}</span>
        <span>{{ transaction.quantity.toFixed(6) }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { api } from '../utils/api.js';
import { io } from 'socket.io-client';

export default {
  name: 'CryptoCard',
  props: {
    tradingPair: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      currentPrice: 0,
      lastPrice: 0,
      holdings: {
        quantity: 0,
        averageBuyPrice: 0,
        lastBuyPrice: 0
      },
      transactions: [],
      investmentAmount: 50,
      presets: [25, 50, 100, 250, 500],
      isLoading: false,
      tradingStatus: null,
      socket: null,
      socketConnected: false,
      lastUpdateTime: 'Never',
      priceUpdateCount: 0,
      reconnectAttempts: 0
    };
  },
  computed: {
    hasHoldings() {
      return this.holdings.quantity > 0;
    },
    currentValue() {
      if (!this.socketConnected || !this.currentPrice) {
        return this.holdings.quantity * (this.holdings.averageBuyPrice || 0);
      }
      return this.holdings.quantity * this.currentPrice;
    },
    profitLoss() {
      if (!this.holdings.averageBuyPrice || this.holdings.averageBuyPrice === 0 || !this.currentPrice) {
        return 0;
      }
      return ((this.currentPrice - this.holdings.averageBuyPrice) / this.holdings.averageBuyPrice) * 100;
    },
    priceChange() {
      if (!this.lastPrice || this.lastPrice === 0 || !this.currentPrice) {
        return 0;
      }
      return this.currentPrice - this.lastPrice;
    },
    logoPath() {
      try {
        return new URL(`../assets/logos/${this.tradingPair.symbol.toLowerCase().replace('usdt', '')}.svg`, import.meta.url).href;
      } catch (error) {
        return new URL('../assets/logos/generic.svg', import.meta.url).href;
      }
    },
    recentTransactions() {
      return this.transactions.slice(0, 5);
    }
  },
  created() {
    this.fetchInitialData();
    this.connectToWebSocket();
  },
  beforeUnmount() {
    this.disconnectFromWebSocket();
  },
  methods: {
    async fetchInitialData() {
      try {
        await this.fetchHoldings();
        await this.fetchTransactions();
        await this.fetchTradingStatus();
      } catch (error) {
        console.error(`Error fetching initial data for ${this.tradingPair.symbol}:`, error);
      }
    },
    
    async fetchTradingStatus() {
      try {
        const response = await api.getTradingStatus();
        const allStatuses = response.data;
        
        // Find the status for this trading pair
        const pairStatus = allStatuses.find(status => status.id === this.tradingPair.id);
        if (pairStatus) {
          this.tradingStatus = {
            active: pairStatus.active || false,
            initialInvestment: pairStatus.initial_investment || 0
          };
        }
      } catch (error) {
        console.error(`Error fetching trading status for ${this.tradingPair.symbol}:`, error);
      }
    },
    
    connectToWebSocket() {
      // Get WebSocket URL from environment or construct it based on API URL
      const wsUrl = import.meta.env.VITE_WEBSOCKET_URL;
      
      try {
        console.log(`Connecting to WebSocket at ${wsUrl} for ${this.tradingPair.symbol}`);
        
        // Initialize socket with explicit URL
        this.socket = io(wsUrl, {
          transports: ['websocket', 'polling'],
          reconnectionAttempts: 5,
          reconnectionDelay: 1000
        });
        
        // Handle connection events
        this.socket.on('connect', () => {
          console.log(`WebSocket connected for ${this.tradingPair.symbol}`);
          this.socketConnected = true;
          this.reconnectAttempts = 0;
          this.lastUpdateTime = this.formatTime(new Date());
          
          // Subscribe to this trading pair's updates
          this.socket.emit('subscribeTradingPair', this.tradingPair.id);
        });
        
        // Handle global WebSocket status updates
        this.socket.on('websocketStatus', (status) => {
          this.socketConnected = status.status === 'connected';
          if (status.lastMessageTime) {
            this.lastUpdateTime = this.formatTime(new Date(status.lastMessageTime));
          }
        });
        
        // Handle price updates
        this.socket.on('priceUpdate', (data) => {
          if (data.symbol === this.tradingPair.symbol) {
            this.lastPrice = this.currentPrice;
            this.currentPrice = data.price;
            this.lastUpdateTime = this.formatTime(new Date());
            this.priceUpdateCount++;
            this.socketConnected = true;
            console.log(`Price update for ${this.tradingPair.symbol}: ${data.price}`);
          }
        });
        
        // Handle transaction updates
        this.socket.on('transactionUpdate', (data) => {
          if (data.tradingPairId === this.tradingPair.id) {
            // Add the new transaction to our list
            const transaction = data.transaction;
            this.transactions = [transaction, ...this.transactions].slice(0, 20); // Keep last 20
            
            // Update holdings
            if (data.holdings) {
              this.holdings = data.holdings;
            }
          }
        });
        
        // Handle trading status updates
        this.socket.on('tradingStatusUpdate', (data) => {
          if (data.tradingPairId === this.tradingPair.id) {
            this.tradingStatus = data.status;
          }
        });
        
        // Handle connection errors
        this.socket.on('connect_error', (error) => {
          console.error(`WebSocket connection error for ${this.tradingPair.symbol}:`, error);
          this.socketConnected = false;
          this.reconnectAttempts++;
        });
        
        // Handle disconnect
        this.socket.on('disconnect', (reason) => {
          console.warn(`WebSocket disconnected for ${this.tradingPair.symbol}. Reason: ${reason}`);
          this.socketConnected = false;
        });
      } catch (error) {
        console.error(`Error initializing WebSocket for ${this.tradingPair.symbol}:`, error);
        this.socketConnected = false;
      }
    },
    
    disconnectFromWebSocket() {
      if (this.socket) {
        // Unsubscribe from this trading pair
        this.socket.emit('unsubscribeTradingPair', this.tradingPair.id);
        
        // Remove all listeners
        this.socket.off('priceUpdate');
        this.socket.off('transactionUpdate');
        this.socket.off('tradingStatusUpdate');
        this.socket.off('websocketStatus');
        this.socket.off('connect_error');
        this.socket.off('disconnect');
        
        // Disconnect socket
        this.socket.disconnect();
        this.socketConnected = false;
      }
    },
    
    async fetchHoldings() {
      try {
        const response = await api.getHoldings(this.tradingPair.id);
        this.holdings = response.data;
        
        // If we got a price from the API (which comes from WebSocket), update our local price
        if (response.data.currentPrice) {
          this.lastPrice = this.currentPrice;
          this.currentPrice = response.data.currentPrice;
        }
      } catch (error) {
        console.error(`Error fetching holdings for ${this.tradingPair.symbol}:`, error);
      }
    },
    
    async fetchTransactions() {
      try {
        const response = await api.getTransactions(this.tradingPair.id);
        this.transactions = response.data;
      } catch (error) {
        console.error(`Error fetching transactions for ${this.tradingPair.symbol}:`, error);
      }
    },
    
    async handleBuy() {
      if (this.isLoading || !this.socketConnected) return;
      
      if (!this.currentPrice) {
        alert('Cannot execute buy order: No price data available from WebSocket.');
        return;
      }
      
      this.isLoading = true;
      try {
        await api.makeFirstPurchase(this.tradingPair.id, this.investmentAmount);
        // Refresh data after purchase
        await this.fetchHoldings();
        await this.fetchTransactions();
        await this.fetchTradingStatus();
      } catch (error) {
        console.error('Error making purchase:', error);
        alert('Failed to make purchase. Please try again when the WebSocket connection is established.');
      } finally {
        this.isLoading = false;
      }
    },
    
    async handleSellAll() {
      if (this.isLoading || !this.socketConnected) return;
      
      if (!this.currentPrice) {
        alert('Cannot execute sell order: No price data available from WebSocket.');
        return;
      }
      
      this.isLoading = true;
      try {
        await api.sellAll(this.tradingPair.id);
        // Refresh data after selling
        await this.fetchHoldings();
        await this.fetchTransactions();
        await this.fetchTradingStatus();
      } catch (error) {
        console.error('Error selling holdings:', error);
        alert('Failed to sell holdings. Please try again when the WebSocket connection is established.');
      } finally {
        this.isLoading = false;
      }
    },
    
    formatDate(dateString) {
      const date = new Date(dateString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },
    
    formatTime(date) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }
};
</script>

<style scoped>
.crypto-card {
  background-color: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  transition: transform 0.2s, box-shadow 0.2s;
  position: relative;
  overflow: hidden;
}

.crypto-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.card-inactive {
  opacity: 0.9;
  position: relative;
}

.card-inactive::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background-color: #ef4444;
}

.crypto-card-header {
  display: flex;
  align-items: center;
  margin-bottom: 15px;
}

.crypto-logo {
  width: 40px;
  height: 40px;
  margin-right: 15px;
  border-radius: 50%;
  background-color: #f8fafc;
  padding: 5px;
}

.name-price {
  flex: 1;
}

.crypto-name {
  font-size: 18px;
  font-weight: 500;
  margin: 0 0 4px 0;
}

.price-display {
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}

.price-display small {
  font-size: 12px;
  font-weight: 600;
}

.price-up {
  color: #10b981;
}

.price-down {
  color: #ef4444;
}

.price-unavailable {
  color: #64748b;
  font-style: italic;
  font-size: 16px;
  font-weight: normal;
}

.connection-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  font-size: 12px;
}

.status-indicator {
  font-size: 12px;
  font-weight: 500;
  padding: 3px 6px;
  border-radius: 4px;
  background-color: #f1f5f9;
  color: #64748b;
}

.status-connected {
  background-color: #dcfce7;
  color: #15803d;
}

.status-disconnected {
  background-color: #fee2e2;
  color: #dc2626;
}

.status-active {
  background-color: #dcfce7;
  color: #15803d;
}

.last-update {
  color: #64748b;
  font-size: 11px;
}

.crypto-stats {
  margin-bottom: 20px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.stat-label {
  color: #64748b;
}

.stat-value {
  font-weight: 500;
}

.profit-positive {
  color: #10b981;
}

.profit-negative {
  color: #ef4444;
}

.investment-control {
  margin-bottom: 20px;
}

.investment-input {
  width: 100%;
  padding: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  margin-top: 5px;
  font-size: 16px;
}

.slider-container {
  margin: 10px 0;
}

.slider {
  width: 100%;
  height: 5px;
}

.presets {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
}

.preset-btn {
  background-color: #f1f5f9;
  border: none;
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.preset-btn:hover {
  background-color: #e2e8f0;
}

.preset-btn.active {
  background-color: #0ea5e9;
  color: white;
}

.action-container {
  margin-bottom: 15px;
}

.action-button {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  margin-bottom: 10px;
  transition: background-color 0.2s;
}

.action-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.purchase-btn {
  background-color: #10b981;
  color: white;
}

.purchase-btn:hover:not(:disabled) {
  background-color: #059669;
}

.sell-btn {
  background-color: #ef4444;
  color: white;
}

.sell-btn:hover:not(:disabled) {
  background-color: #dc2626;
}

.websocket-warning {
  background-color: #fee2e2;
  color: #b91c1c;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.warning-icon {
  font-size: 14px;
}

.profit-bar {
  height: 8px;
  background-color: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 15px;
}

.profit-indicator {
  height: 100%;
  transition: width 0.3s ease;
}

.transaction-history {
  max-height: 200px;
  overflow-y: auto;
  border-top: 1px solid #e5e7eb;
  padding-top: 15px;
}

.transaction-history h4 {
  margin-bottom: 10px;
  font-weight: 500;
  color: #4b5563;
}

.transaction-item {
  padding: 8px 0;
  border-bottom: 1px solid #f1f5f9;
  font-size: 14px;
  display: flex;
  justify-content: space-between;
}

.transaction-buy {
  color: #10b981;
  font-weight: 600;
}

.transaction-sell {
  color: #ef4444;
  font-weight: 600;
}

@media (max-width: 640px) {
  .crypto-card-header {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .crypto-logo {
    margin-bottom: 10px;
  }
  
  .price-display {
    margin-top: 5px;
  }
}
</style>