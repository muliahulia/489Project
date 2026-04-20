function attachSessionUser(req, res, next) {
  const authSession = req.session && req.session.auth;
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
