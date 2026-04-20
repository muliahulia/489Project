var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const postController = require('../controllers/postController');

router.get('/', requireAuth, postController.showFeed);
router.post('/posts', requireAuth, postController.createFeedPost);
router.post('/posts/:postId/like', requireAuth, postController.togglePostLike);
router.post('/posts/:postId/comments', requireAuth, postController.createPostComment);

module.exports = router;
