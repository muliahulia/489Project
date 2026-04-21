var express = require('express');
var router = express.Router();

router.get('/', async (req, res) => {
  const user = req.session?.auth?.user || null;

  // TEMP empty data so EJS doesn't crash
  const posts = [];
  const courses = [];
  const communities = [];

  res.render('feed', {
    user,
    posts,
    courses,
    communities,
    formError: null
  });
});

module.exports = router;