var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const communityController = require('../controllers/communityController');

router.get('/', requireAuth, communityController.listCommunities);
router.get('/create-community', requireAuth, communityController.showCreateCommunity);
router.post('/create-community', requireAuth, communityController.createCommunity);
router.get('/manage/:id', requireAuth, communityController.showManageCommunity);
router.post('/manage/:id', requireAuth, communityController.updateCommunity);
router.post('/manage/:id/delete', requireAuth, communityController.deleteCommunity);

  
router.get('/', (req, res) => {
    res.render('community');
});

module.exports = router;
