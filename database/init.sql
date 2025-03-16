-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS bot_trader;
USE bot_trader;

-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  initial_investment DECIMAL(15, 8) NOT NULL,
  total_invested DECIMAL(15, 8) NOT NULL,
  total_quantity DECIMAL(15, 8) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_active_symbol (symbol, active)
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  side ENUM('buy', 'sell') NOT NULL,
  price DECIMAL(15, 8) NOT NULL,
  quantity DECIMAL(15, 8) NOT NULL,
  total DECIMAL(15, 8) NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  key VARCHAR(50) NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_key (key)
);

-- Insert default settings
INSERT IGNORE INTO settings (key, value) VALUES
  ('profit_threshold', '5'),
  ('loss_threshold', '5'),
  ('additional_purchase_amount', '50'),
  ('max_investment_per_symbol', '200');