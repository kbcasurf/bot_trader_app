-- Create the trading_pairs table
CREATE TABLE trading_pairs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    display_name VARCHAR(50) NOT NULL,
    logo_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create the trading_configurations table
CREATE TABLE trading_configurations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trading_pair_id INT NOT NULL,
    initial_investment DECIMAL(10, 2) NOT NULL,
    active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (trading_pair_id) REFERENCES trading_pairs(id)
);

-- Create the transactions table
CREATE TABLE transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trading_pair_id INT NOT NULL,
    transaction_type ENUM('BUY', 'SELL') NOT NULL,
    quantity DECIMAL(20, 8) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    total_amount DECIMAL(20, 8) NOT NULL,
    binance_order_id VARCHAR(255),
    status ENUM('PENDING', 'COMPLETED', 'FAILED') DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (trading_pair_id) REFERENCES trading_pairs(id)
);

-- Create the holdings table
CREATE TABLE holdings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trading_pair_id INT NOT NULL,
    quantity DECIMAL(20, 8) NOT NULL DEFAULT 0,
    average_buy_price DECIMAL(20, 8),
    last_buy_price DECIMAL(20, 8),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (trading_pair_id) REFERENCES trading_pairs(id),
    UNIQUE KEY unique_trading_pair (trading_pair_id)
);

-- Create the price_history table
CREATE TABLE price_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trading_pair_id INT NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trading_pair_id) REFERENCES trading_pairs(id)
);