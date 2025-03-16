import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Log environment variables (excluding sensitive data)
console.log('Environment:', {
  API_URL: import.meta.env.VITE_API_URL,
  NODE_ENV: import.meta.env.MODE,
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);