-- Insert trading pairs
INSERT INTO trading_pairs (symbol, display_name, logo_url) VALUES
('BTCUSDT', 'BTC/USDT', '/assets/logos/btc.png'),
('SOLUSDT', 'SOL/USDT', '/assets/logos/sol.png'),
('XRPUSDT', 'XRP/USDT', '/assets/logos/xrp.png'),
('PENDLEUSDT', 'PENDLE/USDT', '/assets/logos/pendle.png'),
('DOGEUSDT', 'DOGE/USDT', '/assets/logos/doge.png'),
('NEARUSDT', 'NEAR/USDT', '/assets/logos/near.png');

-- Initialize holdings with zero quantity for all trading pairs
INSERT INTO holdings (trading_pair_id, quantity)
SELECT id, 0 FROM trading_pairs;