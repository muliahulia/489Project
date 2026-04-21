var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');
const { buildProfilePath, buildProfileSlug } = require('../lib/utils');

const PROFILE_SELECT_COLUMNS = 'id,first_name,last_name,email,role,bio,created_at';

async function fetchProfileById(supabase, userId) {
  if (!userId) {
    return { profile: null, error: null };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { profile: null, error };
  }

  return { profile: data || null, error: null };
}

function renderProfileNotFound(req, res) {
  return res.status(404).render('error', {
    message: 'Profile not found.',
    error: req.app.get('env') === 'development' ? new Error('Profile not found.') : {},
  });
}

async function renderProfileByUserId(req, res, userId, options = {}) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  if (!normalizedUserId) {
    return renderProfileNotFound(req, res);
  }

  const supabase = createSupabaseAdminClient();
  const { profile, error } = await fetchProfileById(supabase, normalizedUserId);

  if (error) {
    return res.status(500).render('error', {
      message: 'Unable to load profile.',
      error: req.app.get('env') === 'development' ? error : {},
    });
  }

  if (!profile) {
    return renderProfileNotFound(req, res);
  }

  const canonicalPath = buildProfilePath(profile.id, profile.first_name, profile.last_name);
  const canonicalSlug = buildProfileSlug(profile.first_name, profile.last_name);
  const requestedSlug = typeof options.requestedSlug === 'string'
    ? options.requestedSlug.trim().toLowerCase()
    : '';
  const shouldRedirectToCanonical = Boolean(options.forceCanonicalRedirect)
    || requestedSlug !== canonicalSlug;

  if (shouldRedirectToCanonical) {
    return res.redirect(canonicalPath);
  }

  const sessionUser = req.session.auth.user;
  const profileWithFallbacks = { ...profile };
  if (profile.id === sessionUser.id && !profileWithFallbacks.email) {
    profileWithFallbacks.email = sessionUser.email || null;
  }

  res.render('profile', {
    user: { ...sessionUser, ...profileWithFallbacks },
    profile: profileWithFallbacks,
    posts: [],
  });
}

router.get('/', requireAuth, async (req, res) => {
  const sessionUserId = req.session.auth.user.id;
  return renderProfileByUserId(req, res, sessionUserId, {
    forceCanonicalRedirect: true,
  });
});

router.get('/:userId', requireAuth, async (req, res) => {
  return renderProfileByUserId(req, res, req.params.userId, {
    forceCanonicalRedirect: true,
  });
});

router.get('/:userId/:nameSlug', requireAuth, async (req, res) => {
  return renderProfileByUserId(req, res, req.params.userId, {
    requestedSlug: req.params.nameSlug,
  });
});

module.exports = router;
