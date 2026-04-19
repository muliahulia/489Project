var express = require('express');
var router = express.Router();

router.get('/', (req, res) => {
  res.render('communities');
});

router.get('/create', (req, res) => {
  res.render('create-community');
});

router.get('/manage', (req, res) => {
  res.render('manage-community');
});

module.exports = router;