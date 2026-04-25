const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  buildDisplayName,
  buildInitials,
  buildProfilePath,
  formatCreatedAt,
  fetchAffiliations,
} = require('../lib/utils');
const { resolveProfileMedia, resolveProfileMediaMap } = require('../lib/profileMedia');
const { toPositiveInteger, toNonNegativeInteger } = require('../lib/numberUtils');
const { DEFAULT_STORAGE_BUCKET } = require('../lib/storage');
const {
  buildProfileDisplayName,
  buildSessionFallbackUser,
  buildAuthorRoleMeta,
} = require('../lib/profileView');
const {
  fetchLikeState,
  buildCommentCollections,
} = require('../lib/postEngagement');
const {
  normalizeRole,
  fetchViewerSchoolContext,
  buildSchoolScopeOptions,
} = require('../lib/schoolScope');
const postModel = require('../models/postModel');
const FEED_PAGE_SIZE = 10;

async function buildCurrentUserViewModel(supabase, sessionUser, viewerContext) {
  const scopeOptions = {
    ...buildSchoolScopeOptions(viewerContext),
    viewerUserId: sessionUser.id,
  };
  const currentProfile = await postModel.fetchProfileById(supabase, sessionUser.id, scopeOptions);
  const firstName = (currentProfile && currentProfile.first_name) || sessionUser.firstName || null;
  const lastName =
    currentProfile && typeof currentProfile.last_name === 'string'
      ? currentProfile.last_name
      : sessionUser.lastName || null;
  const email = (currentProfile && currentProfile.email) || sessionUser.email;
  const role = normalizeRole(
    (currentProfile && currentProfile.role) || sessionUser.role || 'student'
  );
  const media = currentProfile ? await resolveProfileMedia(supabase, currentProfile) : null;

  return {
    id: sessionUser.id,
    role,
    firstName,
    lastName,
    fullName: buildDisplayName(firstName, lastName, email),
    email,
    initials: buildInitials(firstName, lastName, email),
    profileAvatarUrl:
      (media && media.avatarUrl) || sessionUser.profileAvatarUrl || null,
  };
}

async function buildLikeState(supabase, postIds, userId) {
  return fetchLikeState({
    postIds,
    userId,
    fetchLikeRows: (ids) => postModel.fetchLikeRowsByPostIds(supabase, ids),
    fetchUserLikeRows: (ids, viewerUserId) =>
      postModel.fetchUserLikeRowsByPostIds(supabase, ids, viewerUserId),
  });
}

async function buildCommentState(supabase, postIds, scopeOptions) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return {
      ...buildCommentCollections(),
      hasError: false,
    };
  }

  const { comments, error } = await postModel.fetchCommentsByPostIds(
    supabase,
    postIds,
    scopeOptions
  );
  if (error) {
    return {
      ...buildCommentCollections(),
      hasError: true,
    };
  }

  const authorIds = [...new Set(comments.map((comment) => comment.author_id).filter(Boolean))];
  const profiles = await postModel.fetchProfilesByIds(supabase, authorIds, scopeOptions);
  const profileMediaById = await resolveProfileMediaMap(supabase, profiles);
  return {
    ...buildCommentCollections({
      comments,
      profiles,
      profileMediaById,
      formatDateLabel: formatCreatedAt,
      skipUnknownAuthors: false,
    }),
    hasError: false,
  };
}

