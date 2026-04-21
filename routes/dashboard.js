var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');
const { buildDisplayName, buildInitials } = require('../lib/utils');

const DEFAULT_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'media';
const SIGNED_IMAGE_TTL_SECONDS = 120;

function buildFirstName(firstName, email) {
  const first = typeof firstName === 'string' ? firstName.trim() : '';
  if (first) {
    return first;
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

function normalizeStoragePath(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

async function buildSignedImageUrl(supabase, bucket, objectPath) {
  const path = normalizeStoragePath(objectPath);
  if (!path) {
    return null;
  }

  const storageBucket =
    typeof bucket === 'string' && bucket.trim() ? bucket.trim() : DEFAULT_STORAGE_BUCKET;

  try {
    const { data, error } = await supabase.storage
      .from(storageBucket)
      .createSignedUrl(path, SIGNED_IMAGE_TTL_SECONDS);

    if (error || !data || !data.signedUrl) {
      return null;
    }

    return data.signedUrl;
  } catch (_err) {
    return null;
  }
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
    logoBucket: row && row.logo_bucket ? row.logo_bucket : DEFAULT_STORAGE_BUCKET,
    logoPath: normalizeStoragePath(row && row.logo_path),
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
      .select('id,name,logo_bucket,logo_path')
      .in('id', communityIds)
      .order('name', { ascending: true });

    if (communityResult.error || !communityResult.data) {
      return [];
    }

    const communities = communityResult.data.map((row, index) => normalizeCommunity(row, index));
    const signedUrls = await Promise.all(
      communities.map((community) =>
        buildSignedImageUrl(supabase, community.logoBucket, community.logoPath)
      )
    );

    signedUrls.forEach((url, index) => {
      communities[index].imageUrl = url;
    });

    return communities;
  } catch (_err) {
    return [];
  }
}

router.get('/', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const userId = sessionUser.id;

  let profile = null;
  let courses = [];
  let communities = [];

  try {
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
      .from('profiles')
      .select('id,first_name,last_name,email,role')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data) {
      profile = data;
    }

    courses = await fetchAffiliatedCourses(supabase, userId);
    communities = await fetchAffiliatedCommunities(supabase, userId);
  } catch (err) {
    console.log('DASHBOARD ERROR:', err);
  }

  const profileFirstName = profile?.first_name || sessionUser.firstName || null;
  const profileLastName = profile?.last_name || sessionUser.lastName || null;
  const email = profile?.email || sessionUser.email || null;

  const fullName = buildDisplayName(
    profileFirstName,
    profileLastName,
    email,
    { fallback: 'there' }
  );

  const dashboardUser = {
    id: userId,
    email,
    role: profile?.role || sessionUser.role || 'student',
    firstName: buildFirstName(profileFirstName, email),
    lastName: profileLastName,
    fullName,
    initials: buildInitials(profileFirstName, profileLastName, email, { fallback: '?' }),
  };

  return res.render('dashboard', {
    user: dashboardUser,
    courses,
    communities,
  });
});

module.exports = router;