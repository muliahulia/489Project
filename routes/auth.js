var express = require('express');
var router = express.Router();

router.get('/login', (req, res) => {
  res.render('login');
});

router.get('/CreateAccount', (req, res) => {
  res.render('createAccount');
});

router.post('/login', (req, res) => {
  res.redirect('/dashboard');
});

router.post('/signup', (req, res) => {
  res.redirect('/login');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});
// FORGOT PASSWORD
router.get('/forgotpassword', (req, res) => {
    res.render('/forgotpassword');
  });
  

module.exports = router;