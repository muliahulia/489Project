var express = require('express');
var router = express.Router();

/* LIST PAGE */
router.get('/', (req, res) => {
    res.render('communities');
  });
module.exports = router;