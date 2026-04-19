var express = require('express');
var router = express.Router();

router.get('/', (req, res) => {
  res.render('feed');
});

router.get('/post', (req, res) => {
  res.render('post');
});

module.exports = router;