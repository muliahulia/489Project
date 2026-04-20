const pool = require('../db');

//Create course
async function createCourse(name, description, school_id, created_by) {
    const result = await pool.query(`
        INSERT INTO courses (name, description, school_id, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    `, [name, description, school_id, created_by]);

    return result.rows[0];
}


// Get course by id
async function getCourseById(id) {
    const result = await pool.query(`
        SELECT *
        FROM courses
        WHERE id = $1
    `, [id]);

    return result.rows[0];
}


// Get all courses (with option of getting by school)
async function getCoursesBySchool(school_id) {
    const result = await pool.query(`
        SELECT *
        FROM courses
        WHERE school_id = $1
        ORDER BY name ASC
    `, [school_id]);

    return result.rows;
}


// Update course
async function updateCourse(id, name, description) {
    const result = await pool.query(`
        UPDATE courses
        SET name = $1,
            description = $2
        WHERE id = $3
        RETURNING *
    `, [name, description, id]);

    return result.rows[0];
}


// Delete course
async function deleteCourse(id) {
    const result = await pool.query(`
        DELETE FROM courses
        WHERE id = $1
        RETURNING *
    `, [id]);

    return result.rows[0];
}


// Enroll user in course
async function enrollUser(user_id, course_id, role = 'student') {
    const result = await pool.query(`
        INSERT INTO course_enrollments (user_id, course_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, course_id)
        DO UPDATE SET role = $3
        RETURNING *
    `, [user_id, course_id, role]);

    return result.rows[0];
}


// Get users in course
async function getCourseMembers(course_id) {
    const result = await pool.query(`
        SELECT 
            u.id,
            u.full_name,
            ce.role
        FROM course_enrollments ce
        JOIN users u ON ce.user_id = u.id
        WHERE ce.course_id = $1
    `, [course_id]);

    return result.rows;
}


// Get courses for a user
async function getCoursesByUser(user_id) {
    const result = await pool.query(`
        SELECT 
            c.id,
            c.name,
            c.description,
            ce.role
        FROM course_enrollments ce
        JOIN courses c ON ce.course_id = c.id
        WHERE ce.user_id = $1
    `, [user_id]);

    return result.rows;
}


// Remove user from a course
async function removeUserFromCourse(user_id, course_id) {
    const result = await pool.query(`
        DELETE FROM course_enrollments
        WHERE user_id = $1 AND course_id = $2
        RETURNING *
    `, [user_id, course_id]);

    return result.rows[0];
}


//Exports
module.exports = {
    createCourse,
    getCourseById,
    getCoursesBySchool,
    updateCourse,
    deleteCourse,
    enrollUser,
    getCourseMembers,
    getCoursesByUser,
    removeUserFromCourse
};