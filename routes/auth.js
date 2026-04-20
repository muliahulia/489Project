var express = require('express');
var router = express.Router();
const { createSupabaseAnonClient } = require('../lib/supabase');

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

function clearAuthSession(req) {
  if (req.session) {
    delete req.session.auth;
  }
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

router.get('/login', (req, res) => {
  res.render('login', {
    error: req.query.error || null,
  });
});

router.get('/CreateAccount', (req, res) => {
  res.render('createAccount');
});

router.get('/createAccount', (req, res) => {
  res.render('createAccount');
});

router.get('/forgotpassword', (req, res) => {
  res.render('ForgotPassword', {
    error: req.query.error || null,
  });
});

router.get('/ForgotPassword', (req, res) => {
  res.redirect('/forgotpassword');
});

router.post('/login', async (req, res) => {
  const { email, password } = getRequestBody(req, ['email', 'password']);

  if (!email || !password) {
    return sendFailure(req, res, 400, 'Email and password are required.');
  }

  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    return sendFailure(req, res, 401, error ? error.message : 'Invalid email or password.');
  }

  req.session.auth = {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: {
      id: data.user.id,
      email: data.user.email,
      role: data.user.user_metadata && data.user.user_metadata.role ? data.user.user_metadata.role : 'student',
      firstName:
        data.user.user_metadata && data.user.user_metadata.first_name
          ? data.user.user_metadata.first_name
          : null,
      lastName:
        data.user.user_metadata && typeof data.user.user_metadata.last_name === 'string'
          ? data.user.user_metadata.last_name
          : null,
      fullName: joinName(
        data.user.user_metadata && data.user.user_metadata.first_name,
        data.user.user_metadata && data.user.user_metadata.last_name
      ),
    },
  };

  if (wantsJson(req)) {
    return res.json({ ok: true, redirectTo: '/dashboard' });
  }

  return res.redirect('/dashboard');
});

router.post('/signup', async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    role,
    schoolName,
  } = getRequestBody(req, ['firstName', 'lastName', 'email', 'password', 'role', 'schoolName']);

  if (!firstName || !email || !password) {
    return sendFailure(req, res, 400, 'Missing required signup fields.');
  }
  const normalizedLastName = typeof lastName === 'string' && lastName.trim() ? lastName.trim() : null;
  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: normalizedLastName,
        role: role || 'student',
        school_name: schoolName || null,
      },
      emailRedirectTo: process.env.SUPABASE_EMAIL_REDIRECT_TO || undefined,
    },
  });

  if (error) {
    return sendFailure(req, res, 400, error.message);
  }

  if (wantsJson(req)) {
    return res.status(201).json({
      ok: true,
      requiresEmailVerification: !data.session,
      message: data.session ? 'Signup complete.' : 'Signup created. Check your email to confirm your account.',
    });
  }

  return res.redirect('/login');
});

router.post('/logout', async (req, res) => {
  const authSession = req.session && req.session.auth;

  if (authSession && authSession.accessToken && authSession.refreshToken) {
    const supabase = createSupabaseAnonClient();
    await supabase.auth.setSession({
      access_token: authSession.accessToken,
      refresh_token: authSession.refreshToken,
    });
    await supabase.auth.signOut();
  }

  clearAuthSession(req);

  req.session.destroy(() => {
    if (wantsJson(req)) {
      return res.json({ ok: true });
    }
    return res.redirect('/login');
  });
});

router.post('/forgotpassword', async (req, res) => {
  const { email } = getRequestBody(req, ['email']);

  if (!email) {
    return sendFailure(req, res, 400, 'Email is required.');
  }

  const supabase = createSupabaseAnonClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: process.env.SUPABASE_PASSWORD_RESET_REDIRECT_TO || undefined,
  });

  if (error) {
    return sendFailure(req, res, 400, error.message);
  }

  if (wantsJson(req)) {
    return res.json({ ok: true, message: 'If your email exists, a reset link has been sent.' });
  }

  return res.redirect('/login');
});
  

module.exports = router;
