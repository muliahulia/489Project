const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  buildDisplayName,
  buildInitials,
  formatCreatedAt,
  buildPostScopeFilter,
  fetchAffiliations,
} = require('../lib/utils');
const postModel = require('../models/postModel');

function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildFallbackUser(sessionUser) {
  return {
    id: sessionUser.id,
    firstName: sessionUser.firstName || null,
    lastName: sessionUser.lastName || null,
    fullName: buildDisplayName(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
    email: sessionUser.email,
    initials: buildInitials(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
  };
}

function displayName(profile) {
  if (!profile) {
    return 'Unknown User';
  }

  return buildDisplayName(profile.first_name, profile.last_name, profile.email);
}

async function buildCurrentUserViewModel(supabase, sessionUser) {
  const currentProfile = await postModel.fetchProfileById(supabase, sessionUser.id);
  const firstName = (currentProfile && currentProfile.first_name) || sessionUser.firstName || null;
  const lastName =
    currentProfile && typeof currentProfile.last_name === 'string'
      ? currentProfile.last_name
      : sessionUser.lastName || null;
  const email = (currentProfile && currentProfile.email) || sessionUser.email;

  return {
    id: sessionUser.id,
    firstName,
    lastName,
    fullName: buildDisplayName(firstName, lastName, email),
    email,
    initials: buildInitials(firstName, lastName, email),
  };
}

async function buildLikeState(supabase, postIds, userId) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return {
      likeCountByPostId: new Map(),
      likedPostIds: new Set(),
    };
  }

  const [likes, userLikes] = await Promise.all([
    postModel.fetchLikeRowsByPostIds(supabase, postIds),
    postModel.fetchUserLikeRowsByPostIds(supabase, postIds, userId),
  ]);

  const likeCountByPostId = new Map();
  likes.forEach((row) => {
    const count = likeCountByPostId.get(row.post_id) || 0;
    likeCountByPostId.set(row.post_id, count + 1);
  });

  return {
    likeCountByPostId,
    likedPostIds: new Set(userLikes.map((row) => row.post_id)),
  };
}

async function buildCommentState(supabase, postIds) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return {
      commentCountByPostId: new Map(),
      commentsByPostId: new Map(),
      hasError: false,
    };
  }

  const { comments, error } = await postModel.fetchCommentsByPostIds(supabase, postIds);
  if (error) {
    return {
      commentCountByPostId: new Map(),
      commentsByPostId: new Map(),
      hasError: true,
    };
  }

  const authorIds = [...new Set(comments.map((comment) => comment.author_id).filter(Boolean))];
  const profiles = await postModel.fetchProfilesByIds(supabase, authorIds);
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const commentCountByPostId = new Map();
  const commentsByPostId = new Map();

  comments.forEach((comment) => {
    const author = profileById.get(comment.author_id);
    const authorEmail = (author && author.email) || '';
    const list = commentsByPostId.get(comment.post_id) || [];

    list.push({
      id: comment.id,
      authorName: displayName(author),
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      createdAtLabel: formatCreatedAt(comment.created_at),
      content: comment.content,
    });

    commentsByPostId.set(comment.post_id, list);
    commentCountByPostId.set(comment.post_id, list.length);
  });

  return {
    commentCountByPostId,
    commentsByPostId,
    hasError: false,
  };
}

