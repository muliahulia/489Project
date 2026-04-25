var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const postController = require('../controllers/postController');

router.get('/', postController.redirectToFeed);
router.get('/:id', requireAuth, postController.showPostById);

module.exports = router;
