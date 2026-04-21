var express = require('express');
var router = express.Router();
const { createSupabaseAnonClient, createSupabaseAdminClient } = require('../lib/supabase');

function wantsJson(req) {
  const accept = req.get('accept') || '';
  return req.is('application/json') || accept.includes('application/json');
}

function getRequestBody(req, fields) {
  const source = req.body || {};
  const result = {};
  fields.forEach((field) => {
    result[field] = typeof source[field] === 'string' ? source[field].trim() : source[field];
  });
  return result;
}

function sendFailure(req, res, status, message) {
  if (wantsJson(req)) {
    return res.status(status).json({ error: message });
  }
  return res.redirect(`/login?error=${encodeURIComponent(message)}`);
}

function joinName(firstName, lastName) {
  const first = typeof firstName === 'string' ? firstName.trim() : '';
  const last = typeof lastName === 'string' ? lastName.trim() : '';
  return [first, last].filter(Boolean).join(' ').trim() || null;
}

async function resolveProfileRole(userId) {
  if (!userId) {
    return null;
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data || typeof data.role !== 'string' || !data.role.trim()) {
      return null;
    }

    return data.role.trim();
  } catch (_err) {
    return null;
  }
}
router.get('/login', (req, res) => {
  res.render('login', { error: req.query.error || null });
});

router.get('/createAccount', (req, res) => res.render('createAccount'));
router.get('/CreateAccount', (req, res) => res.render('createAccount'));

router.get('/forgotpassword', (req, res) => {
  res.render('ForgotPassword', { error: req.query.error || null });
});
router.get('/ForgotPassword', (req, res) => res.redirect('/forgotpassword'));

router.post('/login', async (req, res) => {
  const { email, password } = getRequestBody(req, ['email', 'password']);

  if (!email || !password) {
    return sendFailure(req, res, 400, 'Email and password are required.');
  }

  const supabase = createSupabaseAnonClient();
  const result = await supabase.auth.signInWithPassword({ email, password });

  const loginData = result.data;
  const loginError = result.error;

  if (loginError || !loginData || !loginData.user || !loginData.session) {
    return sendFailure(req, res, 401, loginError ? loginError.message : 'Invalid login.');
  }
  const profileRole = await resolveProfileRole(loginData.user.id);
  const metadataRole =
    loginData.user.user_metadata && loginData.user.user_metadata.role
      ? loginData.user.user_metadata.role
      : null;

  req.session.auth = {
    user: {
      id: loginData.user.id,
      email: loginData.user.email,
      role: profileRole || metadataRole || 'student',
      firstName:
        loginData.user.user_metadata && loginData.user.user_metadata.first_name
          ? loginData.user.user_metadata.first_name
          : null,
      lastName:
        loginData.user.user_metadata && typeof loginData.user.user_metadata.last_name === 'string'
          ? loginData.user.user_metadata.last_name
          : null,
      fullName: joinName(
        loginData.user.user_metadata && loginData.user.user_metadata.first_name,
        loginData.user.user_metadata && loginData.user.user_metadata.last_name
      ),
    },
    accessToken: loginData.session.access_token,
    refreshToken: loginData.session.refresh_token,
  };

  if (wantsJson(req)) {
    return res.json({ ok: true, redirectTo: '/dashboard' });
  }
  return res.redirect('/dashboard');
});

router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, role, schoolName } = getRequestBody(req, [
    'firstName', 'lastName', 'email', 'password', 'role', 'schoolName',
  ]);

  if (!firstName || !email || !password) {
    return sendFailure(req, res, 400, 'Missing required signup fields.');
  }

  const supabase = createSupabaseAnonClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName || null,
        role: role || 'student',
        school_name: schoolName || null,
      },
    },
  });

  if (error) {
    return sendFailure(req, res, 400, error.message);
  }

  if (wantsJson(req)) {
    return res.status(201).json({ ok: true, message: 'Check your email to confirm.' });
  }
  return res.redirect('/login');
});

router.post('/logout', async (req, res) => {
  if (req.session.auth?.accessToken) {
    const supabase = createSupabaseAnonClient();
    await supabase.auth.setSession({
      access_token: req.session.auth.accessToken,
      refresh_token: req.session.auth.refreshToken,
    });
    await supabase.auth.signOut();
  }

  req.session.destroy(() => {
    if (wantsJson(req)) return res.json({ ok: true });
    return res.redirect('/login');
  });
});

router.post('/forgotpassword', async (req, res) => {
  const { email } = getRequestBody(req, ['email']);
  if (!email) return sendFailure(req, res, 400, 'Email is required.');

  const supabase = createSupabaseAnonClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);

  if (error) return sendFailure(req, res, 400, error.message);

  if (wantsJson(req)) return res.json({ ok: true });
  return res.redirect('/login');
});

module.exports = router;
