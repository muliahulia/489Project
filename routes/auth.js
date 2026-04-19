var express = require('express');
var router = express.Router();

router.get('/login', (req, res) => res.render('login'));
router.post('/login', (req, res) => { /* UC-001 */ });

router.get('/signup', (req, res) => res.render('signup'));
router.post('/signup', (req, res) => { /* UC-002 */ });

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;