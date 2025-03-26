<template>
  <div>
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
import axios from 'axios';

export default {
  name: 'Dashboard',
  components: {
    CryptoCard
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
        // In Phase 1, we'll use hardcoded data instead of making an API call
        // In later phases, this will be replaced with a real API call
        this.tradingPairs = [
          { id: 1, symbol: 'BTCUSDT', displayName: 'BTC/USDT', logoUrl: '/placeholder.png' },
          { id: 2, symbol: 'SOLUSDT', displayName: 'SOL/USDT', logoUrl: '/placeholder.png' },
          { id: 3, symbol: 'XRPUSDT', displayName: 'XRP/USDT', logoUrl: '/placeholder.png' },
          { id: 4, symbol: 'PENDLEUSDT', displayName: 'PENDLE/USDT', logoUrl: '/placeholder.png' },
          { id: 5, symbol: 'DOGEUSDT', displayName: 'DOGE/USDT', logoUrl: '/placeholder.png' },
          { id: 6, symbol: 'NEARUSDT', displayName: 'NEAR/USDT', logoUrl: '/placeholder.png' }
        ];
        this.loading = false;
      } catch (error) {
        this.error = error.message;
        this.loading = false;
        console.error('Error fetching trading pairs:', error);
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