var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');
router.get('/', requireAuth, async (req, res) => {
  const userId = req.session.auth.user.id;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  console.log('USER ID:', userId);
  console.log('PROFILE DATA:', data);
  console.log('PROFILE ERROR:', error);

  const profile = data || {};

  res.render('profile', {
    user: { ...req.session.auth.user, ...profile },
    profile,
    posts: [],
  });
});

module.exports = router;