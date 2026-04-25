var express = require('express');
var router = express.Router();
const pool = require('../db');

/* Home */
router.get('/', function(req, res) {
  res.render('index', { title: 'Home' });
});

router.get('/login', function(req, res) {
  res.render('login', {
    error: req.query.error || null,
  });
});

/* DB test */
router.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('DB error');
  }
});

module.exports = router;
