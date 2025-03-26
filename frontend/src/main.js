import Vue from 'vue';
import App from './App.vue';
import store from './store';
import api from './services/api';

// Make API available in all components
Vue.prototype.$api = api;

// Configure Vue
Vue.config.productionTip = false;

// Format filters
Vue.filter('formatPrice', (value) => {
  if (!value) return '0.00';
  return parseFloat(value).toFixed(2);
});

Vue.filter('formatQuantity', (value) => {
  if (!value) return '0.00000000';
  return parseFloat(value).toFixed(8);
});

Vue.filter('formatDate', (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString();
});

// Create Vue instance
new Vue({
  store,
  render: h => h(App)
}).$mount('#app');