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
    trade_time TIMESTAMP NOT NULL COMMENT 'Original timestamp from Binance when the trade was executed',
    binance_trade_id BIGINT NULL COMMENT 'Binance trade ID for reference and deduplication',
    INDEX idx_symbol (symbol),
    INDEX idx_trade_time (trade_time),
    INDEX idx_symbol_action (symbol, action),
    INDEX idx_binance_trade_id (binance_trade_id)
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
    SELECT symbol, MAX(trade_time) as max_time
    FROM trades
    GROUP BY symbol
) t2 ON t1.symbol = t2.symbol AND t1.trade_time = t2.max_time;

CREATE OR REPLACE VIEW latest_buy_trades AS
SELECT t1.*
FROM trades t1
JOIN (
    SELECT symbol, MAX(trade_time) as max_time
    FROM trades
    WHERE action = 'buy'
    GROUP BY symbol
) t2 ON t1.symbol = t2.symbol AND t1.trade_time = t2.max_time;

CREATE OR REPLACE VIEW first_buy_trades AS
SELECT t1.*
FROM trades t1
JOIN (
    SELECT symbol, MIN(trade_time) as min_time
    FROM trades
    WHERE action = 'buy'
    GROUP BY symbol
) t2 ON t1.symbol = t2.symbol AND t1.trade_time = t2.min_time;