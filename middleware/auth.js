function attachSessionUser(req, res, next) {
  res.locals.user = req.session?.auth?.user || null;
  next();
}

function requireAuth(req, res, next) {
  if (req.session?.auth?.user) return next();
  return res.redirect('/login');
}

module.exports = { attachSessionUser, requireAuth };