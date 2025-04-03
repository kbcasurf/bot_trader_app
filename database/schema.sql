-- File: database/schema.sql
-- Complete updated schema with trading algorithm enhancements

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    type ENUM('BUY', 'SELL') NOT NULL,
    price DECIMAL(18, 8) NOT NULL,
    quantity DECIMAL(18, 8) NOT NULL,
    investment DECIMAL(18, 2) NOT NULL,
    automated BOOLEAN NOT NULL DEFAULT false,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol),
    INDEX idx_timestamp (timestamp),
    INDEX idx_symbol_timestamp (symbol, timestamp),
    INDEX idx_symbol_type (symbol, type)
);

-- Create holdings table
CREATE TABLE IF NOT EXISTS holdings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    quantity DECIMAL(18, 8) NOT NULL DEFAULT 0,
    avg_price DECIMAL(18, 8) NOT NULL DEFAULT 0,
    initial_purchase_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol)
);

-- Create reference_prices table to track trading thresholds
CREATE TABLE IF NOT EXISTS reference_prices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    initial_purchase_price DECIMAL(18, 8) NOT NULL DEFAULT 0,
    last_purchase_price DECIMAL(18, 8) NOT NULL DEFAULT 0,
    last_sell_price DECIMAL(18, 8) NOT NULL DEFAULT 0,
    next_buy_threshold DECIMAL(18, 8) NOT NULL DEFAULT 0,
    next_sell_threshold DECIMAL(18, 8) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol)
);

-- Create configuration table
CREATE TABLE IF NOT EXISTS configuration (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    investment_preset DECIMAL(8, 2) NOT NULL DEFAULT 50.00,
    buy_threshold DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
    sell_threshold DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
    buy_threshold_percent DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
    sell_threshold_percent DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
    additional_purchase_amount DECIMAL(8, 2) NOT NULL DEFAULT 50.00,
    active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol),
    INDEX idx_active (active)
);

-- Insert default configuration for supported trading pairs
INSERT INTO configuration (symbol, investment_preset, buy_threshold, sell_threshold, buy_threshold_percent, sell_threshold_percent, additional_purchase_amount, active)
VALUES 
    ('BTCUSDT', 50.00, 5.00, 5.00, 5.00, 5.00, 50.00, false),
    ('SOLUSDT', 50.00, 5.00, 5.00, 5.00, 5.00, 50.00, false),
    ('XRPUSDT', 50.00, 5.00, 5.00, 5.00, 5.00, 50.00, false),
    ('PENDLEUSDT', 50.00, 5.00, 5.00, 5.00, 5.00, 50.00, false),
    ('DOGEUSDT', 50.00, 5.00, 5.00, 5.00, 5.00, 50.00, false),
    ('NEARUSDT', 50.00, 5.00, 5.00, 5.00, 5.00, 50.00, false)
ON DUPLICATE KEY UPDATE 
    investment_preset = VALUES(investment_preset),
    buy_threshold = VALUES(buy_threshold),
    sell_threshold = VALUES(sell_threshold),
    buy_threshold_percent = VALUES(buy_threshold_percent),
    sell_threshold_percent = VALUES(sell_threshold_percent),
    additional_purchase_amount = VALUES(additional_purchase_amount);

-- Insert default records for supported trading pairs in reference_prices
INSERT INTO reference_prices (symbol, initial_purchase_price, last_purchase_price, last_sell_price, next_buy_threshold, next_sell_threshold)
VALUES 
    ('BTCUSDT', 0, 0, 0, 0, 0),
    ('SOLUSDT', 0, 0, 0, 0, 0),
    ('XRPUSDT', 0, 0, 0, 0, 0),
    ('PENDLEUSDT', 0, 0, 0, 0, 0),
    ('DOGEUSDT', 0, 0, 0, 0, 0),
    ('NEARUSDT', 0, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE 
    updated_at = CURRENT_TIMESTAMP;

-- Create helper views
CREATE OR REPLACE VIEW latest_transactions AS
SELECT t1.*
FROM transactions t1
JOIN (
    SELECT symbol, MAX(timestamp) as max_time
    FROM transactions
    GROUP BY symbol
) t2 ON t1.symbol = t2.symbol AND t1.timestamp = t2.max_time;

CREATE OR REPLACE VIEW latest_buy_transactions AS
SELECT t1.*
FROM transactions t1
JOIN (
    SELECT symbol, MAX(timestamp) as max_time
    FROM transactions
    WHERE type = 'BUY'
    GROUP BY symbol
) t2 ON t1.symbol = t2.symbol AND t1.timestamp = t2.max_time;

CREATE OR REPLACE VIEW first_buy_transactions AS
SELECT t1.*
FROM transactions t1
JOIN (
    SELECT symbol, MIN(timestamp) as min_time
    FROM transactions
    WHERE type = 'BUY'
    GROUP BY symbol
) t2 ON t1.symbol = t2.symbol AND t1.timestamp = t2.min_time;