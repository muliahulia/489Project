var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');

router.get('/', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', sessionUser.id)
    .single();

  res.render('settings', { user: sessionUser, profile: data || {} });
});

router.post('/update', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const { first_name, last_name, bio } = req.body;

  const supabase = createSupabaseAdminClient();
  
  const { error } = await supabase
    .from('profiles')
    .upsert({
      id: sessionUser.id,
      email: sessionUser.email,
      first_name,
      last_name,
      bio,
    });

  if (error) {
    console.error('Settings update error:', error);
    return res.redirect('/settings');
  }

  if (req.session.auth && req.session.auth.user) {
    req.session.auth.user.firstName = first_name;
    req.session.auth.user.lastName = last_name;
    req.session.auth.user.bio = bio;
  }

  return res.redirect('/profile');
});

module.exports = router;