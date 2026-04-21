var express = require('express');
var router = express.Router();

router.get('/', (req, res) => {
    res.render('accountmoderation');
  });

router.get('/', (req, res) => {
  res.render('communitymoderator');
});

router.get('/', (req, res) => {
  res.render('schoolmoderation');
});

router.get('/', (req, res) => {
  res.render('reportDashboard');
});


module.exports = router;