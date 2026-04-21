function buildDisplayName(firstName, lastName, email, options = {}) {
  const fallback = typeof options.fallback === 'string' ? options.fallback : 'Unknown User';
  const first = typeof firstName === 'string' ? firstName.trim() : '';
  const last = typeof lastName === 'string' ? lastName.trim() : '';
  const name = [first, last].filter(Boolean).join(' ').trim();

  if (name) {
    return name;
  }

  if (email && typeof email === 'string') {
    return email;
  }

  return fallback;
}

function buildInitials(firstName, lastName, email, options = {}) {
  const fallback = typeof options.fallback === 'string' ? options.fallback : 'UC';
  const first = typeof firstName === 'string' ? firstName.trim() : '';
  const last = typeof lastName === 'string' ? lastName.trim() : '';

  if (first && last) {
    return `${first[0]}${last[0]}`.toUpperCase();
  }

  if (first.length >= 2) {
    return first.slice(0, 2).toUpperCase();
  }

  if (first.length === 1) {
    return first[0].toUpperCase();
  }

  if (email && typeof email === 'string') {
    return email.slice(0, 2).toUpperCase();
  }

  return fallback;
}

function formatCreatedAt(timestamp, options = {}) {
  const fallback = typeof options.fallback === 'string' ? options.fallback : 'Unknown date';

  if (!timestamp) {
    return fallback;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildPostScopeFilter(courseIds, communityIds, userId) {
  const clauses = [`author_id.eq.${userId}`];

  if (Array.isArray(courseIds) && courseIds.length > 0) {
    clauses.push(`course_id.in.(${courseIds.join(',')})`);
  }

  if (Array.isArray(communityIds) && communityIds.length > 0) {
    clauses.push(`community_id.in.(${communityIds.join(',')})`);
  }

  return clauses.join(',');
}

async function fetchAffiliations(supabase, userId) {
  const [courseMembershipResult, communityMembershipResult] = await Promise.all([
    supabase
      .from('course_enrollments')
      .select('course_id')
      .eq('user_id', userId),
    supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', userId),
  ]);

  const courseIds = (courseMembershipResult.data || [])
    .map((row) => row.course_id)
    .filter(Boolean);

  const communityIds = (communityMembershipResult.data || [])
    .map((row) => row.community_id)
    .filter(Boolean);

  const [coursesResult, communitiesResult] = await Promise.all([
    courseIds.length > 0
      ? supabase.from('courses').select('id,name').in('id', courseIds).order('name', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    communityIds.length > 0
      ? supabase.from('communities').select('id,name').in('id', communityIds).order('name', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  return {
    courseIds,
    communityIds,
    courses: coursesResult.data || [],
    communities: communitiesResult.data || [],
  };
}

module.exports = {
  buildDisplayName,
  buildInitials,
  formatCreatedAt,
  buildPostScopeFilter,
  fetchAffiliations,
};
