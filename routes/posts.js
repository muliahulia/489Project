var express = require('express');
var router = express.Router();

router.post('/', (req, res) => {
  // UC-005 create post
});

router.post('/:id/react', (req, res) => {
  // UC-006
});

router.post('/:id/comment', (req, res) => {
  // UC-007
});

router.post('/:id/report', (req, res) => {
  // UC-008
});

module.exports = router;