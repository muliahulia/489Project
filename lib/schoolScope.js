function normalizeRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

function idsMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  return String(left) === String(right);
}

function isGlobalAdminRole(role) {
  return normalizeRole(role) === 'admin';
}

async function fetchViewerSchoolContext(supabase, sessionUser) {
  const fallbackRole = normalizeRole(sessionUser && sessionUser.role) || 'student';
  const fallbackSchoolId = sessionUser && sessionUser.schoolId ? sessionUser.schoolId : null;
  const fallback = {
    id: sessionUser && sessionUser.id ? sessionUser.id : null,
    role: fallbackRole,
    schoolId: fallbackSchoolId,
    isGlobalAdmin: isGlobalAdminRole(fallbackRole),
    profile: null,
  };

  if (!fallback.id) {
    return fallback;
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,role,school_id')
      .eq('id', fallback.id)
      .maybeSingle();

    if (error || !data) {
      return fallback;
    }

    const role = normalizeRole(data.role) || fallback.role;
    const schoolId = data.school_id || fallback.schoolId || null;

    return {
      id: data.id,
      role,
      schoolId,
      isGlobalAdmin: isGlobalAdminRole(role),
      profile: data,
    };
  } catch (_err) {
    return fallback;
  }
}

function canAccessSchoolId(viewerContext, targetSchoolId) {
  if (viewerContext && viewerContext.isGlobalAdmin) {
    return true;
  }

  if (!viewerContext || !viewerContext.schoolId || !targetSchoolId) {
    return false;
  }

  return idsMatch(viewerContext.schoolId, targetSchoolId);
}

function canAccessProfile(viewerContext, profile) {
  if (!profile) {
    return false;
  }

  if (viewerContext && viewerContext.id && idsMatch(viewerContext.id, profile.id)) {
    return true;
  }

  return canAccessSchoolId(viewerContext, profile.school_id);
}

function buildSchoolScopeOptions(viewerContext) {
  return {
    schoolId: viewerContext && viewerContext.schoolId ? viewerContext.schoolId : null,
    isGlobalAdmin: Boolean(viewerContext && viewerContext.isGlobalAdmin),
  };
}

module.exports = {
  normalizeRole,
  idsMatch,
  isGlobalAdminRole,
  fetchViewerSchoolContext,
  canAccessSchoolId,
  canAccessProfile,
  buildSchoolScopeOptions,
};
