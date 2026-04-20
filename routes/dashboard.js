var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');

function buildInitials(fullName, email) {
  if (fullName && typeof fullName === 'string') {
    const parts = fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
  }

  if (email && typeof email === 'string') {
    return email.slice(0, 2).toUpperCase();
  }

  return '?';
}

function buildFirstName(fullName, email) {
  if (fullName && typeof fullName === 'string') {
    const trimmed = fullName.trim();
    if (trimmed) {
      return trimmed.split(/\s+/)[0];
    }
  }

  if (email && typeof email === 'string') {
    const localPart = email.split('@')[0];
    if (localPart) {
      return localPart;
    }
  }

  return 'there';
}

function pickFirstString(source, keys) {
  for (const key of keys) {
    const value = source && source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function bubbleTextFromName(name) {
  if (!name) {
    return 'N/A';
  }

  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return parts[0].slice(0, 3).toUpperCase();
}

function normalizeCourse(row) {
  const name = pickFirstString(row, ['name', 'title', 'course_name']) || 'Untitled Course';
  const code = pickFirstString(row, ['code', 'course_code', 'short_code']);
  const imageUrl = pickFirstString(row, ['logo_url', 'image_url', 'icon_url', 'avatar_url']);

  return {
    id: row.id || row.course_id || name,
    name,
    code,
    imageUrl,
    bubbleText: (code || bubbleTextFromName(name)).slice(0, 10).toUpperCase(),
  };
}

function normalizeCommunity(row, index) {
  const name = pickFirstString(row, ['name', 'title', 'community_name']) || 'Untitled Community';
  const imageUrl = pickFirstString(row, ['logo_url', 'image_url', 'icon_url', 'avatar_url']);

  return {
    id: row.id || row.community_id || name,
    name,
    imageUrl,
    bubbleText: bubbleTextFromName(name),
    colorClass: `community-${(index % 5) + 1}`,
  };
}

async function fetchAffiliatedCourses(supabase, userId) {
  try {
    const membershipResult = await supabase
      .from('course_enrollments')
      .select('course_id')
      .eq('user_id', userId);

    if (membershipResult.error || !membershipResult.data || membershipResult.data.length === 0) {
      return [];
    }

    const courseIds = membershipResult.data
      .map((row) => row.course_id)
      .filter(Boolean);

    if (courseIds.length === 0) {
      return [];
    }

    const courseResult = await supabase
      .from('courses')
      .select('*')
      .in('id', courseIds);

    if (courseResult.error || !courseResult.data) {
      return [];
    }

    return courseResult.data.map(normalizeCourse);
  } catch (_err) {
    return [];
  }
}

async function fetchAffiliatedCommunities(supabase, userId) {
  try {
    const membershipResult = await supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', userId);

    if (membershipResult.error || !membershipResult.data || membershipResult.data.length === 0) {
      return [];
    }

    const communityIds = membershipResult.data
      .map((row) => row.community_id)
      .filter(Boolean);

    if (communityIds.length === 0) {
      return [];
    }

    const communityResult = await supabase
      .from('communities')
      .select('*')
      .in('id', communityIds);

    if (communityResult.error || !communityResult.data) {
      return [];
    }

    return communityResult.data.map((row, index) => normalizeCommunity(row, index));
  } catch (_err) {
    return [];
  }
}

router.get('/', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  let profile = null;
  let courses = [];
  let communities = [];

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', sessionUser.id)
      .maybeSingle();

    if (!error && data) {
      profile = data;
    }

    courses = await fetchAffiliatedCourses(supabase, sessionUser.id);
    communities = await fetchAffiliatedCommunities(supabase, sessionUser.id);
  } catch (_err) {
    // If profile lookup fails, keep rendering from session data.
  }

  const fullName =
    (profile && (profile.full_name || profile.display_name || profile.username)) ||
    sessionUser.fullName ||
    sessionUser.email;

  const dashboardUser = {
    id: sessionUser.id,
    email: sessionUser.email,
    role: (profile && profile.role) || sessionUser.role || 'student',
    fullName,
    firstName: buildFirstName(fullName, sessionUser.email),
    initials: buildInitials(fullName, sessionUser.email),
  };

  return res.render('dashboard', {
    user: dashboardUser,
    courses,
    communities,
  });
});

module.exports = router;