async function buildPostsViewModel(supabase, postRows, viewerUserId) {
  if (!Array.isArray(postRows) || postRows.length === 0) {
    return [];
  }

  const postIds = postRows.map((post) => post.id).filter(Boolean);
  const authorIds = [...new Set(postRows.map((post) => post.author_id).filter(Boolean))];
  const courseIds = [...new Set(postRows.map((post) => post.course_id).filter(Boolean))];
  const communityIds = [...new Set(postRows.map((post) => post.community_id).filter(Boolean))];

  const [profiles, courses, communities, likeState, commentState] = await Promise.all([
    postModel.fetchProfilesByIds(supabase, authorIds),
    postModel.fetchCoursesByIds(supabase, courseIds),
    postModel.fetchCommunitiesByIds(supabase, communityIds),
    buildLikeState(supabase, postIds, viewerUserId),
    buildCommentState(supabase, postIds),
  ]);

  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const courseById = new Map(courses.map((row) => [row.id, row]));
  const communityById = new Map(communities.map((row) => [row.id, row]));

  return postRows.map((post) => {
    const author = profileById.get(post.author_id);
    const course = courseById.get(post.course_id);
    const community = communityById.get(post.community_id);
    const authorEmail = (author && author.email) || '';
    let scopeLabel = 'General';
    let scopeHref = '#';

    if (community) {
      scopeLabel = community.name;
      scopeHref = '/communities';
    } else if (course) {
      scopeLabel = course.name;
      scopeHref = `/courses/${course.id}`;
    }

    return {
      id: post.id,
      authorName: displayName(author),
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
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
}

async function buildFeedViewModel(supabase, sessionUser) {
  const affiliations = await fetchAffiliations(supabase, sessionUser.id);
  const visibilityFilter = buildPostScopeFilter(
    affiliations.courseIds,
    affiliations.communityIds,
    sessionUser.id
  );
  const [user, postRows] = await Promise.all([
    buildCurrentUserViewModel(supabase, sessionUser),
    postModel.fetchVisibleFeedPosts(supabase, visibilityFilter),
  ]);
  const posts = await buildPostsViewModel(supabase, postRows, sessionUser.id);

  return {
    user,
    posts,
    courses: affiliations.courses,
    communities: affiliations.communities,
  };
}

function jsonOrRedirect(req, res, statusCode, payload, redirectPath) {
  const acceptsHeader = req.get('Accept') || '';
  const wantsJson = acceptsHeader.includes('application/json') || req.xhr;

  if (wantsJson) {
    return res.status(statusCode).json(payload);
  }

  return res.redirect(redirectPath);
}

async function showFeed(req, res) {
  const sessionUser = req.session.auth.user;
  const fallbackUser = buildFallbackUser(sessionUser);

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
}

async function createFeedPost(req, res) {
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
    const created = await postModel.createFeedPost(supabase, {
      authorId: sessionUser.id,
      content,
    });

    if (!created) {
      return res.redirect('/feed?error=' + encodeURIComponent('Unable to publish post right now.'));
    }

    return res.redirect('/feed');
  } catch (_err) {
    return res.redirect('/feed?error=' + encodeURIComponent('Unable to publish post right now.'));
  }
}

async function togglePostLike(req, res) {
  const sessionUser = req.session.auth.user;
  const postId = toPositiveInteger(req.params.postId);

  if (!postId) {
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
    const visiblePost = await postModel.fetchVisiblePostById(supabase, postId, visibilityFilter);

    if (!visiblePost) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const { reaction, error: reactionError } = await postModel.fetchReactionForUserAndPost(
      supabase,
      sessionUser.id,
      postId
    );

    if (reactionError) {
      return res.status(500).json({ error: 'Unable to update like.' });
    }

    let liked;

    if (reaction && reaction.type === 'like') {
      const removed = await postModel.deleteReactionForUserAndPost(
        supabase,
        sessionUser.id,
        postId
      );

      if (!removed) {
        return res.status(500).json({ error: 'Unable to update like.' });
      }

      liked = false;
    } else {
      const saved = await postModel.upsertLikeReaction(supabase, sessionUser.id, postId);

      if (!saved) {
        return res.status(500).json({ error: 'Unable to update like.' });
      }

      liked = true;
    }

    const likeCount = await postModel.countLikesForPost(supabase, postId);
    if (likeCount === null) {
      return res.status(500).json({ error: 'Unable to update like.' });
    }

    return res.json({
      ok: true,
      liked,
      likeCount,
    });
  } catch (_err) {
    return res.status(500).json({ error: 'Unable to update like.' });
  }
}

async function createPostComment(req, res) {
  const sessionUser = req.session.auth.user;
  const postId = toPositiveInteger(req.params.postId);
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (!postId) {
    return jsonOrRedirect(req, res, 400, { error: 'Invalid post id.' }, '/feed');
  }

  if (!content) {
    return jsonOrRedirect(req, res, 400, { error: 'Comment cannot be empty.' }, `/post/${postId}`);
  }

  if (content.length > 2000) {
    return jsonOrRedirect(
      req,
      res,
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
    const visiblePost = await postModel.fetchVisiblePostById(supabase, postId, visibilityFilter);

    if (!visiblePost) {
      return jsonOrRedirect(req, res, 404, { error: 'Post not found.' }, `/post/${postId}`);
    }

    const created = await postModel.createComment(supabase, {
      postId,
      authorId: sessionUser.id,
      content,
    });

    if (!created) {
      return jsonOrRedirect(req, res, 500, { error: 'Unable to save comment.' }, `/post/${postId}`);
    }

    const commentState = await buildCommentState(supabase, [postId]);
    const comments = commentState.commentsByPostId.get(postId) || [];

    if ((req.get('Accept') || '').includes('application/json') || req.xhr) {
      if (commentState.hasError) {
        return res.json({ ok: true, commentCount: null, comments: [] });
      }

      return res.json({
        ok: true,
        commentCount: comments.length,
        comments,
      });
    }

    return res.redirect(`/post/${postId}`);
  } catch (_err) {
    return jsonOrRedirect(req, res, 500, { error: 'Unable to save comment.' }, `/post/${postId}`);
  }
}

function redirectToFeed(req, res) {
  return res.redirect('/feed');
}

async function showPostById(req, res) {
  const sessionUser = req.session.auth.user;
  const postId = toPositiveInteger(req.params.id);
  const fallbackUser = buildFallbackUser(sessionUser);

  if (!postId) {
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
    const rawPost = await postModel.fetchVisiblePostById(supabase, postId, visibilityFilter);

    if (!rawPost) {
      return res.status(404).render('post', {
        user: fallbackUser,
        post: null,
        courses: affiliations.courses,
        communities: affiliations.communities,
        notFoundMessage: 'Post does not exist.',
      });
    }

    const [user, posts] = await Promise.all([
      buildCurrentUserViewModel(supabase, sessionUser),
      buildPostsViewModel(supabase, [rawPost], sessionUser.id),
    ]);

    return res.render('post', {
      user,
      post: posts[0] || null,
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
}

module.exports = {
  showFeed,
  createFeedPost,
  togglePostLike,
  createPostComment,
  redirectToFeed,
  showPostById,
};
