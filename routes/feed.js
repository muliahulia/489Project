var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const postController = require('../controllers/postController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', requireAuth, postController.showFeed);
router.post('/posts', requireAuth, upload.single('image'), postController.createFeedPost);
router.post('/posts/:postId/like', requireAuth, postController.togglePostLike);
router.post('/posts/:postId/comments', requireAuth, postController.createPostComment);
router.post('/posts/:postId/report', requireAuth, postController.reportPost);
router.delete('/posts/:postId', requireAuth, postController.deletePost);

module.exports = router;