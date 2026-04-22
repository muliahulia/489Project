const { buildDisplayName, buildInitials } = require('./utils');
const { normalizeRole } = require('./schoolScope');

function buildBubbleText(name, options = {}) {
  const fallback = typeof options.fallback === 'string' ? options.fallback : 'N/A';
  const singleWordLength =
    Number.isInteger(options.singleWordLength) && options.singleWordLength > 0
      ? options.singleWordLength
      : 4;

  if (!name || typeof name !== 'string') {
    return fallback;
  }

  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return fallback;
  }

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return parts[0].slice(0, singleWordLength).toUpperCase();
}

function buildProfileDisplayName(profile, options = {}) {
  const fallback = typeof options.fallback === 'string' ? options.fallback : 'Unknown User';
  if (!profile) {
    return fallback;
  }

  return buildDisplayName(profile.first_name, profile.last_name, profile.email, { fallback });
}

function buildSessionFallbackUser(sessionUser, options = {}) {
  const includeRole = Boolean(options.includeRole);
  const roleFallback = typeof options.roleFallback === 'string' ? options.roleFallback : 'student';

  const result = {
    id: sessionUser && sessionUser.id ? sessionUser.id : null,
    firstName: (sessionUser && sessionUser.firstName) || null,
    lastName: (sessionUser && sessionUser.lastName) || null,
    fullName: buildDisplayName(
      sessionUser && sessionUser.firstName,
      sessionUser && sessionUser.lastName,
      sessionUser && sessionUser.email
    ),
    email: (sessionUser && sessionUser.email) || null,
    initials: buildInitials(
      sessionUser && sessionUser.firstName,
      sessionUser && sessionUser.lastName,
      sessionUser && sessionUser.email
    ),
    profileAvatarUrl: (sessionUser && sessionUser.profileAvatarUrl) || null,
  };

  if (includeRole) {
    result.role = normalizeRole(sessionUser && sessionUser.role) || roleFallback;
  }

  return result;
}

function buildAuthorRoleMeta(role) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === 'admin') {
    return {
      normalizedRole,
      roleLabel: 'UniConnect Admin',
    };
  }

  if (normalizedRole === 'official') {
    return {
      normalizedRole,
      roleLabel: 'School Official',
    };
  }

  return {
    normalizedRole,
    roleLabel: null,
  };
}

module.exports = {
  buildBubbleText,
  buildProfileDisplayName,
  buildSessionFallbackUser,
  buildAuthorRoleMeta,
};
