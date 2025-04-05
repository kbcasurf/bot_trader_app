// backend/js/dbconns.js
// Database Connection Module
// Handles all database operations and connections

// Import required modules
const mariadb = require('mariadb');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Database configuration
const DB_CONFIG = {
    host: process.env.DB_HOST || 'database',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'trading_bot_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'crypto_trading_bot',
    connectionLimit: 10,
    idleTimeout: 60000, // Idle timeout - 60 seconds
    acquireTimeout: 30000, // Acquire timeout - 30 seconds
    connectTimeout: 20000, // Connect timeout - 20 seconds
    waitForConnections: true,
    queueLimit: 0 // No limit on queue size
};

// Create connection pool with optimal settings
let pool = null;

try {
    // Create connection pool
    pool = mariadb.createPool(DB_CONFIG);

    // Log pool creation
    console.log('Database connection pool created with configuration:', {
        host: DB_CONFIG.host,
        user: DB_CONFIG.user,
        database: DB_CONFIG.database,
        connectionLimit: DB_CONFIG.connectionLimit
    });

    // Register event handlers for pool
    pool.on('connection', (conn) => {
        console.log('New database connection established');
        
        conn.on('error', (err) => {
            console.error('Database connection error:', err);
        });
    });

    pool.on('acquire', () => {
        console.log('Database connection acquired from pool');
    });

    pool.on('release', () => {
        console.log('Database connection released back to pool');
    });
} catch (error) {
    console.error('Failed to create database connection pool:', error);
}

/**
 * Test database connection
 * @returns {Promise<boolean>} Connection status
 */
async function testConnection() {
    let conn;
    try {
        if (!pool) {
            throw new Error('Database connection pool not initialized');
        }
        
        conn = await pool.getConnection();
        console.log('Database connection test successful');
        const rows = await conn.query('SELECT 1 as test');
        return rows && rows.length > 0;
    } catch (err) {
        console.error('Database connection test failed:', err);
        return false;
    } finally {
        if (conn) {
            try {
                await conn.release();
                console.log('Test connection released');
            } catch (releaseError) {
                console.error('Error releasing test connection:', releaseError);
            }
        }
    }
}

/**
 * Execute a database query with proper error handling
 * @param {string} query - SQL query to execute
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
async function executeQuery(query, params = []) {
    let conn;
    try {
        if (!pool) {
            throw new Error('Database connection pool not initialized');
        }
        
        conn = await pool.getConnection();
        const result = await conn.query(query, params);
        return result;
    } catch (error) {
        console.error('Error executing query:', error);
        throw error;
    } finally {
        if (conn) {
            try {
                await conn.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
    }
}

/**
 * Get transactions for a specific symbol
 * @param {string} symbol - Cryptocurrency symbol (e.g. BTCUSDT)
 * @param {number} limit - Maximum number of transactions to return
 * @returns {Promise<Array>} Array of transaction objects
 */
async function getTransactions(symbol, limit = 30) {
    try {
        const query = `
            SELECT * FROM transactions 
            WHERE symbol = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        `;
        
        const rows = await executeQuery(query, [symbol, limit]);
        
        console.log(`Found ${rows.length} transactions for ${symbol}`);
        return rows;
    } catch (error) {
        console.error(`Error querying transactions for ${symbol}:`, error);
        return [];
    }
}

/**
 * Store a transaction in the database
 * @param {Object} transaction - Transaction data object
 * @param {string} transaction.symbol - Cryptocurrency symbol
 * @param {string} transaction.type - Transaction type (BUY or SELL)
 * @param {number} transaction.price - Transaction price
 * @param {number} transaction.quantity - Transaction quantity
 * @param {number} transaction.investment - Investment amount in USDT
 * @param {boolean} transaction.automated - Whether transaction was automated
 * @returns {Promise<boolean>} Success status
 */
