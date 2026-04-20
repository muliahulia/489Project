const pool = require('../db');


// get all communities
async function getAllCommunities() {
    const result = await pool.query(`
        SELECT id, name, description, creator_id, is_private, created_at
        FROM communities
        ORDER BY created_at DESC
    `);

    return result.rows;
}


// get community by id
async function getCommunityById(id) {
    const result = await pool.query(`
        SELECT *
        FROM communities
        WHERE id = $1
    `, [id]);

    return result.rows[0];
}


// get communities created by user
async function getCommunitiesByUser(creator_id) {
    const result = await pool.query(`
        SELECT *
        FROM communities
        WHERE creator_id = $1
        ORDER BY created_at DESC
    `, [creator_id]);

    return result.rows;
}


// Create community
async function createCommunity(name, description, creator_id, is_private) {
    const result = await pool.query(`
        INSERT INTO communities (name, description, creator_id, is_private)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `, [name, description, creator_id, is_private]);

    return result.rows[0];
}


// Update community
async function updateCommunity(id, name, description, is_private) {
    const result = await pool.query(`
        UPDATE communities
        SET name = $1,
            description = $2,
            is_private = $3
        WHERE id = $4
        RETURNING *
    `, [name, description, is_private, id]);

    return result.rows[0];
}


// Delete communtiy
async function deleteCommunity(id) {
    const result = await pool.query(`
        DELETE FROM communities
        WHERE id = $1
        RETURNING *
    `, [id]);

    return result.rows[0];
}

// Gets posts within community
async function getCommunityWithPosts(community_id) {
    const result = await pool.query(`
        SELECT 
            c.id AS community_id,
            c.name,
            c.description,
            p.id AS post_id,
            p.content,
            p.created_at
        FROM communities c
        LEFT JOIN posts p ON p.community_id = c.id
        WHERE c.id = $1
          AND p.is_deleted = FALSE
        ORDER BY p.created_at DESC
    `, [community_id]);

    return result.rows;
}


// Search communities
async function searchCommunities(query) {
    const result = await pool.query(`
        SELECT *
        FROM communities
        WHERE name ILIKE $1
           OR description ILIKE $1
        ORDER BY created_at DESC
    `, [`%${query}%`]);

    return result.rows;
}


// Get public communties only
async function getPublicCommunities() {
    const result = await pool.query(`
        SELECT *
        FROM communities
        WHERE is_private = FALSE
        ORDER BY created_at DESC
    `);

    return result.rows;
}


// Check is user is the creator of the community
async function isCommunityCreator(community_id, user_id) {
    const result = await pool.query(`
        SELECT 1
        FROM communities
        WHERE id = $1 AND creator_id = $2
        LIMIT 1
    `, [community_id, user_id]);

    return result.rowCount > 0;
}


/**
 * EXPORTS
 */
module.exports = {
    getAllCommunities,
    getCommunityById,
    getCommunitiesByUser,
    createCommunity,
    updateCommunity,
    deleteCommunity,
    getCommunityWithPosts,
    searchCommunities,
    getPublicCommunities,
    isCommunityCreator
};