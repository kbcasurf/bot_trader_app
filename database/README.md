# Database Configuration

This folder contains the database configuration for the Crypto Trading Bot application.

## Files

- `Dockerfile`: Configures the MariaDB container
- `my.cnf`: Custom MySQL configuration
- `init.sql`: Database initialization script that creates the necessary tables and default settings

## Database Schema

The database consists of the following tables:

### Sessions

Stores information about trading sessions:

- `id`: Unique identifier
- `symbol`: Trading pair symbol (e.g., BTCUSDT)
- `active`: Whether the session is active
- `initial_investment`: Initial investment amount
- `total_invested`: Total invested amount (including additional purchases)
- `total_quantity`: Total quantity of the cryptocurrency
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp

### Orders

Stores information about buy and sell orders:

- `id`: Unique identifier
- `session_id`: Reference to the session
- `symbol`: Trading pair symbol
- `side`: Buy or sell
- `price`: Price at the time of the order
- `quantity`: Quantity of the cryptocurrency
- `total`: Total amount in USD
- `timestamp`: Order timestamp

### Settings

Stores application settings:

- `id`: Unique identifier
- `key`: Setting key
- `value`: Setting value
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp

## Environment Variables

The database uses the following environment variables:

- `MARIADB_ROOT_PASSWORD`: Root password for MariaDB
- `MARIADB_DATABASE`: Database name
- `MARIADB_USER`: Database user
- `MARIADB_PASSWORD`: Database password