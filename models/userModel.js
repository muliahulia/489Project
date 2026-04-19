const { pool } = require('pg')
require('dotenv').config

const pool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGPUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT
});

async function getAllUsers() {
    try{
        const results = await pool.query('SELECT id, name, email, FROM users');
        return results.rows;
    }
    catch (err) {
        console.error('Database query error: ', err);
        throw err;
    }
}

module.exports = { getAllUsers };