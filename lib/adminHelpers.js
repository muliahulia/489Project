const { normalizeRole } = require('./schoolScope');

function requireGlobalAdmin(req, res, next) {
  const role = normalizeRole(
    req
    && req.session
    && req.session.auth
    && req.session.auth.user
      ? req.session.auth.user.role
      : ''
  );

  if (role === 'admin') {
    return next();
  }

  const err = new Error('Forbidden');
  err.status = 403;
  return next(err);
}

async function logAdminAction(supabase, payload) {
  if (!supabase || !payload || typeof payload !== 'object') {
    return;
  }

  const insertPayload = {
    admin_id: payload.adminId || null,
    action_type: payload.actionType || 'unknown',
    target_type: payload.targetType || null,
    target_id: Number.isInteger(payload.targetId) ? payload.targetId : null,
    target_user_id: payload.targetUserId || null,
    description: payload.description || null,
  };

  const { error } = await supabase
    .from('admin_actions')
    .insert(insertPayload);

  if (error) {
    throw error;
  }
}

module.exports = {
  requireGlobalAdmin,
  logAdminAction,
};
