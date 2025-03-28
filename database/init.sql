-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS ${DB_NAME};

-- Use the database
USE ${DB_NAME};

-- Create user if it doesn't exist
CREATE USER IF NOT EXISTS ${DB_USER}@'%' IDENTIFIED BY ${DB_PASSWORD};

-- Grant privileges
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO ${DB_USER}@'%';
FLUSH PRIVILEGES;