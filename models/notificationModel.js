const pool = require('../db');


//Create notification
async function createNotification(user_id, message) {
    const result = await pool.query(`
        INSERT INTO notifications (user_id, message)
        VALUES ($1, $2)
        RETURNING *
    `, [user_id, message]);

    return result.rows[0];
}


// Get notifications for user
async function getNotificationsByUser(user_id) {
    const result = await pool.query(`
        SELECT 
            id,
            message,
            is_read,
            created_at
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
    `, [user_id]);

    return result.rows;
}


// Get unread notifications
async function getUnreadNotifications(user_id) {
    const result = await pool.query(`
        SELECT 
            id,
            message,
            created_at
        FROM notifications
        WHERE user_id = $1
          AND is_read = FALSE
        ORDER BY created_at DESC
    `, [user_id]);

    return result.rows;
}


// Mark one notification as read
async function markAsRead(id) {
    const result = await pool.query(`
        UPDATE notifications
        SET is_read = TRUE
        WHERE id = $1
        RETURNING *
    `, [id]);

    return result.rows[0];
}


// Mark all as read
async function markAllAsRead(user_id) {
    const result = await pool.query(`
        UPDATE notifications
        SET is_read = TRUE
        WHERE user_id = $1
        RETURNING *
    `, [user_id]);

    return result.rows;
}


// Delete notification
async function deleteNotification(id) {
    const result = await pool.query(`
        DELETE FROM notifications
        WHERE id = $1
        RETURNING *
    `, [id]);

    return result.rows[0];
}


// Exports
module.exports = {
    createNotification,
    getNotificationsByUser,
    getUnreadNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification
};