// backend/js/dbconns.js
// Database Connection Module
// Handles all database operations and connections

// Import required modules
const mariadb = require('mariadb');

// Load environment variables
dotenv.config({ path: '/app/.env' });

// Create connection pool with optimal settings
const pool = createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 20,
    acquireTimeout: 30000,
    idleTimeout: 60000,
    resetAfterUse: true,
    connectTimeout: 20000,
    socketTimeout: 60000,
    multipleStatements: false
});

// Log pool creation
console.log('Database connection pool created with configuration:', {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    connectionLimit: 20
});

// Register event handlers for pool
pool.on('connection', (conn) => {
    console.log('New database connection established');
    
    conn.on('error', (err) => {
        console.error('Database connection error:', err);
    });
});

pool.on('acquire', () => {
    console.log('Database connection acquired');
});

pool.on('release', () => {
    console.log('Database connection released');
});

// Test database connection
async function testConnection() {
    let conn;
    try {
        conn = await pool.getConnection();
        console.log('Database connection successful');
        const rows = await conn.query('SELECT 1 as test');
        return rows && rows.length > 0;
    } catch (err) {
        console.error('Database connection test failed:', err);
        return false;
    } finally {
        if (conn) conn.release();
    }
}

/**
 * Get transactions for a specific symbol
 * @param {string} symbol - Cryptocurrency symbol (e.g. BTCUSDT)
 * @param {number} limit - Maximum number of transactions to return
 * @returns {Array} Array of transaction objects
 */
