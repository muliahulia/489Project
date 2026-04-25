var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const communityController = require('../controllers/communityController');

router.post('/:id/join', requireAuth, communityController.joinCommunity);
router.post('/:id/leave', requireAuth, communityController.leaveCommunity);
router.post('/:id/posts', requireAuth, communityController.createCommunityPost);
router.get('/:id', requireAuth, communityController.showCommunityById);

module.exports = router;
