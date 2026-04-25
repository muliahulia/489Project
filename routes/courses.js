var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const courseController = require('../controllers/courseController');

router.get('/', requireAuth, courseController.listCourses);
router.get('/create', requireAuth, courseController.showCreateCourse);
router.post('/create', requireAuth, courseController.createCourse);
router.get('/manage/:id', requireAuth, courseController.showManageCourse);
router.post('/manage/:id', requireAuth, courseController.updateCourse);
router.post('/:id/join', requireAuth, courseController.joinCourse);
router.post('/:id/leave', requireAuth, courseController.leaveCourse);
router.post('/:id/posts', requireAuth, courseController.createCoursePost);
router.get('/:id', requireAuth, courseController.showCourseById);

module.exports = router;
