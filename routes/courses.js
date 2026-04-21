var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const courseController = require('../controllers/courseController');

router.get('/', requireAuth, courseController.listCourses);
router.post('/:id/join', requireAuth, courseController.joinCourse);
router.post('/:id/leave', requireAuth, courseController.leaveCourse);
router.post('/:id/posts', requireAuth, courseController.createCoursePost);
router.get('/:id', requireAuth, courseController.showCourseById);

module.exports = router;
