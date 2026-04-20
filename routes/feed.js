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

async function buildLikeState(supabase, postIds, userId) {
  if (!postIds || postIds.length === 0) {
    return {
      likeCountByPostId: new Map(),
      likedPostIds: new Set(),
    };
  }

  const [likesResult, userLikesResult] = await Promise.all([
    supabase
      .from('reactions')
      .select('post_id')
      .eq('type', 'like')
      .in('post_id', postIds),
    supabase
      .from('reactions')
      .select('post_id')
      .eq('type', 'like')
      .eq('user_id', userId)
      .in('post_id', postIds),
  ]);

  const likeCountByPostId = new Map();
  (likesResult.data || []).forEach((row) => {
    const count = likeCountByPostId.get(row.post_id) || 0;
    likeCountByPostId.set(row.post_id, count + 1);
  });

  const likedPostIds = new Set((userLikesResult.data || []).map((row) => row.post_id));

  return {
    likeCountByPostId,
    likedPostIds,
  };
}

async function buildCommentState(supabase, postIds, userId) {
  if (!postIds || postIds.length === 0) {
    return {
      commentCountByPostId: new Map(),
      commentsByPostId: new Map(),
    };
  }

  const { data: commentsResult, error } = await supabase
    .from('comments')
    .select('id,post_id,author_id,content,created_at,is_deleted')
    .eq('is_deleted', false)
    .in('post_id', postIds)
    .order('created_at', { ascending: true });

  if (error) {
    return {
      commentCountByPostId: new Map(),
      commentsByPostId: new Map(),
    };
  }

  const comments = commentsResult || [];
  const authorIds = [...new Set(comments.map((comment) => comment.author_id).filter(Boolean))];

  const profilesResult = authorIds.length > 0
    ? await supabase.from('profiles').select('id,full_name,email').in('id', authorIds)
    : { data: [], error: null };

  const profileById = new Map((profilesResult.data || []).map((row) => [row.id, row]));
  const commentCountByPostId = new Map();
  const commentsByPostId = new Map();

  comments.forEach((comment) => {
    const postId = comment.post_id;
    commentCountByPostId.set(postId, (commentCountByPostId.get(postId) || 0) + 1);

    const author = profileById.get(comment.author_id);
    const authorName = (author && author.full_name) || (author && author.email) || 'Unknown User';
    const authorEmail = (author && author.email) || '';
    const list = commentsByPostId.get(postId) || [];

    list.push({
      id: comment.id,
      authorName,
      authorInitials: buildInitials(authorName, authorEmail),
      createdAtLabel: formatCreatedAt(comment.created_at),
      content: comment.content,
    });

    commentsByPostId.set(postId, list);
  });

  return {
    commentCountByPostId,
    commentsByPostId,
  };
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

async function buildFeedViewModel(supabase, sessionUser) {
  const affiliations = await fetchAffiliations(supabase, sessionUser.id);

  const postFilter = buildPostScopeFilter(
    affiliations.courseIds,
    affiliations.communityIds,
    sessionUser.id
  );

  const { data: rawPosts, error: postsError } = await supabase
    .from('posts')
    .select('id,author_id,content,is_official,community_id,course_id,created_at,is_deleted')
    .eq('is_deleted', false)
    .or(postFilter)
    .order('created_at', { ascending: false })
    .limit(50);

  if (postsError) {
    return {
      posts: [],
      courses: affiliations.courses,
      communities: affiliations.communities,
      user: {
        id: sessionUser.id,
        fullName: sessionUser.fullName || sessionUser.email,
        email: sessionUser.email,
        initials: buildInitials(sessionUser.fullName, sessionUser.email),
      },
    };
  }

  const posts = rawPosts || [];
  const postIds = posts.map((post) => post.id).filter(Boolean);
  const authorIds = [...new Set(posts.map((post) => post.author_id).filter(Boolean))];
  const courseIdsInPosts = [...new Set(posts.map((post) => post.course_id).filter(Boolean))];
  const communityIdsInPosts = [...new Set(posts.map((post) => post.community_id).filter(Boolean))];
  const likeState = await buildLikeState(supabase, postIds, sessionUser.id);
  const commentState = await buildCommentState(supabase, postIds, sessionUser.id);

  const [profilesResult, coursesResult, communitiesResult, currentProfileResult] = await Promise.all([
    authorIds.length > 0
      ? supabase.from('profiles').select('id,full_name,email').in('id', authorIds)
      : Promise.resolve({ data: [], error: null }),
    courseIdsInPosts.length > 0
      ? supabase.from('courses').select('id,name').in('id', courseIdsInPosts)
      : Promise.resolve({ data: [], error: null }),
    communityIdsInPosts.length > 0
      ? supabase.from('communities').select('id,name').in('id', communityIdsInPosts)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('profiles').select('id,full_name,email').eq('id', sessionUser.id).maybeSingle(),
  ]);

  const profileById = new Map((profilesResult.data || []).map((row) => [row.id, row]));
  const courseById = new Map((coursesResult.data || []).map((row) => [row.id, row]));
  const communityById = new Map((communitiesResult.data || []).map((row) => [row.id, row]));

  const currentProfile = currentProfileResult.data || null;
  const currentUser = {
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

  const feedPosts = posts.map((post) => {
    const author = profileById.get(post.author_id);
    const course = courseById.get(post.course_id);
    const community = communityById.get(post.community_id);
    const authorName =
      (author && author.full_name) ||
      (author && author.email) ||
      'Unknown User';
    const authorEmail = (author && author.email) || '';

    let scopeLabel = 'General';
    let scopeHref = '#';

    if (community) {
      scopeLabel = community.name;
      scopeHref = '/communities';
    } else if (course) {
      scopeLabel = course.name;
      scopeHref = '/courses';
    }

    return {
      id: post.id,
      authorName,
      authorInitials: buildInitials(authorName, authorEmail),
      createdAtLabel: formatCreatedAt(post.created_at),
      scopeLabel,
      scopeHref,
      content: post.content,
      likeCount: likeState.likeCountByPostId.get(post.id) || 0,
      liked: likeState.likedPostIds.has(post.id),
      commentCount: commentState.commentCountByPostId.get(post.id) || 0,
      comments: commentState.commentsByPostId.get(post.id) || [],
    };
  });

  return {
    posts: feedPosts,
    courses: affiliations.courses,
    communities: affiliations.communities,
    courseIds: affiliations.courseIds,
    communityIds: affiliations.communityIds,
    user: currentUser,
  };
}

router.get('/', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;

  const fallbackUser = {
    id: sessionUser.id,
    fullName: sessionUser.fullName || sessionUser.email,
    email: sessionUser.email,
    initials: buildInitials(sessionUser.fullName, sessionUser.email),
  };

  try {
    const supabase = createSupabaseAdminClient();
    const viewModel = await buildFeedViewModel(supabase, sessionUser);

    return res.render('feed', {
      user: viewModel.user,
      posts: viewModel.posts,
      courses: viewModel.courses,
      communities: viewModel.communities,
      formError: req.query.error || null,
    });
  } catch (_err) {
    return res.render('feed', {
      user: fallbackUser,
      posts: [],
      courses: [],
      communities: [],
      formError: req.query.error || null,
    });
  }
});

router.post('/posts', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (!content) {
    return res.redirect('/feed?error=' + encodeURIComponent('Post content cannot be empty.'));
  }

  if (content.length > 4000) {
    return res.redirect('/feed?error=' + encodeURIComponent('Post content is too long (max 4000 characters).'));
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from('posts')
      .insert({
        author_id: sessionUser.id,
        content,
        is_official: false,
        course_id: null,
        community_id: null,
      });

    if (error) {
      return res.redirect('/feed?error=' + encodeURIComponent('Unable to publish post right now.'));
    }

    return res.redirect('/feed');
  } catch (_err) {
    return res.redirect('/feed?error=' + encodeURIComponent('Unable to publish post right now.'));
  }
});

