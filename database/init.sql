-- Create the trades table
CREATE TABLE IF NOT EXISTS trades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    type ENUM('buy', 'sell') NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_symbol ON trades(symbol);
CREATE INDEX idx_created_at ON trades(created_at);

-- Create a view for trade statistics
CREATE VIEW trade_stats AS
SELECT 
    symbol,
    COUNT(*) as total_trades,
    SUM(CASE WHEN type = 'buy' THEN amount ELSE 0 END) as total_bought,
    SUM(CASE WHEN type = 'sell' THEN amount ELSE 0 END) as total_sold,
    MIN(price) as min_price,
    MAX(price) as max_price
FROM trades
GROUP BY symbol;