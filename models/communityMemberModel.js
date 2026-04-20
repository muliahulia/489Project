const pool = require('../db');

// Add user to a community
async function addUserToCommunity(user_id, community_id, role = 'member') {
    const result = await pool.query(`
        INSERT INTO community_members (user_id, community_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, community_id)
        DO UPDATE SET role = $3
        RETURNING *
    `, [user_id, community_id, role]);

    return result.rows[0];
}


// remove user from community
async function removeUserFromCommunity(user_id, community_id) {
    const result = await pool.query(`
        DELETE FROM community_members
        WHERE user_id = $1 AND community_id = $2
        RETURNING *
    `, [user_id, community_id]);

    return result.rows[0];
}


// get all members of community
async function getCommunityMembers(community_id) {
    const result = await pool.query(`
        SELECT 
            u.id,
            u.full_name,
            u.email,
            cm.role
        FROM community_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.community_id = $1
        ORDER BY cm.role DESC, u.full_name ASC
    `, [community_id]);

    return result.rows;
}


// Get all communities belonging to a user
async function getUserCommunities(user_id) {
    const result = await pool.query(`
        SELECT 
            c.id,
            c.name,
            c.description,
            cm.role
        FROM community_members cm
        JOIN communities c ON cm.community_id = c.id
        WHERE cm.user_id = $1
        ORDER BY c.name ASC
    `, [user_id]);

    return result.rows;
}


// Check if a user is a member of a community
async function isUserInCommunity(user_id, community_id) {
    const result = await pool.query(`
        SELECT 1
        FROM community_members
        WHERE user_id = $1 AND community_id = $2
        LIMIT 1
    `, [user_id, community_id]);

    return result.rowCount > 0;
}


// Update memeber role within the communtiy (admin, member, moderator) 
async function updateMemberRole(user_id, community_id, role) {
    const result = await pool.query(`
        UPDATE community_members
        SET role = $3
        WHERE user_id = $1 AND community_id = $2
        RETURNING *
    `, [user_id, community_id, role]);

    return result.rows[0];
}


// Exports
module.exports = {
    addUserToCommunity,
    removeUserFromCommunity,
    getCommunityMembers,
    getUserCommunities,
    isUserInCommunity,
    updateMemberRole
};