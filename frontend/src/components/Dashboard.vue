<template>
  <div>
    <StatusPanel />
    
    <div v-if="loading" class="loading">Loading trading pairs...</div>
    <div v-else class="crypto-grid">
      <CryptoCard 
        v-for="pair in tradingPairs" 
        :key="pair.symbol" 
        :tradingPair="pair" 
      />
    </div>
  </div>
</template>

<script>
import CryptoCard from './CryptoCard.vue';
import StatusPanel from './StatusPanel.vue';
import { api } from '../utils/api';

export default {
  name: 'Dashboard',
  components: {
    CryptoCard,
    StatusPanel
  },
  data() {
    return {
      tradingPairs: [],
      loading: true,
      error: null
    };
  },
  created() {
    this.fetchTradingPairs();
  },
  methods: {
    async fetchTradingPairs() {
      try {
        // In Phase 2, we use the real API endpoint
        const response = await api.getTradingPairs();
        this.tradingPairs = response.data;
        this.loading = false;
      } catch (error) {
        this.error = error.message;
        this.loading = false;
        console.error('Error fetching trading pairs:', error);
        
        // Fallback to hardcoded data if API fails
        this.tradingPairs = [
          { id: 1, symbol: 'BTCUSDT', displayName: 'BTC/USDT', logoUrl: '/assets/logos/btc.svg' },
          { id: 2, symbol: 'SOLUSDT', displayName: 'SOL/USDT', logoUrl: '/assets/logos/sol.svg' },
          { id: 3, symbol: 'XRPUSDT', displayName: 'XRP/USDT', logoUrl: '/assets/logos/xrp.svg' },
          { id: 4, symbol: 'PENDLEUSDT', displayName: 'PENDLE/USDT', logoUrl: '/assets/logos/pendle.svg' },
          { id: 5, symbol: 'DOGEUSDT', displayName: 'DOGE/USDT', logoUrl: '/assets/logos/doge.svg' },
          { id: 6, symbol: 'NEARUSDT', displayName: 'NEAR/USDT', logoUrl: '/assets/logos/near.svg' }
        ];
      }
    }
  }
}
</script>

<style scoped>
.loading {
  text-align: center;
  padding: 2rem;
  font-size: 1.2rem;
  color: #64748b;
}
</style>