const pool = require('../db');

// Create comment
async function createComment(post_id, author_id, content, parent_id = null) {
    const result = await pool.query(`
        INSERT INTO comments (post_id, author_id, content, parent_id)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `, [post_id, author_id, content, parent_id]);

    return result.rows[0];
}


// Get comment by id
async function getCommentById(id) {
    const result = await pool.query(`
        SELECT 
            c.id,
            c.content,
            c.created_at,
            c.parent_id,
            u.id AS author_id,
            u.full_name AS author_name
        FROM comments c
        JOIN users u ON c.author_id = u.id
        WHERE c.id = $1
          AND c.is_deleted = FALSE
    `, [id]);

    return result.rows[0];
}


// Get comments for a post
async function getCommentsByPost(post_id) {
    const result = await pool.query(`
        SELECT 
            c.id,
            c.content,
            c.created_at,
            c.parent_id,
            u.id AS author_id,
            u.full_name AS author_name
        FROM comments c
        JOIN users u ON c.author_id = u.id
        WHERE c.post_id = $1
          AND c.is_deleted = FALSE
        ORDER BY c.created_at ASC
    `, [post_id]);

    return result.rows;
}


// Get top level comments (without replies)
async function getParentCommentsByPost(post_id) {
    const result = await pool.query(`
        SELECT 
            c.id,
            c.content,
            c.created_at,
            u.full_name AS author_name
        FROM comments c
        JOIN users u ON c.author_id = u.id
        WHERE c.post_id = $1
          AND c.parent_id IS NULL
          AND c.is_deleted = FALSE
        ORDER BY c.created_at ASC
    `, [post_id]);

    return result.rows;
}


// Get replies for a comment
async function getRepliesByComment(parent_id) {
    const result = await pool.query(`
        SELECT 
            c.id,
            c.content,
            c.created_at,
            u.full_name AS author_name
        FROM comments c
        JOIN users u ON c.author_id = u.id
        WHERE c.parent_id = $1
          AND c.is_deleted = FALSE
        ORDER BY c.created_at ASC
    `, [parent_id]);

    return result.rows;
}


// Update a comments information
async function updateComment(id, content) {
    const result = await pool.query(`
        UPDATE comments
        SET content = $1
        WHERE id = $2
          AND is_deleted = FALSE
        RETURNING *
    `, [content, id]);

    return result.rows[0];
}


// Soft delete comment
async function deleteComment(id) {
    const result = await pool.query(`
        UPDATE comments
        SET is_deleted = TRUE
        WHERE id = $1
        RETURNING *
    `, [id]);

    return result.rows[0];
}


// Exports
module.exports = {
    createComment,
    getCommentById,
    getCommentsByPost,
    getParentCommentsByPost,
    getRepliesByComment,
    updateComment,
    deleteComment
};