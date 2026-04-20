const pool = require('../db');


// Add or update reaction
async function addReaction(user_id, post_id, type) {
    const result = await pool.query(`
        INSERT INTO reactions (user_id, post_id, type)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, post_id)
        DO UPDATE SET type = $3
        RETURNING *
    `, [user_id, post_id, type]);

    return result.rows[0];
}


// Remove reaction
async function removeReaction(user_id, post_id) {
    const result = await pool.query(`
        DELETE FROM reactions
        WHERE user_id = $1 AND post_id = $2
        RETURNING *
    `, [user_id, post_id]);

    return result.rows[0];
}


// Get all reactions for post
async function getReactionsByPost(post_id) {
    const result = await pool.query(`
        SELECT 
            type,
            COUNT(*) AS count
        FROM reactions
        WHERE post_id = $1
        GROUP BY type
    `, [post_id]);

    return result.rows;
}


// Get users reaction to a post
async function getUserReaction(user_id, post_id) {
    const result = await pool.query(`
        SELECT type
        FROM reactions
        WHERE user_id = $1 AND post_id = $2
    `, [user_id, post_id]);

    return result.rows[0];
}


// Get all posts a user has reacted to
async function getUserReactions(user_id) {
    const result = await pool.query(`
        SELECT 
            r.post_id,
            r.type,
            p.content
        FROM reactions r
        JOIN posts p ON r.post_id = p.id
        WHERE r.user_id = $1
    `, [user_id]);

    return result.rows;
}


// exports
module.exports = {
    addReaction,
    removeReaction,
    getReactionsByPost,
    getUserReaction,
    getUserReactions
};