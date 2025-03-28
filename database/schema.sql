-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    type ENUM('BUY', 'SELL') NOT NULL,
    price DECIMAL(18, 8) NOT NULL,
    quantity DECIMAL(18, 8) NOT NULL,
    investment DECIMAL(18, 2) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol),
    INDEX idx_timestamp (timestamp)
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

-- Create configuration table
CREATE TABLE IF NOT EXISTS configuration (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    investment_preset DECIMAL(8, 2) NOT NULL DEFAULT 50.00,
    buy_threshold DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
    sell_threshold DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
    active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol),
    INDEX idx_active (active)
);

-- Insert default configuration for supported trading pairs
INSERT INTO configuration (symbol, investment_preset, buy_threshold, sell_threshold, active)
VALUES 
    ('BTCUSDT', 50.00, 5.00, 5.00, false),
    ('SOLUSDT', 50.00, 5.00, 5.00, false),
    ('XRPUSDT', 50.00, 5.00, 5.00, false),
    ('PENDLEUSDT', 50.00, 5.00, 5.00, false),
    ('DOGEUSDT', 50.00, 5.00, 5.00, false),
    ('NEARUSDT', 50.00, 5.00, 5.00, false)
ON DUPLICATE KEY UPDATE 
    investment_preset = VALUES(investment_preset),
    buy_threshold = VALUES(buy_threshold),
    sell_threshold = VALUES(sell_threshold);