const mysql = require('mysql2/promise');
require('dotenv').config();

// Create a connection pool using environment variables
const pool = mysql.createPool({
  host: 'database',
  port: 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Simple query function to use with the pool
const query = async (sql, params) => {
  const [rows] = await pool.execute(sql, params);
  return rows;
};

module.exports = {
  query,
  pool
};