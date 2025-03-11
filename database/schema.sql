-- Create database
CREATE DATABASE IF NOT EXISTS crypto_bot;
USE crypto_bot;

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  side ENUM('BUY', 'SELL') NOT NULL,
  price DECIMAL(20, 8) NOT NULL,
  quantity DECIMAL(20, 8) NOT NULL,
  total DECIMAL(20, 8) NOT NULL,
  order_id VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  timestamp DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create trading sessions table
CREATE TABLE IF NOT EXISTS trading_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  initial_price DECIMAL(20, 8) NOT NULL,
  initial_amount DECIMAL(20, 8) NOT NULL,
  current_price DECIMAL(20, 8),
  total_invested DECIMAL(20, 8) NOT NULL,
  total_quantity DECIMAL(20, 8) NOT NULL,
  last_buy_price DECIMAL(20, 8) NOT NULL,
  last_sell_price DECIMAL(20, 8),
  profit_loss DECIMAL(20, 8) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_orders_symbol ON orders(symbol);
CREATE INDEX idx_orders_timestamp ON orders(timestamp);
CREATE INDEX idx_sessions_symbol ON trading_sessions(symbol);
CREATE INDEX idx_sessions_active ON trading_sessions(active);