-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS crypto_trading_bot;

-- Use the database
USE crypto_trading_bot;

-- Create user if it doesn't exist
CREATE USER IF NOT EXISTS 'trading_bot_user'@'%' IDENTIFIED BY 'mariadb_secret';

-- Grant privileges
GRANT ALL PRIVILEGES ON crypto_trading_bot.* TO 'trading_bot_user'@'%';
FLUSH PRIVILEGES;

-- Import schema.sql (this will be handled by Docker which will run schema.sql after this file)