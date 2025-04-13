-- File: database/schema.sql
-- Complete updated schema with trading algorithm enhancements

-- Create trades table (used by the application)
CREATE TABLE IF NOT EXISTS trades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    action ENUM('buy', 'sell') NOT NULL,
    quantity DECIMAL(18, 8) NOT NULL,
    price DECIMAL(18, 8) NOT NULL,
    usdt_amount DECIMAL(18, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol),
    INDEX idx_created_at (created_at),
    INDEX idx_symbol_action (symbol, action)
);

-- Create reference_prices table to track trading thresholds
CREATE TABLE IF NOT EXISTS reference_prices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    first_transaction_price DECIMAL(18, 8) NOT NULL DEFAULT 0,
    last_transaction_price DECIMAL(18, 8) NOT NULL DEFAULT 0,
    next_buy_price DECIMAL(18, 8) NOT NULL DEFAULT 0,
    next_sell_price DECIMAL(18, 8) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol)
);

-- Create account_balances table to store current balances
CREATE TABLE IF NOT EXISTS account_balances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    balance DECIMAL(18, 8) NOT NULL DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
INSERT INTO reference_prices (symbol, first_transaction_price, last_transaction_price, next_buy_price, next_sell_price)
VALUES 
    ('BTC', 0, 0, 0, 0),
    ('SOL', 0, 0, 0, 0),
    ('XRP', 0, 0, 0, 0),
    ('PENDLE', 0, 0, 0, 0),
    ('DOGE', 0, 0, 0, 0),
    ('NEAR', 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE 
    updated_at = CURRENT_TIMESTAMP;

-- Create new helper views based on trades table instead of transactions
CREATE OR REPLACE VIEW latest_trades AS
SELECT t1.*
FROM trades t1
JOIN (
    SELECT symbol, MAX(created_at) as max_time
    FROM trades
    GROUP BY symbol
) t2 ON t1.symbol = t2.symbol AND t1.created_at = t2.max_time;

CREATE OR REPLACE VIEW latest_buy_trades AS
SELECT t1.*
FROM trades t1
JOIN (
    SELECT symbol, MAX(created_at) as max_time
    FROM trades
    WHERE action = 'buy'
    GROUP BY symbol
) t2 ON t1.symbol = t2.symbol AND t1.created_at = t2.max_time;

CREATE OR REPLACE VIEW first_buy_trades AS
SELECT t1.*
FROM trades t1
JOIN (
    SELECT symbol, MIN(created_at) as min_time
    FROM trades
    WHERE action = 'buy'
    GROUP BY symbol
) t2 ON t1.symbol = t2.symbol AND t1.created_at = t2.min_time;