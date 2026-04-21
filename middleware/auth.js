const { createSupabaseAdminClient } = require('../lib/supabase');
const { resolveProfileMedia } = require('../lib/profileMedia');

async function attachSessionUser(req, res, next) {
  const authSession = req.session && req.session.auth;

  if (authSession && authSession.user && authSession.user.id) {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authSession.user.id)
        .maybeSingle();

      if (!error && data) {
        if (typeof data.role === 'string' && data.role.trim()) {
          authSession.user.role = data.role.trim();
        }

        if (typeof data.first_name === 'string') {
          authSession.user.firstName = data.first_name;
        }

        if (typeof data.last_name === 'string') {
          authSession.user.lastName = data.last_name;
        }

        if (typeof data.email === 'string' && data.email.trim()) {
          authSession.user.email = data.email.trim();
        }

        const media = await resolveProfileMedia(supabase, data);
        authSession.user.profileAvatarUrl = media.avatarUrl || null;
      }
    } catch (_err) {
      // Keep existing session role when profile lookup fails.
    }
  }

  res.locals.currentUser = authSession ? authSession.user : null;
  res.locals.user = authSession ? authSession.user : null;
  next();
}

function requireAuth(req, res, next) {
  if (req.session?.auth?.user) return next();
  return res.redirect('/login');
}

module.exports = { attachSessionUser, requireAuth };
