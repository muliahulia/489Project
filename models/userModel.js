const pool = require('../db');

async function getAllUsers() {
    const results = await pool.query(`
        SELECT id, full_name, email
        FROM users`);
    return results.rows;
}
async function getUserById(id) {
    const results = await pool.query(`
        SELECT id, name, email, role 
        FROM users 
        WHERE id = $1`,
        [id]);
    return results.rows[0];
}

async function createUser(first_name, last_name, password_hash, email, role = 'student') {
    const full_name = normalizeName(first_name, last_name);
    const result = await pool.query(`
        INSERT INTO users (full_name, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [full_name, email, password_hash, role]);
    return result.rows[0];
}

async function deleteUser(id) {
    const result = await pool.query(`
        DELETE FROM users 
        WHERE id = $1`, 
        [id]);
    return result.rows[0];
}

async function updateUser(id, first_name, last_name, email, password_hash, role, school_id, is_verified) {
        const full_name = normalizeName(first_name, last_name);

        const result = await pool.query(`
            UPDATE users 
            SET full_name = $1,
            email = $2,
            password_hash = $3,
            school_id = $4,
            role = $5,
            is_verified = $6
            WHERE id = $7`, 
            [full_name, email, password_hash, school_id, role, is_verified, id]);
        return result.rows[0]; 
}

function normalizeName(first_name, last_name) {
    return capitalizeFirstLetter(first_name) + " " + capitalizeFirstLetter(last_name);
}

function capitalizeFirstLetter(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { 
    getAllUsers,
    getUserById,
    createUser,
    deleteUser,
    updateUser

 };