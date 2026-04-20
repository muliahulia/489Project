const pool = require('../db');


// Create penalty
async function createPenalty(user_id, issued_by, reason, expires_at = null) {
    const result = await pool.query(`
        INSERT INTO user_penalties (user_id, issued_by, reason, expires_at)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `, [user_id, issued_by, reason, expires_at]);

    return result.rows[0];
}


// Get penalties for a user
async function getPenaltiesByUser(user_id) {
    const result = await pool.query(`
        SELECT 
            id,
            reason,
            expires_at,
            created_at,
            issued_by
        FROM user_penalties
        WHERE user_id = $1
        ORDER BY created_at DESC
    `, [user_id]);

    return result.rows;
}


// get active penalties
async function getActivePenalties(user_id) {
    const result = await pool.query(`
        SELECT *
        FROM user_penalties
        WHERE user_id = $1
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at DESC
    `, [user_id]);

    return result.rows;
}


// check if a user is currently penalized
async function isUserPenalized(user_id) {
    const result = await pool.query(`
        SELECT 1
        FROM user_penalties
        WHERE user_id = $1
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1
    `, [user_id]);

    return result.rowCount > 0;
}


// manually remove penalites (admin)
async function removePenalty(id) {
    const result = await pool.query(`
        DELETE FROM user_penalties
        WHERE id = $1
        RETURNING *
    `, [id]);

    return result.rows[0];
}


// exports
module.exports = {
    createPenalty,
    getPenaltiesByUser,
    getActivePenalties,
    isUserPenalized,
    removePenalty
};