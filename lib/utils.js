const { idsMatch } = require('./schoolScope');

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

function slugifyNamePart(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildProfileSlug(firstName, lastName) {
  const first = slugifyNamePart(firstName);
  const last = slugifyNamePart(lastName);
  const slug = [first, last].filter(Boolean).join('-');

  return slug || 'profile';
}

function buildProfilePath(userId, firstName, lastName) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';

  if (!normalizedUserId) {
    return '/profile';
  }

  const nameSlug = buildProfileSlug(firstName, lastName);
  return `/profile/${encodeURIComponent(normalizedUserId)}/${nameSlug}`;
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

async function fetchAffiliations(supabase, userId, options = {}) {
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
  const schoolScoped = !Boolean(options.isGlobalAdmin);
  const schoolId = options.schoolId || null;

  const [coursesResult, communitiesResult] = await Promise.all([
    courseIds.length > 0
      ? (() => {
          let request = supabase
            .from('courses')
            .select('id,name,school_id')
            .in('id', courseIds)
            .order('name', { ascending: true });

          if (schoolScoped) {
            if (!schoolId) {
              return Promise.resolve({ data: [], error: null });
            }
            request = request.eq('school_id', schoolId);
          }

          return request;
        })()
      : Promise.resolve({ data: [], error: null }),
    communityIds.length > 0
      ? supabase
          .from('communities')
          .select('id,name,creator_id')
          .in('id', communityIds)
          .order('name', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const rawCourses = Array.isArray(coursesResult.data) ? coursesResult.data : [];
  const rawCommunities = Array.isArray(communitiesResult.data) ? communitiesResult.data : [];
  let filteredCommunities = rawCommunities;

  if (schoolScoped) {
    if (!schoolId) {
      filteredCommunities = [];
    } else if (rawCommunities.length > 0) {
      const creatorIds = [...new Set(rawCommunities.map((row) => row.creator_id).filter(Boolean))];
      if (creatorIds.length === 0) {
        filteredCommunities = [];
      } else {
        const { data: creatorRows, error: creatorError } = await supabase
          .from('profiles')
          .select('id,school_id')
          .in('id', creatorIds);

        if (creatorError || !Array.isArray(creatorRows)) {
          filteredCommunities = [];
        } else {
          const creatorSchoolIdById = new Map(
            creatorRows.map((row) => [row.id, row.school_id || null])
          );
          filteredCommunities = rawCommunities.filter((row) =>
            idsMatch(creatorSchoolIdById.get(row.creator_id), schoolId)
          );
        }
      }
    }
  }

  return {
    courseIds: rawCourses.map((row) => row.id).filter(Boolean),
    communityIds: filteredCommunities.map((row) => row.id).filter(Boolean),
    courses: rawCourses.map((row) => ({ id: row.id, name: row.name })),
    communities: filteredCommunities.map((row) => ({ id: row.id, name: row.name })),
  };
}

module.exports = {
  buildDisplayName,
  buildInitials,
  buildProfileSlug,
  buildProfilePath,
  formatCreatedAt,
  buildPostScopeFilter,
  fetchAffiliations,
};
