const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  buildDisplayName,
  buildInitials,
  formatCreatedAt,
  fetchAffiliations,
} = require('../lib/utils');
const postModel = require('../models/postModel');
const FEED_PAGE_SIZE = 10;

function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
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
      authorId: post.author_id,
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
      imageUrl: post.image_url || null,
      likeCount: likeState.likeCountByPostId.get(post.id) || 0,
      liked: likeState.likedPostIds.has(post.id),
      commentCount: commentState.commentCountByPostId.get(post.id) || 0,
      comments: commentState.commentsByPostId.get(post.id) || [],
    };
  });
}

async function buildFeedViewModel(supabase, sessionUser, options = {}) {
  const limit = FEED_PAGE_SIZE;
  const offset = toNonNegativeInteger(options.offset);
  const affiliations = await fetchAffiliations(supabase, sessionUser.id);
  const [user, pagedPosts] = await Promise.all([
    buildCurrentUserViewModel(supabase, sessionUser),
    postModel.fetchGlobalFeedPosts(supabase, { limit, offset }),
  ]);
  const posts = await buildPostsViewModel(supabase, pagedPosts.rows, sessionUser.id);

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
    const pagedPosts = await postModel.fetchGlobalFeedPosts(supabase, {
      offset,
      limit: FEED_PAGE_SIZE,
    });
    const posts = await buildPostsViewModel(supabase, pagedPosts.rows, sessionUser.id);

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
    return res.redirect('/feed?error=' + encodeURIComponent('Post content cannot be empty.'));
  }

  if (content.length > 4000) {
    return res.redirect('/feed?error=' + encodeURIComponent('Post content is too long.'));
  }

  try {
    const supabase = createSupabaseAdminClient();
    let imageUrl = null;

    if (req.file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(req.file.mimetype)) {
       return res.redirect('/feed?error=' + encodeURIComponent('Only JPEG, PNG, GIF and WebP images are supported.'));
      }
      const ext = req.file.originalname.split('.').pop();
      const fileName = `${sessionUser.id}-${Date.now()}.${ext}`;
      
      console.log('UPLOADING FILE:', fileName, req.file.mimetype, req.file.size);

      
      
      const { error: uploadError } = await supabase.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET || 'media')
        .upload(`posts/${fileName}`, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });
    
      console.log('UPLOAD ERROR:', uploadError);
    
      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from(process.env.SUPABASE_STORAGE_BUCKET || 'media')
          .getPublicUrl(`posts/${fileName}`);
        imageUrl = urlData?.publicUrl || null;
        console.log('IMAGE URL:', imageUrl);
      }
    }
    
    console.log('FINAL IMAGE URL:', imageUrl);

    const created = await postModel.createFeedPostWithImage(supabase, {
      authorId: sessionUser.id,
      content,
      imageUrl,
    });

    if (!created) {
      return res.redirect('/feed?error=' + encodeURIComponent('Unable to publish post.'));
    }

    return res.redirect('/feed');
  } catch (_err) {
    console.error('CREATE POST ERROR:', _err);
    return res.redirect('/feed?error=' + encodeURIComponent('Unable to publish post.'));
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
    const visiblePost = await postModel.fetchActivePostById(supabase, postId);

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
    const visiblePost = await postModel.fetchActivePostById(supabase, postId);

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
    const rawPost = await postModel.fetchActivePostById(supabase, postId);

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

async function reportPost(req, res) {
  const sessionUser = req.session.auth.user;
  const postId = toPositiveInteger(req.params.postId);
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

  if (!postId) return res.status(400).json({ error: 'Invalid post id.' });
  if (!reason) return res.status(400).json({ error: 'Reason is required.' });
  if (reason.length > 250) return res.status(400).json({ error: 'Reason too long (max 250 chars).' });

  try {
    const supabase = createSupabaseAdminClient();
    const saved = await postModel.reportPost(supabase, {
      postId,
      reporterId: sessionUser.id,
      reason,
    });

    if (!saved) return res.status(500).json({ error: 'Unable to submit report.' });

    return res.json({ ok: true });
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
    const post = await postModel.fetchPostById(supabase, postId);

    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const isOwner = post.author_id === sessionUser.id;
    const isAdmin = sessionUser.role === 'admin';

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
