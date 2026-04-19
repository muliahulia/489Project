var express = require('express');
var router = express.Router();

/* LIST PAGE */
router.get('/', (req, res) => {
    res.render('communities');
  });



router.get('/manage', (req, res) => {
  res.render('manage-community');
});


module.exports = router