async function buildPostsViewModel(supabase, postRows, viewerUserId, scopeOptions) {
  if (!Array.isArray(postRows) || postRows.length === 0) {
    return [];
  }

  const postIds = postRows.map((post) => post.id).filter(Boolean);
  const authorIds = [...new Set(postRows.map((post) => post.author_id).filter(Boolean))];
  const courseIds = [...new Set(postRows.map((post) => post.course_id).filter(Boolean))];
  const communityIds = [...new Set(postRows.map((post) => post.community_id).filter(Boolean))];

  const [profiles, courses, communities, likeState, commentState] = await Promise.all([
    postModel.fetchProfilesByIds(supabase, authorIds, scopeOptions),
    postModel.fetchCoursesByIds(supabase, courseIds, scopeOptions),
    postModel.fetchCommunitiesByIds(supabase, communityIds, scopeOptions),
    buildLikeState(supabase, postIds, viewerUserId),
    buildCommentState(supabase, postIds, scopeOptions),
  ]);
  const profileMediaById = await resolveProfileMediaMap(supabase, profiles);

  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const courseById = new Map(courses.map((row) => [row.id, row]));
  const communityById = new Map(communities.map((row) => [row.id, row]));

  return postRows
    .filter((post) => {
      if (!profileById.has(post.author_id)) {
        return false;
      }
      if (post.course_id && !courseById.has(post.course_id)) {
        return false;
      }
      if (post.community_id && !communityById.has(post.community_id)) {
        return false;
      }
      return true;
    })
    .map((post) => {
    const author = profileById.get(post.author_id);
    const authorMedia = profileMediaById.get(post.author_id);
    const course = courseById.get(post.course_id);
    const community = communityById.get(post.community_id);
    const authorEmail = (author && author.email) || '';
    const roleMeta = buildAuthorRoleMeta(author && author.role);
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
      authorId: post.author_id,
      authorProfileHref: buildProfilePath(
        post.author_id,
        author && author.first_name,
        author && author.last_name
      ),
      authorName: buildProfileDisplayName(author),
      authorRole: roleMeta.normalizedRole,
      authorRoleLabel: roleMeta.roleLabel,
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      authorAvatarUrl: authorMedia && authorMedia.avatarUrl ? authorMedia.avatarUrl : null,
      createdAtLabel: formatCreatedAt(post.created_at),
      scopeLabel,
      scopeHref,
      content: post.content,
      imageUrl: post.image_url || null,
      likeCount: likeState.likeCountByPostId.get(post.id) || 0,
      liked: likeState.likedPostIds.has(post.id),
      commentCount: commentState.commentCountByPostId.get(post.id) || 0,
      comments: commentState.commentsByPostId.get(post.id) || [],
    };
    });
}

