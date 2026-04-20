var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  res.render('dashboard');
});

module.exports = router;