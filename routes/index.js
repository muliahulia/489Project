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
const pool = require('../db');

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