async function storeTransaction(transaction) {
    try {
        // Validate input data
        if (!transaction.symbol || !transaction.type || 
            transaction.price === undefined || transaction.quantity === undefined) {
            console.error('Invalid transaction data:', transaction);
            return false;
        }

        // Insert transaction
        const query = `
            INSERT INTO transactions 
            (symbol, type, price, quantity, investment, automated) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const params = [
            transaction.symbol,
            transaction.type,
            transaction.price,
            transaction.quantity,
            transaction.investment || 0,
            transaction.automated || false
        ];
        
        await executeQuery(query, params);
        
        console.log(`Stored ${transaction.type} transaction for ${transaction.symbol}`);
        
        // Update holdings after transaction
        await updateHoldings(transaction.symbol);
        
        // Update reference prices if it's a BUY transaction
        if (transaction.type === 'BUY') {
            await updateReferencePrice(transaction.symbol, transaction.price);
        }
        
        return true;
    } catch (error) {
        console.error('Error storing transaction:', error);
        return false;
    }
}

/**
 * Get holdings for a specific symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @returns {Promise<Object>} Holdings data object
 */
async function getHoldings(symbol) {
    try {
        const query = `
            SELECT * FROM holdings 
            WHERE symbol = ?
        `;
        
        const rows = await executeQuery(query, [symbol]);
        
        return rows[0] || { 
            symbol, 
            quantity: 0, 
            avg_price: 0 
        };
    } catch (error) {
        console.error(`Error querying holdings for ${symbol}:`, error);
        return { 
            symbol, 
            quantity: 0, 
            avg_price: 0 
        };
    }
}

/**
 * Update holdings for a symbol based on all transactions
 * @param {string} symbol - Cryptocurrency symbol
 * @returns {Promise<Object>} Updated holdings data
 */
async function updateHoldings(symbol) {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get all transactions for the symbol
        const transactions = await conn.query(`
            SELECT * FROM transactions 
            WHERE symbol = ? 
            ORDER BY timestamp ASC
        `, [symbol]);
        
        // Calculate holdings
        let quantity = 0;
        let totalInvestment = 0;
        let avgPrice = 0;
        
        for (const tx of transactions) {
            if (tx.type === 'BUY') {
                // For buys, update the average price
                const oldValue = quantity * avgPrice;
                const newValue = parseFloat(tx.quantity) * parseFloat(tx.price);
                quantity += parseFloat(tx.quantity);
                totalInvestment += parseFloat(tx.investment || 0);
                
                if (quantity > 0) {
                    avgPrice = (oldValue + newValue) / quantity;
                }
            } else if (tx.type === 'SELL') {
                // For sells, reduce the quantity
                quantity -= parseFloat(tx.quantity);
                // If no holdings left, reset average price
                if (quantity <= 0) {
                    quantity = 0;
                    avgPrice = 0;
                    totalInvestment = 0;
                }
            }
        }
        
        // Update or insert holdings record
        await conn.query(`
            INSERT INTO holdings 
                (symbol, quantity, avg_price, last_updated) 
            VALUES 
                (?, ?, ?, NOW()) 
            ON DUPLICATE KEY UPDATE 
                quantity = VALUES(quantity), 
                avg_price = VALUES(avg_price),
                last_updated = NOW()
        `, [symbol, quantity, avgPrice]);
        
        console.log(`Updated holdings for ${symbol}: ${quantity} at avg price ${avgPrice}`);
        return { symbol, quantity, avg_price: avgPrice };
    } catch (error) {
        console.error(`Error updating holdings for ${symbol}:`, error);
        throw error;
    } finally {
        if (conn) {
            try {
                await conn.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
    }
}

/**
 * Get reference prices for a symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @returns {Promise<Object>} Reference prices object
 */
async function getReferencePrice(symbol) {
    try {
        const query = `
            SELECT * FROM reference_prices 
            WHERE symbol = ?
        `;
        
        const rows = await executeQuery(query, [symbol]);
        
        // Default values if no record exists
        return rows[0] || {
            symbol,
            initial_purchase_price: 0,
            last_purchase_price: 0,
            next_buy_threshold: 0,
            next_sell_threshold: 0
        };
    } catch (error) {
        console.error(`Error getting reference prices for ${symbol}:`, error);
        return {
            symbol,
            initial_purchase_price: 0,
            last_purchase_price: 0,
            next_buy_threshold: 0,
            next_sell_threshold: 0
        };
    }
}

/**
 * Update reference prices for a symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @param {number} currentPrice - Current price
 * @returns {Promise<Object>} Updated reference prices
 */
async function updateReferencePrice(symbol, currentPrice) {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get existing reference prices
        const existingPricesRows = await conn.query(`
            SELECT * FROM reference_prices 
            WHERE symbol = ?
        `, [symbol]);
        
        const existingPrices = existingPricesRows[0] || {
            initial_purchase_price: 0,
            last_purchase_price: 0,
            next_buy_threshold: 0,
            next_sell_threshold: 0
        };
        
        // Get configuration for this symbol
        const configRows = await conn.query(`
            SELECT * FROM configuration 
            WHERE symbol = ?
        `, [symbol]);
        
        // Default thresholds if no config exists
        const buyThresholdPercent = configRows[0]?.buy_threshold_percent || 5;
        const sellThresholdPercent = configRows[0]?.sell_threshold_percent || 5;
        
        // Calculate new reference prices
        const initialPrice = existingPrices.initial_purchase_price > 0 
            ? existingPrices.initial_purchase_price 
            : currentPrice;
        
        const nextBuyPrice = currentPrice * (1 - buyThresholdPercent / 100);
        const nextSellPrice = currentPrice * (1 + sellThresholdPercent / 100);
        
        // Update or insert reference prices
        await conn.query(`
            INSERT INTO reference_prices 
                (symbol, initial_purchase_price, last_purchase_price, next_buy_threshold, next_sell_threshold, updated_at) 
            VALUES 
                (?, ?, ?, ?, ?, NOW()) 
            ON DUPLICATE KEY UPDATE 
                initial_purchase_price = CASE WHEN initial_purchase_price = 0 THEN ? ELSE initial_purchase_price END,
                last_purchase_price = ?,
                next_buy_threshold = ?,
                next_sell_threshold = ?,
                updated_at = NOW()
        `, [
            symbol, initialPrice, currentPrice, nextBuyPrice, nextSellPrice,
            initialPrice, currentPrice, nextBuyPrice, nextSellPrice
        ]);
        
        console.log(`Updated reference prices for ${symbol}:
            Initial=${initialPrice}, 
            Last=${currentPrice}, 
            NextBuy=${nextBuyPrice}, 
            NextSell=${nextSellPrice}`
        );
        
        return {
            symbol,
            initial_purchase_price: initialPrice,
            last_purchase_price: currentPrice,
            next_buy_threshold: nextBuyPrice,
            next_sell_threshold: nextSellPrice
        };
    } catch (error) {
        console.error(`Error updating reference prices for ${symbol}:`, error);
        throw error;
    } finally {
        if (conn) {
            try {
                await conn.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
    }
}

/**
 * Get account balances from database
 * @returns {Promise<Array>} Array of balance objects
 */
async function getAccountBalance() {
    try {
        // Get all holdings
        const query = `SELECT * FROM holdings`;
        const holdings = await executeQuery(query);
        return holdings;
    } catch (error) {
        console.error('Error getting account balance:', error);
        return [];
    }
}

/**
 * Get all configuration data
 * @returns {Promise<Array>} Array of configuration objects
 */
async function getConfiguration() {
    try {
        const query = `SELECT * FROM configuration`;
        const rows = await executeQuery(query);
        return rows;
    } catch (error) {
        console.error('Error getting configuration:', error);
        return [];
    }
}

/**
 * Update configuration for a symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} Success status
 */
async function updateConfiguration(symbol, config) {
    try {
        // Validate input
        if (!symbol || !config) {
            console.error('Invalid configuration update parameters');
            return false;
        }

        // Update configuration
        const query = `
            UPDATE configuration SET 
                investment_preset = ?,
                buy_threshold = ?,
                sell_threshold = ?,
                buy_threshold_percent = ?,
                sell_threshold_percent = ?,
                additional_purchase_amount = ?,
                active = ?,
                updated_at = NOW()
            WHERE symbol = ?
        `;
        
        const params = [
            config.investment_preset || 50,
            config.buy_threshold || 5,
            config.sell_threshold || 5,
            config.buy_threshold_percent || 5,
            config.sell_threshold_percent || 5,
            config.additional_purchase_amount || 50,
            config.active !== undefined ? config.active : false,
            symbol
        ];
        
        await executeQuery(query, params);
        
        console.log(`Updated configuration for ${symbol}`);
        return true;
    } catch (error) {
        console.error(`Error updating configuration for ${symbol}:`, error);
        return false;
    }
}

/**
 * Get batch data for multiple symbols
 * @param {Array} symbols - Array of cryptocurrency symbols
 * @returns {Promise<Object>} Object with data for each symbol
 */
async function getBatchData(symbols) {
    if (!symbols || !symbols.length) {
        return {};
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        
        const results = {};
        
        // Process each symbol
        for (const symbol of symbols) {
            try {
                // Get transactions
                const transactions = await conn.query(`
                    SELECT * FROM transactions 
                    WHERE symbol = ? 
                    ORDER BY timestamp DESC 
                    LIMIT 30
                `, [symbol]);
                
                // Get holdings
                const holdingsRows = await conn.query(`
                    SELECT * FROM holdings 
                    WHERE symbol = ?
                `, [symbol]);
                
                // Get reference prices
                const refPriceRows = await conn.query(`
                    SELECT * FROM reference_prices 
                    WHERE symbol = ?
                `, [symbol]);
                
                // Store all data for this symbol
                results[symbol] = {
                    transactions: transactions || [],
                    holdings: holdingsRows[0] || { 
                        symbol, 
                        quantity: 0, 
                        avg_price: 0 
                    },
                    refPrices: refPriceRows[0] || { 
                        symbol,
                        initial_purchase_price: 0,
                        last_purchase_price: 0,
                        next_buy_threshold: 0,
                        next_sell_threshold: 0
                    }
                };
            } catch (error) {
                console.error(`Error processing batch data for ${symbol}:`, error);
                results[symbol] = { error: error.message };
            }
        }
        
        return results;
    } catch (error) {
        console.error('Error in batch data processing:', error);
        return {};
    } finally {
        if (conn) {
            try {
                await conn.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
    }
}

/**
 * Get database health statistics
 * @returns {Promise<Object>} Database health statistics
 */
async function getHealthStats() {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get basic health check
        const healthCheck = await conn.query('SELECT 1 as health_check');
        
        // Get connection statistics
        const connectionStats = {
            activeConnections: pool._allConnections.size,
            idleConnections: pool._freeConnections.size,
            connectionLimit: pool.pool.config.connectionLimit
        };
        
        // Get database size information
        const dbSizeQuery = `
            SELECT 
                table_schema as database_name,
                ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb
            FROM information_schema.tables
            WHERE table_schema = ?
            GROUP BY table_schema
        `;
        
        const dbSize = await conn.query(dbSizeQuery, [DB_CONFIG.database]);
        
        // Get table counts
        const tableCountQuery = `
            SELECT COUNT(*) as table_count
            FROM information_schema.tables
            WHERE table_schema = ?
        `;
        
        const tableCount = await conn.query(tableCountQuery, [DB_CONFIG.database]);
        
        return {
            healthy: healthCheck && healthCheck.length > 0,
            lastChecked: new Date().toISOString(),
            connectionStats,
            dbSize: dbSize[0]?.size_mb || 0,
            tableCount: tableCount[0]?.table_count || 0
        };
    } catch (error) {
        console.error('Error getting database health stats:', error);
        return {
            healthy: false,
            error: error.message,
            lastChecked: new Date().toISOString()
        };
    } finally {
        if (conn) {
            try {
                await conn.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
    }
}

/**
 * Refresh the connection pool to ensure database stays connected
 * @returns {Promise<void>}
 */
async function refreshConnectionPool() {
    try {
        console.log('Performing connection pool health check');
        // Check pool state
        if (!pool) {
            console.log('Pool does not exist, creating new pool');
            pool = mariadb.createPool(DB_CONFIG);
            return;
        }
        
        // Test connection - Use a shorter timeout for the test
        let conn;
        try {
            conn = await pool.getConnection({timeout: 5000});
            await conn.query('SELECT 1 as health_check');
            console.log('Connection pool health check passed');
            await conn.release();
        } catch (err) {
            console.error('Connection test failed, recreating pool:', err);
            // End existing pool if possible
            try {
                if (pool) await pool.end();
            } catch (poolErr) {
                console.error('Error ending pool:', poolErr);
            }
            
            // Create new pool
            pool = mariadb.createPool(DB_CONFIG);
            console.log('Created new connection pool');
        }
    } catch (error) {
        console.error('Error in connection pool health check:', error);
    }
}

// Call this function every minute to ensure pool stays healthy
setInterval(refreshConnectionPool, 60000);

// New function to get transaction summary statistics
async function getTransactionSummary(symbol, period = '7d') {
    try {
        // Determine date range based on period
        let dateClause;
        switch (period) {
            case '24h':
                dateClause = 'timestamp >= DATE_SUB(NOW(), INTERVAL 1 DAY)';
                break;
            case '7d':
                dateClause = 'timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
                break;
            case '30d':
                dateClause = 'timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
                break;
            case 'all':
                dateClause = '1=1'; // All records
                break;
            default:
                dateClause = 'timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        }
        
        // Query for buy transactions
        const buyQuery = `
            SELECT 
                COUNT(*) as count,
                SUM(investment) as total_investment
            FROM transactions
            WHERE symbol = ? AND type = 'BUY' AND ${dateClause}
        `;
        
        // Query for sell transactions
        const sellQuery = `
            SELECT 
                COUNT(*) as count,
                SUM(quantity * price) as total_value
            FROM transactions
            WHERE symbol = ? AND type = 'SELL' AND ${dateClause}
        `;
        
        // Execute both queries
        const buyResult = await executeQuery(buyQuery, [symbol]);
        const sellResult = await executeQuery(sellQuery, [symbol]);
        
        // Extract values
        const buyCount = buyResult[0]?.count || 0;
        const sellCount = sellResult[0]?.count || 0;
        const totalBuy = buyResult[0]?.total_investment || 0;
        const totalSell = sellResult[0]?.total_value || 0;
        
        // Calculate profit/loss
        const profitLoss = totalSell - totalBuy;
        
        return {
            symbol,
            period,
            totalTrades: buyCount + sellCount,
            buyCount,
            sellCount,
            totalBuy,
            totalSell,
            profitLoss
        };
    } catch (error) {
        console.error(`Error getting transaction summary for ${symbol}:`, error);
        return {
            symbol,
            period,
            totalTrades: 0,
            buyCount: 0,
            sellCount: 0,
            totalBuy: 0,
            totalSell: 0,
            profitLoss: 0
        };
    }
}

// New function to verify database schema integrity
async function verifyDatabaseSchema() {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Define expected tables and required columns
        const requiredTables = [
            {
                name: 'transactions',
                columns: ['id', 'symbol', 'type', 'price', 'quantity', 'investment', 'automated', 'timestamp']
            },
            {
                name: 'holdings',
                columns: ['id', 'symbol', 'quantity', 'avg_price', 'initial_purchase_timestamp', 'last_updated']
            },
            {
                name: 'reference_prices',
                columns: ['id', 'symbol', 'initial_purchase_price', 'last_purchase_price', 'next_buy_threshold', 'next_sell_threshold', 'updated_at']
            },
            {
                name: 'configuration',
                columns: ['id', 'symbol', 'investment_preset', 'buy_threshold', 'sell_threshold', 'active', 'created_at', 'updated_at']
            }
        ];
        
        // Check if tables exist and have required columns
        const issues = [];
        
        for (const table of requiredTables) {
            // Check if table exists
            const tableExistsQuery = `
                SELECT COUNT(*) as count 
                FROM information_schema.tables 
                WHERE table_schema = ? AND table_name = ?
            `;
            const tableExists = await conn.query(tableExistsQuery, [DB_CONFIG.database, table.name]);
            
            if (tableExists[0].count === 0) {
                issues.push(`Table '${table.name}' does not exist`);
                continue;
            }
            
            // Check if columns exist
            const columnsQuery = `
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = ? AND table_name = ?
            `;
            const columns = await conn.query(columnsQuery, [DB_CONFIG.database, table.name]);
            
            // Get column names as array
            const columnNames = columns.map(col => col.column_name);
            
            // Check for missing columns
            for (const requiredColumn of table.columns) {
                if (!columnNames.includes(requiredColumn)) {
                    issues.push(`Table '${table.name}' is missing column '${requiredColumn}'`);
                }
            }
        }
        
        return {
            isValid: issues.length === 0,
            issues
        };
    } catch (error) {
        console.error('Error verifying database schema:', error);
        return {
            isValid: false,
            issues: [`Database schema verification failed: ${error.message}`]
        };
    } finally {
        if (conn) {
            try {
                await conn.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
    }
}

// Export all functions
module.exports = {
    pool,
    testConnection,
    executeQuery,
    getTransactions,
    storeTransaction,
    getHoldings,
    updateHoldings,
    getReferencePrice,
    updateReferencePrice,
    getAccountBalance,
    getConfiguration,
    updateConfiguration,
    getBatchData,
    getHealthStats,
    refreshConnectionPool,
    getTransactionSummary,
    verifyDatabaseSchema
};