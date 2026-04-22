var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  buildDisplayName,
  buildInitials,
  buildProfilePath,
  buildProfileSlug,
  formatCreatedAt,
} = require('../lib/utils');
const { resolveProfileMedia, resolveProfileMediaMap } = require('../lib/profileMedia');
const postModel = require('../models/postModel');

async function fetchProfileById(supabase, userId) {
  if (!userId) {
    return { profile: null, error: null };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { profile: null, error };
  }

  return { profile: data || null, error: null };
}

function renderProfileNotFound(req, res) {
  return res.status(404).render('error', {
    message: 'Profile not found.',
    error: req.app.get('env') === 'development' ? new Error('Profile not found.') : {},
  });
}

function displayName(profile) {
  if (!profile) {
    return 'Unknown User';
  }

  return buildDisplayName(profile.first_name, profile.last_name, profile.email);
}

async function buildLikeState(supabase, postIds, viewerUserId) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return {
      likeCountByPostId: new Map(),
      likedPostIds: new Set(),
    };
  }

  const [likes, userLikes] = await Promise.all([
    postModel.fetchLikeRowsByPostIds(supabase, postIds),
    viewerUserId
      ? postModel.fetchUserLikeRowsByPostIds(supabase, postIds, viewerUserId)
      : Promise.resolve([]),
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
    };
  }

  const { comments, error } = await postModel.fetchCommentsByPostIds(supabase, postIds);
  if (error) {
    return {
      commentCountByPostId: new Map(),
      commentsByPostId: new Map(),
    };
  }

  const authorIds = [...new Set(comments.map((comment) => comment.author_id).filter(Boolean))];
  const profiles = await postModel.fetchProfilesByIds(supabase, authorIds);
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const profileMediaById = await resolveProfileMediaMap(supabase, profiles);
  const commentCountByPostId = new Map();
  const commentsByPostId = new Map();

  comments.forEach((comment) => {
    const author = profileById.get(comment.author_id);
    const authorEmail = author && author.email ? author.email : '';
    const authorMedia = profileMediaById.get(comment.author_id);
    const list = commentsByPostId.get(comment.post_id) || [];

    list.push({
      id: comment.id,
      authorName: displayName(author),
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      authorAvatarUrl: authorMedia && authorMedia.avatarUrl ? authorMedia.avatarUrl : null,
      createdAtLabel: formatCreatedAt(comment.created_at),
      content: comment.content,
    });

    commentsByPostId.set(comment.post_id, list);
    commentCountByPostId.set(comment.post_id, list.length);
  });

  return {
    commentCountByPostId,
    commentsByPostId,
  };
}

async function buildPostsViewModel(supabase, postRows, viewerUserId) {
  if (!Array.isArray(postRows) || postRows.length === 0) {
    return [];
  }

  const postIds = postRows.map((post) => post.id).filter(Boolean);
  const authorIds = [...new Set(postRows.map((post) => post.author_id).filter(Boolean))];
  const [profiles, likeState, commentState] = await Promise.all([
    postModel.fetchProfilesByIds(supabase, authorIds),
    buildLikeState(supabase, postIds, viewerUserId),
    buildCommentState(supabase, postIds),
  ]);
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const profileMediaById = await resolveProfileMediaMap(supabase, profiles);

  return postRows.map((post) => {
    const author = profileById.get(post.author_id);
    const authorEmail = author && author.email ? author.email : '';
    const authorMedia = profileMediaById.get(post.author_id);

    return {
      id: post.id,
      authorId: post.author_id,
      authorProfileHref: buildProfilePath(
        post.author_id,
        author && author.first_name,
        author && author.last_name
      ),
      authorName: displayName(author),
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      authorAvatarUrl: authorMedia && authorMedia.avatarUrl ? authorMedia.avatarUrl : null,
      createdAtLabel: formatCreatedAt(post.created_at),
      scopeLabel: 'General',
      scopeHref: '/feed',
      content: post.content,
      imageUrl: post.image_url || null,
      likeCount: likeState.likeCountByPostId.get(post.id) || 0,
      liked: likeState.likedPostIds.has(post.id),
      commentCount: commentState.commentCountByPostId.get(post.id) || 0,
      comments: commentState.commentsByPostId.get(post.id) || [],
    };
  });
}

async function renderProfileByUserId(req, res, userId, options = {}) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  if (!normalizedUserId) {
    return renderProfileNotFound(req, res);
  }

  const supabase = createSupabaseAdminClient();
  const { profile, error } = await fetchProfileById(supabase, normalizedUserId);

  if (error) {
    return res.status(500).render('error', {
      message: 'Unable to load profile.',
      error: req.app.get('env') === 'development' ? error : {},
    });
  }

  if (!profile) {
    return renderProfileNotFound(req, res);
  }

  const canonicalPath = buildProfilePath(profile.id, profile.first_name, profile.last_name);
  const canonicalSlug = buildProfileSlug(profile.first_name, profile.last_name);
  const requestedSlug = typeof options.requestedSlug === 'string'
    ? options.requestedSlug.trim().toLowerCase()
    : '';
  const shouldRedirectToCanonical = Boolean(options.forceCanonicalRedirect)
    || requestedSlug !== canonicalSlug;

  if (shouldRedirectToCanonical) {
    return res.redirect(canonicalPath);
  }

  const sessionUser = req.session.auth.user;
  const profileWithFallbacks = { ...profile };
  if (profile.id === sessionUser.id && !profileWithFallbacks.email) {
    profileWithFallbacks.email = sessionUser.email || null;
  }
  const [media, postRows] = await Promise.all([
    resolveProfileMedia(supabase, profileWithFallbacks),
    postModel.fetchGlobalPostsByAuthorId(supabase, profile.id),
  ]);
  const posts = await buildPostsViewModel(supabase, postRows, sessionUser.id);

  res.render('profile', {
    user: sessionUser,
    currentUser: sessionUser,
    profile: profileWithFallbacks,
    profileAvatarUrl: media.avatarUrl,
    profileBannerUrl: media.bannerUrl,
    posts,
  });
}

router.get('/', requireAuth, async (req, res) => {
  const sessionUserId = req.session.auth.user.id;
  return renderProfileByUserId(req, res, sessionUserId, {
    forceCanonicalRedirect: true,
  });
});

router.get('/:userId', requireAuth, async (req, res) => {
  return renderProfileByUserId(req, res, req.params.userId, {
    forceCanonicalRedirect: true,
  });
});

router.get('/:userId/:nameSlug', requireAuth, async (req, res) => {
  return renderProfileByUserId(req, res, req.params.userId, {
    requestedSlug: req.params.nameSlug,
  });
});

module.exports = router;