async function getTransactions(symbol, limit = 30) {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?',
            [symbol, limit]
        );
        
        console.log(`Found ${rows.length} transactions for ${symbol}`);
        return rows;
    } catch (err) {
        console.error('Error querying transactions:', err);
        return [];
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
 * Store a transaction in the database
 * @param {Object} transaction - Transaction data object
 * @param {string} transaction.symbol - Cryptocurrency symbol
 * @param {string} transaction.type - Transaction type (BUY or SELL)
 * @param {number} transaction.price - Transaction price
 * @param {number} transaction.quantity - Transaction quantity
 * @param {number} transaction.investment - Investment amount in USDT
 * @param {boolean} transaction.automated - Whether transaction was automated
 * @returns {boolean} Success status
 */
async function storeTransaction(transaction) {
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            'INSERT INTO transactions (symbol, type, price, quantity, investment, automated) VALUES (?, ?, ?, ?, ?, ?)',
            [
                transaction.symbol,
                transaction.type,
                transaction.price,
                transaction.quantity,
                transaction.investment,
                transaction.automated || false
            ]
        );
        console.log(`Stored ${transaction.type} transaction for ${transaction.symbol}`);
        return true;
    } catch (err) {
        console.error('Error storing transaction:', err);
        return false;
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
 * Get holdings for a specific symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @returns {Object} Holdings data object
 */
async function getHoldings(symbol) {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(
            'SELECT * FROM holdings WHERE symbol = ?',
            [symbol]
        );
        
        return rows[0] || { symbol, quantity: 0, avg_price: 0 };
    } catch (err) {
        console.error('Error querying holdings:', err);
        return { symbol, quantity: 0, avg_price: 0 };
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
 * Update holdings for a symbol based on all transactions
 * @param {string} symbol - Cryptocurrency symbol
 * @returns {Object} Updated holdings data
 */
async function updateHoldings(symbol) {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get all transactions for the symbol
        const transactions = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? ORDER BY timestamp ASC',
            [symbol]
        );
        
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
                totalInvestment += parseFloat(tx.investment);
                
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
        await conn.query(
            `INSERT INTO holdings (symbol, quantity, avg_price) 
             VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE 
             quantity = VALUES(quantity), 
             avg_price = VALUES(avg_price)`,
            [symbol, quantity, avgPrice]
        );
        
        console.log(`Updated holdings for ${symbol}: ${quantity} at avg price ${avgPrice}`);
        return { symbol, quantity, avg_price: avgPrice };
    } catch (err) {
        console.error('Error updating holdings:', err);
        throw err;
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
 * @returns {Object} Reference prices object
 */
async function getReferencePrice(symbol) {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(
            'SELECT * FROM reference_prices WHERE symbol = ?',
            [symbol]
        );
        
        // Default values if no record exists
        return rows[0] || {
            symbol,
            initial_purchase_price: 0,
            last_purchase_price: 0,
            next_buy_threshold: 0,
            next_sell_threshold: 0
        };
    } catch (err) {
        console.error('Error getting reference prices:', err);
        return {
            symbol,
            initial_purchase_price: 0,
            last_purchase_price: 0,
            next_buy_threshold: 0,
            next_sell_threshold: 0
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
 * Update reference prices for a symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @param {number} currentPrice - Current price
 * @returns {Object} Updated reference prices
 */
async function updateReferencePrice(symbol, currentPrice) {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get existing reference prices
        const existingPrices = await getReferencePrice(symbol);
        
        // Get configuration for this symbol
        const configRows = await conn.query(
            'SELECT * FROM configuration WHERE symbol = ?',
            [symbol]
        );
        
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
        await conn.query(
            `INSERT INTO reference_prices 
             (symbol, initial_purchase_price, last_purchase_price, next_buy_threshold, next_sell_threshold) 
             VALUES (?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE 
             initial_purchase_price = CASE WHEN initial_purchase_price = 0 THEN ? ELSE initial_purchase_price END,
             last_purchase_price = ?,
             next_buy_threshold = ?,
             next_sell_threshold = ?`,
            [
                symbol, initialPrice, currentPrice, nextBuyPrice, nextSellPrice,
                initialPrice, currentPrice, nextBuyPrice, nextSellPrice
            ]
        );
        
        console.log(`Updated reference prices for ${symbol}: Initial=${initialPrice}, Last=${currentPrice}, NextBuy=${nextBuyPrice}, NextSell=${nextSellPrice}`);
        
        return {
            symbol,
            initial_purchase_price: initialPrice,
            last_purchase_price: currentPrice,
            next_buy_threshold: nextBuyPrice,
            next_sell_threshold: nextSellPrice
        };
    } catch (err) {
        console.error('Error updating reference prices:', err);
        throw err;
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
 * @returns {Array} Array of balance objects
 */
async function getAccountBalance() {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get all holdings
        const holdings = await conn.query('SELECT * FROM holdings');
        
        // Get current prices for USDT value calculation
        // This is somewhat of a placeholder - in a real environment
        // you'd have a prices table or fetch from an API
        
        return holdings;
    } catch (err) {
        console.error('Error getting account balance:', err);
        return [];
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
 * Get all configuration data
 * @returns {Array} Array of configuration objects
 */
async function getConfiguration() {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query('SELECT * FROM configuration');
        return rows;
    } catch (err) {
        console.error('Error getting configuration:', err);
        return [];
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
 * Update configuration for a symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @param {Object} config - Configuration object
 * @returns {boolean} Success status
 */
async function updateConfiguration(symbol, config) {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Update configuration
        await conn.query(
            `UPDATE configuration SET 
             investment_preset = ?,
             buy_threshold = ?,
             sell_threshold = ?,
             buy_threshold_percent = ?,
             sell_threshold_percent = ?,
             additional_purchase_amount = ?,
             active = ?
             WHERE symbol = ?`,
            [
                config.investment_preset || 50,
                config.buy_threshold || 5,
                config.sell_threshold || 5,
                config.buy_threshold_percent || 5,
                config.sell_threshold_percent || 5,
                config.additional_purchase_amount || 50,
                config.active || false,
                symbol
            ]
        );
        
        console.log(`Updated configuration for ${symbol}`);
        return true;
    } catch (err) {
        console.error('Error updating configuration:', err);
        return false;
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
 * Get batch data for multiple symbols
 * @param {Array} symbols - Array of cryptocurrency symbols
 * @returns {Object} Object with data for each symbol
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
                const transactions = await conn.query(
                    'SELECT * FROM transactions WHERE symbol = ? ORDER BY timestamp DESC LIMIT 30',
                    [symbol]
                );
                
                // Get holdings
                const holdingsRows = await conn.query(
                    'SELECT * FROM holdings WHERE symbol = ?',
                    [symbol]
                );
                
                // Get reference prices
                const refPriceRows = await conn.query(
                    'SELECT * FROM reference_prices WHERE symbol = ?',
                    [symbol]
                );
                
                // Store all data for this symbol
                results[symbol] = {
                    transactions: transactions,
                    holdings: holdingsRows[0] || { symbol, quantity: 0, avg_price: 0 },
                    refPrices: refPriceRows[0] || { 
                        symbol,
                        initial_purchase_price: 0,
                        last_purchase_price: 0,
                        next_buy_threshold: 0,
                        next_sell_threshold: 0
                    }
                };
            } catch (err) {
                console.error(`Error processing batch data for ${symbol}:`, err);
                results[symbol] = { error: err.message };
            }
        }
        
        return results;
    } catch (err) {
        console.error('Error in batch data processing:', err);
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
 * @returns {Object} Database health statistics
 */
async function getHealthStats() {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get basic health check
        const healthCheck = await conn.query('SELECT 1 as health_check');
        
        // Get connection statistics if possible
        const connectionStats = {
            activeConnections: typeof pool.activeConnections === 'function' ? pool.activeConnections() : 'unknown',
            totalConnections: typeof pool.totalConnections === 'function' ? pool.totalConnections() : 'unknown',
            connectionLimit: pool.config ? pool.config.connectionLimit : 'unknown'
        };
        
        // Get table sizes and statistics if needed
        // This might be heavy, so use with caution
        /*
        const tableSizes = await conn.query(`
            SELECT table_name, table_rows, data_length, index_length
            FROM information_schema.tables
            WHERE table_schema = ?
        `, [process.env.DB_NAME]);
        */
        
        return {
            healthy: healthCheck && healthCheck.length > 0,
            lastChecked: new Date().toISOString(),
            connectionStats
        };
    } catch (err) {
        console.error('Error getting database health stats:', err);
        return {
            healthy: false,
            error: err.message,
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

// Export all functions
export default {
    pool,
    testConnection,
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
    getHealthStats
};