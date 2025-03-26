<template>
  <div class="app-container">
    <header class="app-header">
      <h1>Crypto Trading Bot</h1>
    </header>
    <main>
      <Dashboard />
    </main>
    <footer class="app-footer">
      <p>© 2025 Crypto Trading Bot - v0.1.0</p>
    </footer>
  </div>
</template>

<script>
import Dashboard from './components/Dashboard.vue';

export default {
  name: 'App',
  components: {
    Dashboard
  }
};
</script>

<style>
.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  background-color: #1e293b;
  color: white;
  padding: 1rem;
  text-align: center;
}

.app-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

main {
  flex: 1;
  padding: 1rem;
}

.app-footer {
  background-color: #1e293b;
  color: white;
  padding: 0.5rem;
  text-align: center;
  font-size: 0.8rem;
}
</style>