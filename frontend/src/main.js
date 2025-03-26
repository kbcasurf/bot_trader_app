import { createApp } from 'vue';
import App from './App.vue';
import { createStore } from 'vuex';
import './assets/styles/main.css';

// Create a new store instance
const store = createStore({
  state() {
    return {
      tradingPairs: [],
      holdings: {},
      transactions: {},
      priceData: {}
    };
  },
  mutations: {
    setTradingPairs(state, pairs) {
      state.tradingPairs = pairs;
    },
    updateHoldings(state, { symbol, data }) {
      state.holdings[symbol] = data;
    },
    updateTransactions(state, { symbol, data }) {
      state.transactions[symbol] = data;
    },
    updatePriceData(state, { symbol, price }) {
      state.priceData[symbol] = price;
    }
  },
  actions: {
    async fetchTradingPairs({ commit }) {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/trading-pairs`);
        const data = await response.json();
        commit('setTradingPairs', data);
        return data;
      } catch (error) {
        console.error('Error fetching trading pairs:', error);
        return [];
      }
    },
    async fetchHoldings({ commit }, symbol) {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/holdings/${symbol}`);
        const data = await response.json();
        commit('updateHoldings', { symbol, data });
        return data;
      } catch (error) {
        console.error(`Error fetching holdings for ${symbol}:`, error);
        return null;
      }
    },
    async fetchTransactions({ commit }, symbol) {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/transactions/${symbol}`);
        const data = await response.json();
        commit('updateTransactions', { symbol, data });
        return data;
      } catch (error) {
        console.error(`Error fetching transactions for ${symbol}:`, error);
        return [];
      }
    }
  },
  getters: {
    getTradingPair: (state) => (symbol) => {
      return state.tradingPairs.find(pair => pair.symbol === symbol);
    },
    getHoldings: (state) => (symbol) => {
      return state.holdings[symbol] || null;
    },
    getTransactions: (state) => (symbol) => {
      return state.transactions[symbol] || [];
    },
    getCurrentPrice: (state) => (symbol) => {
      return state.priceData[symbol] || null;
    }
  }
});

createApp(App)
  .use(store)
  .mount('#app');