async function buildFeedViewModel(supabase, sessionUser, viewerContext, options = {}) {
  const limit = FEED_PAGE_SIZE;
  const offset = toNonNegativeInteger(options.offset);
  const scopeOptions = buildSchoolScopeOptions(viewerContext);
  const affiliations = await fetchAffiliations(supabase, sessionUser.id, scopeOptions);
  const [user, pagedPosts] = await Promise.all([
    buildCurrentUserViewModel(supabase, sessionUser, viewerContext),
    postModel.fetchGlobalFeedPosts(supabase, { limit, offset, ...scopeOptions }),
  ]);
  const posts = await buildPostsViewModel(supabase, pagedPosts.rows, sessionUser.id, scopeOptions);

  return {
    user,
    posts,
    courses: affiliations.courses,
    communities: affiliations.communities,
    hasMore: Boolean(pagedPosts.hasMore),
    nextOffset: offset + posts.length,
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

function buildFeedErrorRedirect(message) {
  return '/feed?error=' + encodeURIComponent(message);
}

async function uploadFeedImage(supabase, sessionUser, file) {
  if (!file) {
    return { imageUrl: null, errorMessage: null };
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.mimetype)) {
    return {
      imageUrl: null,
      errorMessage: 'Only JPEG, PNG, GIF and WebP images are supported.',
    };
  }

  const ext = file.originalname.split('.').pop();
  const fileName = `${sessionUser.id}-${Date.now()}.${ext}`;
  const objectPath = `posts/${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from(DEFAULT_STORAGE_BUCKET)
    .upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadError) {
    return { imageUrl: null, errorMessage: null };
  }

  const { data: urlData } = supabase.storage
    .from(DEFAULT_STORAGE_BUCKET)
    .getPublicUrl(objectPath);

  return {
    imageUrl: urlData && urlData.publicUrl ? urlData.publicUrl : null,
    errorMessage: null,
  };
}

async function showFeed(req, res) {
  const sessionUser = req.session.auth.user;
  const fallbackUser = buildSessionFallbackUser(sessionUser, { includeRole: true });

  try {
    const supabase = createSupabaseAdminClient();
    const viewerContext = await fetchViewerSchoolContext(supabase, sessionUser);
    const viewModel = await buildFeedViewModel(supabase, sessionUser, viewerContext);

    return res.render('feed', {
      user: viewModel.user,
      posts: viewModel.posts,
      courses: viewModel.courses,
      communities: viewModel.communities,
      hasMorePosts: viewModel.hasMore,
      nextOffset: viewModel.nextOffset,
      pageSize: FEED_PAGE_SIZE,
      formError: req.query.error || null,
    });
  } catch (_err) {
    console.error('SHOW FEED ERROR:', _err);
    return res.render('feed', {
      user: fallbackUser,
      posts: [],
      courses: [],
      communities: [],
      hasMorePosts: false,
      nextOffset: 0,
      pageSize: FEED_PAGE_SIZE,
      formError: req.query.error || null,
    });
  }
}

async function listFeedPosts(req, res) {
  const sessionUser = req.session.auth.user;
  const offset = toNonNegativeInteger(req.query.offset);

  try {
    const supabase = createSupabaseAdminClient();
    const viewerContext = await fetchViewerSchoolContext(supabase, sessionUser);
    const scopeOptions = buildSchoolScopeOptions(viewerContext);
    const pagedPosts = await postModel.fetchGlobalFeedPosts(supabase, {
      offset,
      limit: FEED_PAGE_SIZE,
      ...scopeOptions,
    });
    const posts = await buildPostsViewModel(supabase, pagedPosts.rows, sessionUser.id, scopeOptions);

    return res.json({
      ok: true,
      posts,
      hasMore: Boolean(pagedPosts.hasMore),
      nextOffset: offset + posts.length,
      pageSize: FEED_PAGE_SIZE,
    });
  } catch (_err) {
    return res.status(500).json({
      ok: false,
      error: 'Unable to load feed posts.',
    });
  }
}

async function createFeedPost(req, res) {
  const sessionUser = req.session.auth.user;
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (!content) {
    return res.redirect(buildFeedErrorRedirect('Post content cannot be empty.'));
  }

  if (content.length > 4000) {
    return res.redirect(buildFeedErrorRedirect('Post content is too long.'));
  }

  try {
    const supabase = createSupabaseAdminClient();
    const viewerContext = await fetchViewerSchoolContext(supabase, sessionUser);
    if (!viewerContext.isGlobalAdmin && !viewerContext.schoolId) {
      return res.redirect(buildFeedErrorRedirect('Link your account to a school to post.'));
    }

    const { imageUrl, errorMessage: imageUploadError } = await uploadFeedImage(
      supabase,
      sessionUser,
      req.file
    );

    if (imageUploadError) {
      return res.redirect(buildFeedErrorRedirect(imageUploadError));
    }

    const created = await postModel.createFeedPostWithImage(supabase, {
      authorId: sessionUser.id,
      content,
      imageUrl,
    });

    if (!created) {
      return res.redirect(buildFeedErrorRedirect('Unable to publish post.'));
    }

    return res.redirect('/feed');
  } catch (_err) {
    console.error('CREATE POST ERROR:', _err);
    return res.redirect(buildFeedErrorRedirect('Unable to publish post.'));
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
    const viewerContext = await fetchViewerSchoolContext(supabase, sessionUser);
    const scopeOptions = buildSchoolScopeOptions(viewerContext);
    const visiblePost = await postModel.fetchActivePostById(supabase, postId, scopeOptions);

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

    return res.json({ ok: true, liked, likeCount });
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
      req, res, 400,
      { error: 'Comment is too long (max 2000 characters).' },
      `/post/${postId}`
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const viewerContext = await fetchViewerSchoolContext(supabase, sessionUser);
    const scopeOptions = buildSchoolScopeOptions(viewerContext);
    const visiblePost = await postModel.fetchActivePostById(supabase, postId, scopeOptions);

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

    const commentState = await buildCommentState(supabase, [postId], scopeOptions);
    const comments = commentState.commentsByPostId.get(postId) || [];

    if ((req.get('Accept') || '').includes('application/json') || req.xhr) {
      if (commentState.hasError) {
        return res.json({ ok: true, commentCount: null, comments: [] });
      }
      return res.json({ ok: true, commentCount: comments.length, comments });
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
  const fallbackUser = buildSessionFallbackUser(sessionUser, { includeRole: true });

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
    const viewerContext = await fetchViewerSchoolContext(supabase, sessionUser);
    const scopeOptions = buildSchoolScopeOptions(viewerContext);
    const affiliations = await fetchAffiliations(supabase, sessionUser.id, scopeOptions);
    const rawPost = await postModel.fetchActivePostById(supabase, postId, scopeOptions);

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
      buildCurrentUserViewModel(supabase, sessionUser, viewerContext),
      buildPostsViewModel(supabase, [rawPost], sessionUser.id, scopeOptions),
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

async function reportPost(req, res) {
  const sessionUser = req.session.auth.user;
  const postId = toPositiveInteger(req.params.postId);
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

  if (!postId) return res.status(400).json({ error: 'Invalid post id.' });
  if (!reason) return res.status(400).json({ error: 'Reason is required.' });
  if (reason.length > 250) return res.status(400).json({ error: 'Reason too long (max 250 chars).' });

  try {
    const supabase = createSupabaseAdminClient();
    const viewerContext = await fetchViewerSchoolContext(supabase, sessionUser);
    const scopeOptions = buildSchoolScopeOptions(viewerContext);
    const post = await postModel.fetchActivePostById(supabase, postId, scopeOptions);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.author_id === sessionUser.id) {
      return res.status(400).json({ error: 'You cannot report your own post.' });
    }

    const existingReport = await postModel.fetchPostReportByReporterAndPost(
      supabase,
      sessionUser.id,
      postId
    );
    if (existingReport && String(existingReport.status || '').toLowerCase() === 'pending') {
      return res.status(409).json({ error: 'You have already reported this post.' });
    }

    const { report, error } = await postModel.reportPost(supabase, {
      postId,
      reporterId: sessionUser.id,
      reason,
    });

    if (error || !report) return res.status(500).json({ error: 'Unable to submit report.' });

    return res.json({ ok: true, message: 'Report submitted.' });
  } catch (_err) {

    return res.status(500).json({ error: 'Unable to submit report.' });
  }
}

async function deletePost(req, res) {
  const sessionUser = req.session.auth.user;
  const postId = toPositiveInteger(req.params.postId);

  if (!postId) return res.status(400).json({ error: 'Invalid post id.' });

  try {
    const supabase = createSupabaseAdminClient();
    const viewerContext = await fetchViewerSchoolContext(supabase, sessionUser);
    const scopeOptions = buildSchoolScopeOptions(viewerContext);
    const post = await postModel.fetchPostById(supabase, postId, scopeOptions);

    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const isOwner = post.author_id === sessionUser.id;
    const isAdmin = Boolean(viewerContext.isGlobalAdmin);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Not allowed.' });
    }

    const deleted = await postModel.deletePost(supabase, postId);

    if (!deleted) return res.status(500).json({ error: 'Unable to delete post.' });

    return res.json({ ok: true });
  } catch (_err) {
    return res.status(500).json({ error: 'Unable to delete post.' });
  }
}

module.exports = {
  showFeed,
  listFeedPosts,
  createFeedPost,
  togglePostLike,
  createPostComment,
  redirectToFeed,
  showPostById,
  reportPost,
  deletePost,
};
