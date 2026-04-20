const pool = require('../db');

// Create Post
async function createPost(author_id, content, community_id = null, course_id = null, is_official = false) {
    const result = await pool.query(`
        INSERT INTO posts (author_id, content, community_id, course_id, is_official)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
    `, [author_id, content, community_id, course_id, is_official]);

    return result.rows[0];
}


// Get post by ID
async function getPostById(id) {
    const result = await pool.query(`
        SELECT 
            p.id,
            p.content,
            p.created_at,
            p.is_official,
            u.id AS author_id,
            u.full_name AS author_name
        FROM posts p
        JOIN users u ON p.author_id = u.id
        WHERE p.id = $1
          AND p.is_deleted = FALSE
    `, [id]);

    return result.rows[0];
}


// Get all posts (user feed)
async function getAllPosts(limit = 20, offset = 0) {
    const result = await pool.query(`
        SELECT 
            p.id,
            p.content,
            p.created_at,
            u.full_name AS author_name
        FROM posts p
        JOIN users u ON p.author_id = u.id
        WHERE p.is_deleted = FALSE
        ORDER BY p.created_at DESC
        LIMIT $1 OFFSET $2
    `, [limit, offset]);

    return result.rows;
}


// Get posts for a community
async function getPostsByCommunity(community_id, limit = 20, offset = 0) {
    const result = await pool.query(`
        SELECT 
            p.id,
            p.content,
            p.created_at,
            u.full_name AS author_name
        FROM posts p
        JOIN users u ON p.author_id = u.id
        WHERE p.community_id = $1
          AND p.is_deleted = FALSE
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3
    `, [community_id, limit, offset]);

    return result.rows;
}


// Get posts for a course
async function getPostsByCourse(course_id, limit = 20, offset = 0) {
    const result = await pool.query(`
        SELECT 
            p.id,
            p.content,
            p.created_at,
            u.full_name AS author_name
        FROM posts p
        JOIN users u ON p.author_id = u.id
        WHERE p.course_id = $1
          AND p.is_deleted = FALSE
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3
    `, [course_id, limit, offset]);

    return result.rows;
}


// Update a post
async function updatePost(id, content) {
    const result = await pool.query(`
        UPDATE posts
        SET content = $1
        WHERE id = $2
          AND is_deleted = FALSE
        RETURNING *
    `, [content, id]);

    return result.rows[0];
}


// Soft delete a post (return the listing after deletion)
async function deletePost(id) {
    const result = await pool.query(`
        UPDATE posts
        SET is_deleted = TRUE
        WHERE id = $1
        RETURNING *
    `, [id]);

    return result.rows[0];
}


// Exports
module.exports = {
    createPost,
    getPostById,
    getAllPosts,
    getPostsByCommunity,
    getPostsByCourse,
    updatePost,
    deletePost
};