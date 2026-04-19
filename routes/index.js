var express = require('express');
var router = express.Router();

/* Home */
router.get('/', function(req, res) {
  res.render('index', { title: 'Home' });
});

/* Dashboard */
router.get('/dashboard', function(req, res) {
  res.render('dashboard');
});

router.get('/login', function(req, res) {
  res.render('login'); // NOT login.html
});

module.exports = router;
