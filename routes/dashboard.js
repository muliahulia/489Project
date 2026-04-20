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
  const name = (row && row.name && String(row.name).trim()) || 'Untitled Course';

  return {
    id: row.id || name,
    name,
    imageUrl: null,
    bubbleText: bubbleTextFromName(name),
  };
}

function normalizeCommunity(row, index) {
  const name = (row && row.name && String(row.name).trim()) || 'Untitled Community';

  return {
    id: row.id || name,
    name,
    imageUrl: null,
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
      .select('id,name')
      .in('id', courseIds)
      .order('name', { ascending: true });

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
      .select('id,name')
      .in('id', communityIds)
      .order('name', { ascending: true });

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
      .select('id,full_name,email,role')
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
    (profile && profile.full_name) ||
    sessionUser.fullName ||
    (profile && profile.email) ||
    sessionUser.email;

  const dashboardUser = {
    id: sessionUser.id,
    email: (profile && profile.email) || sessionUser.email,
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