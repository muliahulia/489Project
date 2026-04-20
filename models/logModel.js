const pool = require('../db');



//Login logs

// Login attempt
async function logLogin(user_id, success) {
    const result = await pool.query(`
        INSERT INTO login_logs (user_id, success)
        VALUES ($1, $2)
        RETURNING *
    `, [user_id, success]);

    return result.rows[0];
}


// Get login history for a user
async function getLoginLogsByUser(user_id) {
    const result = await pool.query(`
        SELECT *
        FROM login_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
    `, [user_id]);

    return result.rows;
}



//User activity logs

// log user action
async function logUserActivity(user_id, action_type, target_type = null, target_id = null, metadata = null) {
    const result = await pool.query(`
        INSERT INTO user_activity_logs (user_id, action_type, target_type, target_id, metadata)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
    `, [user_id, action_type, target_type, target_id, metadata]);

    return result.rows[0];
}


// get user activity logs
async function getUserActivityLogs(user_id) {
    const result = await pool.query(`
        SELECT *
        FROM user_activity_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
    `, [user_id]);

    return result.rows;
}



// admin logs

// log admin action
async function logAdminAction(admin_id, action_type, target_type = null, target_id = null, description = null) {
    const result = await pool.query(`
        INSERT INTO admin_actions (admin_id, action_type, target_type, target_id, description)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
    `, [admin_id, action_type, target_type, target_id, description]);

    return result.rows[0];
}


// get an admins actions
async function getAdminActions(admin_id) {
    const result = await pool.query(`
        SELECT *
        FROM admin_actions
        WHERE admin_id = $1
        ORDER BY created_at DESC
    `, [admin_id]);

    return result.rows;
}


// Get all admin actions
async function getAllAdminActions() {
    const result = await pool.query(`
        SELECT *
        FROM admin_actions
        ORDER BY created_at DESC
    `);

    return result.rows;
}



// Exports
module.exports = {
    // login logs
    logLogin,
    getLoginLogsByUser,

    // user activity logs
    logUserActivity,
    getUserActivityLogs,

    // admin logs
    logAdminAction,
    getAdminActions,
    getAllAdminActions
};