router.post('/posts/:postId/like', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const postId = Number.parseInt(req.params.postId, 10);

  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(400).json({ error: 'Invalid post id.' });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const affiliations = await fetchAffiliations(supabase, sessionUser.id);
    const visibilityFilter = buildPostScopeFilter(
      affiliations.courseIds,
      affiliations.communityIds,
      sessionUser.id
    );

    const { data: visiblePost, error: visiblePostError } = await supabase
      .from('posts')
      .select('id')
      .eq('id', postId)
      .eq('is_deleted', false)
      .or(visibilityFilter)
      .maybeSingle();

    if (visiblePostError || !visiblePost) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const { data: existingReaction, error: existingReactionError } = await supabase
      .from('reactions')
      .select('user_id,post_id,type')
      .eq('user_id', sessionUser.id)
      .eq('post_id', postId)
      .maybeSingle();

    if (existingReactionError) {
      return res.status(500).json({ error: 'Unable to update like.' });
    }

    let liked;

    if (existingReaction && existingReaction.type === 'like') {
      const { error: deleteError } = await supabase
        .from('reactions')
        .delete()
        .eq('user_id', sessionUser.id)
        .eq('post_id', postId);

      if (deleteError) {
        return res.status(500).json({ error: 'Unable to update like.' });
      }

      liked = false;
    } else {
      const { error: upsertError } = await supabase
        .from('reactions')
        .upsert(
          [{ user_id: sessionUser.id, post_id: postId, type: 'like' }],
          { onConflict: 'user_id,post_id' }
        );

      if (upsertError) {
        return res.status(500).json({ error: 'Unable to update like.' });
      }

      liked = true;
    }

    const { count, error: countError } = await supabase
      .from('reactions')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
      .eq('type', 'like');

    if (countError) {
      return res.status(500).json({ error: 'Unable to update like.' });
    }

    return res.json({
      ok: true,
      liked,
      likeCount: count || 0,
    });
  } catch (_err) {
    return res.status(500).json({ error: 'Unable to update like.' });
  }
});

