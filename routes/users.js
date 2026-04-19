var express = require('express');
var router = express.Router();

router.get('/:id', (req, res) => {
  res.render('profile');
});

router.post('/follow/:id', (req, res) => {
  // UC-010
});

module.exports = router;