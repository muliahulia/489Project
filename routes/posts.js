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

  return 'UC';
}

function formatCreatedAt(timestamp) {
  if (!timestamp) {
    return 'Unknown date';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
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

  if (courseIds.length > 0) {
    clauses.push(`course_id.in.(${courseIds.join(',')})`);
  }

  if (communityIds.length > 0) {
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

router.get('/', (req, res) => {
  return res.redirect('/feed');
});

router.get('/:id', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const postId = Number.parseInt(req.params.id, 10);

  const fallbackUser = {
    id: sessionUser.id,
    fullName: sessionUser.fullName || sessionUser.email,
    email: sessionUser.email,
    initials: buildInitials(sessionUser.fullName, sessionUser.email),
  };

  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(404).render('post', {
      user: fallbackUser,
      post: null,
      courses: [],
      communities: [],
      notFoundMessage: 'Post does not exist.',
    });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const affiliations = await fetchAffiliations(supabase, sessionUser.id);
    const visibilityFilter = buildPostScopeFilter(
      affiliations.courseIds,
      affiliations.communityIds,
      sessionUser.id
    );

    const { data: rawPost, error: postError } = await supabase
      .from('posts')
      .select('id,author_id,content,is_official,community_id,course_id,created_at,is_deleted')
      .eq('id', postId)
      .eq('is_deleted', false)
      .or(visibilityFilter)
      .maybeSingle();

    if (postError || !rawPost) {
      return res.status(404).render('post', {
        user: fallbackUser,
        post: null,
        courses: affiliations.courses,
        communities: affiliations.communities,
        notFoundMessage: 'Post does not exist.',
      });
    }

    const [authorProfileResult, courseResult, communityResult, currentProfileResult, likesResult, userLikeResult, commentsResult] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email').eq('id', rawPost.author_id).maybeSingle(),
      rawPost.course_id
        ? supabase.from('courses').select('id,name').eq('id', rawPost.course_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      rawPost.community_id
        ? supabase.from('communities').select('id,name').eq('id', rawPost.community_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('profiles').select('id,full_name,email').eq('id', sessionUser.id).maybeSingle(),
      supabase.from('reactions').select('post_id').eq('type', 'like').eq('post_id', postId),
      supabase
        .from('reactions')
        .select('post_id')
        .eq('type', 'like')
        .eq('post_id', postId)
        .eq('user_id', sessionUser.id)
        .maybeSingle(),
      supabase
        .from('comments')
        .select('id,post_id,author_id,content,created_at,is_deleted')
        .eq('post_id', postId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true }),
    ]);

    const comments = commentsResult.data || [];
    const commentAuthorIds = [...new Set(comments.map((comment) => comment.author_id).filter(Boolean))];
    const commentProfilesResult = commentAuthorIds.length > 0
      ? await supabase.from('profiles').select('id,full_name,email').in('id', commentAuthorIds)
      : { data: [], error: null };

    const commentProfileById = new Map((commentProfilesResult.data || []).map((row) => [row.id, row]));

    const author = authorProfileResult.data;
    const authorName =
      (author && author.full_name) ||
      (author && author.email) ||
      'Unknown User';
    const authorEmail = (author && author.email) || '';

    let scopeLabel = 'General';
    let scopeHref = '#';

    if (communityResult.data) {
      scopeLabel = communityResult.data.name;
      scopeHref = '/communities';
    } else if (courseResult.data) {
      scopeLabel = courseResult.data.name;
      scopeHref = '/courses';
    }

    const post = {
      id: rawPost.id,
      authorName,
      authorInitials: buildInitials(authorName, authorEmail),
      createdAtLabel: formatCreatedAt(rawPost.created_at),
      scopeLabel,
      scopeHref,
      content: rawPost.content,
      likeCount: (likesResult.data || []).length,
      liked: Boolean(userLikeResult.data),
      commentCount: comments.length,
      comments: comments.map((comment) => {
        const commentAuthor = commentProfileById.get(comment.author_id);
        const commentAuthorName =
          (commentAuthor && commentAuthor.full_name) ||
          (commentAuthor && commentAuthor.email) ||
          'Unknown User';
        const commentAuthorEmail = (commentAuthor && commentAuthor.email) || '';

        return {
          id: comment.id,
          authorName: commentAuthorName,
          authorInitials: buildInitials(commentAuthorName, commentAuthorEmail),
          createdAtLabel: formatCreatedAt(comment.created_at),
          content: comment.content,
        };
      }),
    };

    const currentProfile = currentProfileResult.data || null;
    const user = {
      id: sessionUser.id,
      fullName:
        (currentProfile && currentProfile.full_name) ||
        sessionUser.fullName ||
        sessionUser.email,
      email: (currentProfile && currentProfile.email) || sessionUser.email,
      initials: buildInitials(
        currentProfile && currentProfile.full_name,
        (currentProfile && currentProfile.email) || sessionUser.email
      ),
    };

    return res.render('post', {
      user,
      post,
      courses: affiliations.courses,
      communities: affiliations.communities,
      notFoundMessage: null,
    });
  } catch (_err) {
    return res.status(500).render('error', {
      message: 'Unable to load this post right now.',
      error: req.app.get('env') === 'development' ? _err : {},
    });
  }
});

module.exports = router;