var express = require('express');
var router = express.Router();

router.get('/account', (req, res) => {
  res.render('accountmoderation');
});

router.get('/community', (req, res) => {
  res.render('communitymoderator');
});

router.get('/school', (req, res) => {
  res.render('schoolmoderation');
});

router.get('/reports', (req, res) => {
  res.redirect('/admin/reports');
});

router.get('/', (req, res) => {
  res.render('report');
});

module.exports = router;
