function wantsJson(req, options = {}) {
  const includeXhr = options.includeXhr !== false;
  const includeContentType = Boolean(options.includeContentType);
  const acceptHeader = req && typeof req.get === 'function'
    ? ((req.get('Accept') || req.get('accept')) || '')
    : '';

  if (includeXhr && req && req.xhr) {
    return true;
  }

  if (includeContentType && req && typeof req.is === 'function' && req.is('application/json')) {
    return true;
  }

  return acceptHeader.includes('application/json');
}

module.exports = {
  wantsJson,
};