router.post('/posts/:postId/comments', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const postId = Number.parseInt(req.params.postId, 10);
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  const acceptsHeader = req.get('Accept') || '';
  const wantsJson = acceptsHeader.includes('application/json') || req.xhr;

  function jsonOrRedirect(statusCode, payload, redirectPath) {
    if (wantsJson) {
      return res.status(statusCode).json(payload);
    }

    return res.redirect(redirectPath);
  }

  if (!Number.isInteger(postId) || postId <= 0) {
    return jsonOrRedirect(400, { error: 'Invalid post id.' }, '/feed');
  }

  if (!content) {
    return jsonOrRedirect(
      400,
      { error: 'Comment cannot be empty.' },
      `/post/${postId}`
    );
  }

  if (content.length > 2000) {
    return jsonOrRedirect(
      400,
      { error: 'Comment is too long (max 2000 characters).' },
      `/post/${postId}`
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const affiliations = await fetchAffiliations(supabase, sessionUser.id);
    const visibilityFilter = buildPostScopeFilter(
      affiliations.courseIds,
      affiliations.communityIds,
      sessionUser.id
    );

    const { data: visiblePost, error: visiblePostError } = await supabase
      .from('posts')
      .select('id')
      .eq('id', postId)
      .eq('is_deleted', false)
      .or(visibilityFilter)
      .maybeSingle();

    if (visiblePostError || !visiblePost) {
      return jsonOrRedirect(404, { error: 'Post not found.' }, `/post/${postId}`);
    }

    const { error } = await supabase
      .from('comments')
      .insert({
        post_id: postId,
        author_id: sessionUser.id,
        content,
        is_deleted: false,
      });

    if (error) {
      return jsonOrRedirect(500, { error: 'Unable to save comment.' }, `/post/${postId}`);
    }

    const { data: commentsResult, error: commentsError } = await supabase
      .from('comments')
      .select('id,post_id,author_id,content,created_at,is_deleted')
      .eq('post_id', postId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });

    if (commentsError) {
      if (wantsJson) {
        return res.json({ ok: true, commentCount: null, comments: [] });
      }

      return res.redirect(`/post/${postId}`);
    }

    const authorIds = [...new Set((commentsResult || []).map((comment) => comment.author_id).filter(Boolean))];
    const profilesResult = authorIds.length > 0
      ? await supabase.from('profiles').select('id,full_name,email').in('id', authorIds)
      : { data: [], error: null };

    const profileById = new Map((profilesResult.data || []).map((row) => [row.id, row]));
    const comments = (commentsResult || []).map((comment) => {
      const author = profileById.get(comment.author_id);
      const authorName = (author && author.full_name) || (author && author.email) || 'Unknown User';
      const authorEmail = (author && author.email) || '';

      return {
        id: comment.id,
        authorName,
        authorInitials: buildInitials(authorName, authorEmail),
        createdAtLabel: formatCreatedAt(comment.created_at),
        content: comment.content,
      };
    });

    if (wantsJson) {
      return res.json({
        ok: true,
        commentCount: comments.length,
        comments,
      });
    }

    return res.redirect(`/post/${postId}`);
  } catch (_err) {
    return jsonOrRedirect(500, { error: 'Unable to save comment.' }, `/post/${postId}`);
  }
});

module.exports = router;
