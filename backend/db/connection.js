const mariadb = require('mariadb');

let pool;

module.exports = {
  init: async function() {
    pool = mariadb.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectionLimit: 5
    });
    
    // Test connection
    const connection = await pool.getConnection();
    connection.release();
    return true;
  },
  
  getConnection: async function() {
    return await pool.getConnection();
  },
  
  close: async function() {
    if (pool) {
      return pool.end();
    }
  },
  
  query: async function(sql, params) {
    let conn;
    try {
      conn = await pool.getConnection();
      const result = await conn.query(sql, params);
      return result;
    } catch (err) {
      throw err;
    } finally {
      if (conn) conn.release();
    }
  }
};