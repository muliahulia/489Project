const pool = require('../db');

//Enroll user in course
async function enrollUserInCourse(user_id, course_id, role = 'student') {
    const result = await pool.query(`
        INSERT INTO course_enrollments (user_id, course_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, course_id)
        DO UPDATE SET role = $3
        RETURNING *
    `, [user_id, course_id, role]);

    return result.rows[0];
}


// Remove user from course
async function removeUserFromCourse(user_id, course_id) {
    const result = await pool.query(`
        DELETE FROM course_enrollments
        WHERE user_id = $1 AND course_id = $2
        RETURNING *
    `, [user_id, course_id]);

    return result.rows[0];
}


// Get all members in a course
async function getCourseMembers(course_id) {
    const result = await pool.query(`
        SELECT 
            u.id,
            u.full_name,
            u.email,
            ce.role
        FROM course_enrollments ce
        JOIN users u ON ce.user_id = u.id
        WHERE ce.course_id = $1
        ORDER BY ce.role DESC, u.full_name ASC
    `, [course_id]);

    return result.rows;
}


// Get all courses for a user
async function getUserCourses(user_id) {
    const result = await pool.query(`
        SELECT 
            c.id,
            c.name,
            c.description,
            ce.role
        FROM course_enrollments ce
        JOIN courses c ON ce.course_id = c.id
        WHERE ce.user_id = $1
        ORDER BY c.name ASC
    `, [user_id]);

    return result.rows;
}


// Check if user is enrolled
async function isUserEnrolled(user_id, course_id) {
    const result = await pool.query(`
        SELECT 1
        FROM course_enrollments
        WHERE user_id = $1 AND course_id = $2
        LIMIT 1
    `, [user_id, course_id]);

    return result.rowCount > 0;
}


// Update user role in course (student, teacher, TA)
async function updateEnrollmentRole(user_id, course_id, role) {
    const result = await pool.query(`
        UPDATE course_enrollments
        SET role = $3
        WHERE user_id = $1 AND course_id = $2
        RETURNING *
    `, [user_id, course_id, role]);

    return result.rows[0];
}


/**
 * EXPORTS
 */
module.exports = {
    enrollUserInCourse,
    removeUserFromCourse,
    getCourseMembers,
    getUserCourses,
    isUserEnrolled,
    updateEnrollmentRole
};