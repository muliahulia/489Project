const { createSupabaseAdminClient } = require('../lib/supabase');

async function attachSessionUser(req, res, next) {
  const authSession = req.session && req.session.auth;

  if (authSession && authSession.user && authSession.user.id) {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authSession.user.id)
        .maybeSingle();

      if (!error && data && typeof data.role === 'string' && data.role.trim()) {
        authSession.user.role = data.role.trim();
      }
    } catch (_err) {
      // Keep existing session role when profile lookup fails.
    }
  }

  res.locals.currentUser = authSession ? authSession.user : null;
  next();
}

function requireAuth(req, res, next) {
  const isLoggedIn = Boolean(req.session && req.session.auth && req.session.auth.user);

  if (isLoggedIn) {
    return next();
  }

  return res.redirect('/login');
}

module.exports = {
  attachSessionUser,
  requireAuth,
};
