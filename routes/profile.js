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

function wantsJson(req) {
  const accept = req.get('accept') || '';
  return req.xhr || accept.includes('application/json');
}

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

async function fetchSchoolNameById(supabase, schoolId) {
  if (!schoolId) {
    return null;
  }

  const { data, error } = await supabase
    .from('schools')
    .select('id,name')
    .eq('id', schoolId)
    .maybeSingle();

  if (error || !data || !data.name) {
    return null;
  }

  return data.name;
}

async function fetchProfilePostsByAuthorId(supabase, authorId) {
  if (!authorId) {
    return [];
  }

  const { data, error } = await supabase
    .from('posts')
    .select('id,author_id,content,image_url,is_official,community_id,course_id,created_at,is_deleted')
    .eq('author_id', authorId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchMembershipCollections(supabase, profileId) {
  const [courseEnrollmentResult, communityMembershipResult] = await Promise.all([
    supabase
      .from('course_enrollments')
      .select('course_id')
      .eq('user_id', profileId),
    supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', profileId),
  ]);

  const courseIds = [...new Set(
    (courseEnrollmentResult.data || [])
      .map((row) => row.course_id)
      .filter(Boolean)
  )];
  const communityIds = [...new Set(
    (communityMembershipResult.data || [])
      .map((row) => row.community_id)
      .filter(Boolean)
  )];

  const [courseRows, communityRows] = await Promise.all([
    postModel.fetchCoursesByIds(supabase, courseIds),
    postModel.fetchCommunitiesByIds(supabase, communityIds),
  ]);

  const courses = (courseRows || [])
    .map((row) => ({
      id: row.id,
      name: row.name || 'Untitled Course',
      href: `/courses/${row.id}`,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));

  const communities = (communityRows || [])
    .map((row) => ({
      id: row.id,
      name: row.name || 'Untitled Community',
      href: `/communities/${row.id}`,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));

  return { courses, communities };
}

async function fetchFollowState(supabase, viewerId, viewedProfileId) {
  const followersCountResult = await supabase
    .from('followers')
    .select('*', { count: 'exact', head: true })
    .eq('following_id', viewedProfileId);

  const followersCount = Number.isInteger(followersCountResult.count)
    ? followersCountResult.count
    : 0;

  if (!viewerId || !viewedProfileId || viewerId === viewedProfileId) {
    return {
      isFollowing: false,
      followersCount,
    };
  }

  const existingFollowResult = await supabase
    .from('followers')
    .select('follower_id,following_id')
    .eq('follower_id', viewerId)
    .eq('following_id', viewedProfileId)
    .maybeSingle();

  return {
    isFollowing: Boolean(existingFollowResult.data),
    followersCount,
  };
}

async function fetchFollowersList(supabase, viewedProfileId) {
  const { data, error } = await supabase
    .from('followers')
    .select('follower_id')
    .eq('following_id', viewedProfileId);

  if (error || !Array.isArray(data) || data.length === 0) {
    return [];
  }

  const followerIds = [...new Set(
    data
      .map((row) => row.follower_id)
      .filter(Boolean)
  )];
  if (followerIds.length === 0) {
    return [];
  }

  const followerProfiles = await postModel.fetchProfilesByIds(supabase, followerIds);
  const followerProfileById = new Map(followerProfiles.map((profile) => [profile.id, profile]));
  const followerMediaById = await resolveProfileMediaMap(supabase, followerProfiles);

  return followerIds
    .map((followerId) => {
      const follower = followerProfileById.get(followerId);
      if (!follower) {
        return null;
      }

      const followerEmail = follower.email || '';
      const media = followerMediaById.get(followerId);
      return {
        id: follower.id,
        name: displayName(follower),
        initials: buildInitials(follower.first_name, follower.last_name, followerEmail),
        avatarUrl: media && media.avatarUrl ? media.avatarUrl : null,
        href: buildProfilePath(follower.id, follower.first_name, follower.last_name),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));
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
  const profileMediaById = await resolveProfileMediaMap(supabase, profiles);

  return postRows.map((post) => {
    const author = profileById.get(post.author_id);
    const authorEmail = author && author.email ? author.email : '';
    const authorMedia = profileMediaById.get(post.author_id);
    const course = courseById.get(post.course_id);
    const community = communityById.get(post.community_id);
    let scopeLabel = 'General';
    let scopeHref = '/feed';

    if (community) {
      scopeLabel = community.name || 'Community';
      scopeHref = `/communities/${community.id}`;
    } else if (course) {
      scopeLabel = course.name || 'Course';
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
      authorName: displayName(author),
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
  const isOwnProfile = profile.id === sessionUser.id;
  const profileWithFallbacks = { ...profile };
  if (profile.id === sessionUser.id && !profileWithFallbacks.email) {
    profileWithFallbacks.email = sessionUser.email || null;
  }

  const [media, schoolName, membershipData, postRows, followState, followers] = await Promise.all([
    resolveProfileMedia(supabase, profileWithFallbacks),
    fetchSchoolNameById(supabase, profileWithFallbacks.school_id),
    fetchMembershipCollections(supabase, profile.id),
    fetchProfilePostsByAuthorId(supabase, profile.id),
    fetchFollowState(supabase, sessionUser.id, profile.id),
    fetchFollowersList(supabase, profile.id),
  ]);
  const posts = await buildPostsViewModel(supabase, postRows, sessionUser.id);

  return res.render('profile', {
    user: sessionUser,
    currentUser: sessionUser,
    profile: profileWithFallbacks,
    profileAvatarUrl: media.avatarUrl,
    profileBannerUrl: media.bannerUrl,
    profileSchoolName: schoolName || 'Washington State University',
    isOwnProfile,
    isFollowing: followState.isFollowing,
    counts: {
      posts: posts.length,
      courses: membershipData.courses.length,
      communities: membershipData.communities.length,
      followers: followState.followersCount,
    },
    courses: membershipData.courses,
    communities: membershipData.communities,
    followers,
    posts,
  });
}

router.post('/:userId/follow', requireAuth, async (req, res) => {
  const targetUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  const viewerUserId = req.session.auth.user.id;

  if (!targetUserId) {
    if (wantsJson(req)) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    return res.redirect('/profile');
  }

  if (targetUserId === viewerUserId) {
    if (wantsJson(req)) {
      return res.status(400).json({ error: 'You cannot follow yourself.' });
    }
    return res.redirect('/profile');
  }

  const supabase = createSupabaseAdminClient();
  const targetProfileResult = await fetchProfileById(supabase, targetUserId);
  if (!targetProfileResult.profile) {
    if (wantsJson(req)) {
      return res.status(404).json({ error: 'Profile not found.' });
    }
    return res.redirect('/profile');
  }

  const existingFollowResult = await supabase
    .from('followers')
    .select('follower_id,following_id')
    .eq('follower_id', viewerUserId)
    .eq('following_id', targetUserId)
    .maybeSingle();

  if (existingFollowResult.error) {
    if (wantsJson(req)) {
      return res.status(500).json({ error: 'Unable to update follow state.' });
    }
    return res.redirect(buildProfilePath(targetUserId, targetProfileResult.profile.first_name, targetProfileResult.profile.last_name));
  }

  let nextFollowingState = false;

  if (existingFollowResult.data) {
    const deleteResult = await supabase
      .from('followers')
      .delete()
      .eq('follower_id', viewerUserId)
      .eq('following_id', targetUserId);

    if (deleteResult.error) {
      if (wantsJson(req)) {
        return res.status(500).json({ error: 'Unable to update follow state.' });
      }
      return res.redirect(buildProfilePath(targetUserId, targetProfileResult.profile.first_name, targetProfileResult.profile.last_name));
    }
  } else {
    const insertResult = await supabase
      .from('followers')
      .insert({ follower_id: viewerUserId, following_id: targetUserId });

    if (insertResult.error) {
      if (wantsJson(req)) {
        return res.status(500).json({ error: 'Unable to update follow state.' });
      }
      return res.redirect(buildProfilePath(targetUserId, targetProfileResult.profile.first_name, targetProfileResult.profile.last_name));
    }

    nextFollowingState = true;
  }

  const followersCountResult = await supabase
    .from('followers')
    .select('*', { count: 'exact', head: true })
    .eq('following_id', targetUserId);
  const followersCount = Number.isInteger(followersCountResult.count)
    ? followersCountResult.count
    : 0;

  if (wantsJson(req)) {
    return res.json({
      ok: true,
      isFollowing: nextFollowingState,
      followersCount,
      connectionsCount: followersCount,
    });
  }

  return res.redirect(buildProfilePath(
    targetUserId,
    targetProfileResult.profile.first_name,
    targetProfileResult.profile.last_name
  ));
});

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
