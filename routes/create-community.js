var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  return res.redirect('/communities/create-community');
});

module.exports = router;
