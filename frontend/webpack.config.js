const webpack = require('webpack');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
const env = dotenv.config({ path: path.resolve(__dirname, '../.env') }).parsed || {};

// Create a new webpack.DefinePlugin that will inject environment variables into the frontend code
const envKeys = Object.keys(env).reduce((prev, next) => {
  prev[`process.env.${next}`] = JSON.stringify(env[next]);
  return prev;
}, {});

module.exports = {
  // ... other webpack configuration ...
  plugins: [
    new webpack.DefinePlugin(envKeys)
  ]
};