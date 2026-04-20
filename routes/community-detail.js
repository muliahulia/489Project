var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  buildDisplayName,
  buildInitials,
  formatCreatedAt: formatPostDate,
} = require('../lib/utils');

const PREVIEW_MEMBER_COUNT = 5;
const DEFAULT_DESCRIPTION = 'No description has been added for this community yet.';

function displayName(profile) {
  if (!profile) {
    return 'Unknown User';
  }

  return buildDisplayName(profile.first_name, profile.last_name, profile.email);
}

function formatFoundingLabel(timestamp) {
  if (!timestamp) {
    return 'Founding year unknown';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Founding year unknown';
  }

  return `Founded ${date.getFullYear()}`;
}

function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function fallbackRedirectForCommunity(communityId) {
  return `/communities/${communityId}`;
}

async function fetchCommunityById(supabase, communityId) {
  const { data, error } = await supabase
    .from('communities')
    .select('id,creator_id')
    .eq('id', communityId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function canUserPostInCommunity(supabase, communityId, userId) {
  const community = await fetchCommunityById(supabase, communityId);
  if (!community) {
    return { exists: false, allowed: false };
  }

  if (community.creator_id && community.creator_id === userId) {
    return { exists: true, allowed: true };
  }

  const { data, error } = await supabase
    .from('community_members')
    .select('user_id')
    .eq('community_id', communityId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    return { exists: true, allowed: false };
  }

  return { exists: true, allowed: Boolean(data) };
}

async function fetchProfilesByIds(supabase, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id,first_name,last_name,email')
    .in('id', ids);

  if (error || !data) {
    return [];
  }

  return data;
}

async function buildLikeState(supabase, postIds, userId) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
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

  return {
    likeCountByPostId,
    likedPostIds: new Set((userLikesResult.data || []).map((row) => row.post_id)),
  };
}

async function buildCommentState(supabase, postIds) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return {
      commentCountByPostId: new Map(),
      commentsByPostId: new Map(),
    };
  }

  const { data: commentRows, error: commentsError } = await supabase
    .from('comments')
    .select('id,post_id,author_id,content,created_at,is_deleted')
    .eq('is_deleted', false)
    .in('post_id', postIds)
    .order('created_at', { ascending: true });

  if (commentsError) {
    return {
      commentCountByPostId: new Map(),
      commentsByPostId: new Map(),
    };
  }

  const comments = commentRows || [];
  const commentAuthorIds = [...new Set(comments.map((row) => row.author_id).filter(Boolean))];
  const commentAuthorProfiles = await fetchProfilesByIds(supabase, commentAuthorIds);
  const commentAuthorById = new Map(commentAuthorProfiles.map((row) => [row.id, row]));

  const commentCountByPostId = new Map();
  const commentsByPostId = new Map();

  comments.forEach((comment) => {
    const author = commentAuthorById.get(comment.author_id);
    const authorName = displayName(author);
    const authorEmail = (author && author.email) || '';
    const list = commentsByPostId.get(comment.post_id) || [];

    list.push({
      id: comment.id,
      authorName,
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      createdAtLabel: formatPostDate(comment.created_at),
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

async function resolveCommunityId(supabase, userId, explicitCommunityId) {
  if (explicitCommunityId) {
    return explicitCommunityId;
  }

  const membershipResult = await supabase
    .from('community_members')
    .select('community_id')
    .eq('user_id', userId)
    .order('community_id', { ascending: true })
    .limit(1);

  if (!membershipResult.error && membershipResult.data && membershipResult.data.length > 0) {
    return membershipResult.data[0].community_id;
  }

  const firstCommunityResult = await supabase
    .from('communities')
    .select('id')
    .order('id', { ascending: true })
    .limit(1);

  if (!firstCommunityResult.error && firstCommunityResult.data && firstCommunityResult.data.length > 0) {
    return firstCommunityResult.data[0].id;
  }

  return null;
}

async function buildCommunityPageModel(supabase, communityId, viewerUserId) {
  if (!communityId) {
    return {
      community: null,
      members: [],
      memberPreview: [],
      remainingMemberCount: 0,
      posts: [],
      notFoundMessage: 'No communities are available yet.',
    };
  }

  const communityResult = await supabase
    .from('communities')
    .select('id,name,description,creator_id,is_private,created_at')
    .eq('id', communityId)
    .maybeSingle();

  if (communityResult.error || !communityResult.data) {
    return {
      community: null,
      members: [],
      memberPreview: [],
      remainingMemberCount: 0,
      posts: [],
      notFoundMessage: 'Community not found.',
    };
  }

  const communityRow = communityResult.data;
  const [creatorResult, memberRowsResult, postsResult] = await Promise.all([
    communityRow.creator_id
      ? supabase
          .from('profiles')
          .select('id,first_name,last_name,email')
          .eq('id', communityRow.creator_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', communityRow.id),
    supabase
      .from('posts')
      .select('id,author_id,content,created_at')
      .eq('community_id', communityRow.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(25),
  ]);

  const creatorProfile = creatorResult.data || null;
  const rawMemberIds = (memberRowsResult.data || []).map((row) => row.user_id).filter(Boolean);
  const memberIdSet = new Set(rawMemberIds);

  if (communityRow.creator_id && !memberIdSet.has(communityRow.creator_id)) {
    memberIdSet.add(communityRow.creator_id);
  }

  const memberIds = [...memberIdSet];
  const isCreator = Boolean(viewerUserId && communityRow.creator_id && viewerUserId === communityRow.creator_id);
  const isMember = Boolean(viewerUserId && memberIdSet.has(viewerUserId));

  const memberProfiles = await fetchProfilesByIds(supabase, memberIds);
  const profileById = new Map(memberProfiles.map((row) => [row.id, row]));

  const members = memberIds
    .map((memberId) => {
      const profile = profileById.get(memberId);

      if (!profile && creatorProfile && creatorProfile.id === memberId) {
        return {
          id: memberId,
          name: displayName(creatorProfile),
          initials: buildInitials(creatorProfile.first_name, creatorProfile.last_name, creatorProfile.email),
        };
      }

      return {
        id: memberId,
        name: displayName(profile),
        initials: buildInitials(profile && profile.first_name, profile && profile.last_name, profile && profile.email),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const postRows = postsResult.error || !postsResult.data ? [] : postsResult.data;
  const postIds = postRows.map((row) => row.id).filter(Boolean);
  const postAuthorIds = [...new Set(postRows.map((row) => row.author_id).filter(Boolean))];
  const [postAuthorProfiles, likeState, commentState] = await Promise.all([
    fetchProfilesByIds(supabase, postAuthorIds),
    buildLikeState(supabase, postIds, viewerUserId),
    buildCommentState(supabase, postIds),
  ]);
  const postAuthorById = new Map(postAuthorProfiles.map((row) => [row.id, row]));

  const posts = postRows.map((row) => {
    const author = postAuthorById.get(row.author_id);
    const authorName = displayName(author);
    const content = row.content && String(row.content).trim() ? String(row.content).trim() : '';

    return {
      id: row.id,
      authorName,
      authorInitials: buildInitials(author && author.first_name, author && author.last_name, author && author.email),
      createdAtLabel: formatPostDate(row.created_at),
      scopeLabel: communityRow.name || 'Community',
      scopeHref: `/communities/${communityRow.id}`,
      content: content || 'No content',
      likeCount: likeState.likeCountByPostId.get(row.id) || 0,
      liked: likeState.likedPostIds.has(row.id),
      commentCount: commentState.commentCountByPostId.get(row.id) || 0,
      comments: commentState.commentsByPostId.get(row.id) || [],
    };
  });

  const memberCount = members.length;
  const creatorName = displayName(creatorProfile);
  const memberLabel = `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`;
  const metadataParts = [memberLabel, formatFoundingLabel(communityRow.created_at)];

  if (creatorProfile) {
    metadataParts.push(`Created by ${creatorName}`);
  }

  const description = communityRow.description && String(communityRow.description).trim()
    ? String(communityRow.description).trim()
    : DEFAULT_DESCRIPTION;

  return {
    community: {
      id: communityRow.id,
      name: communityRow.name || 'Untitled Community',
      description,
      metaLine: metadataParts.join(' · '),
      isPrivate: Boolean(communityRow.is_private),
      isCreator,
      isMember,
      canJoin: !isMember,
      canLeave: isMember && !isCreator,
      canPost: isMember,
    },
    members,
    memberPreview: members.slice(0, PREVIEW_MEMBER_COUNT),
    remainingMemberCount: Math.max(0, members.length - PREVIEW_MEMBER_COUNT),
    posts,
    notFoundMessage: null,
  };
}

async function renderCommunity(req, res, explicitCommunityId) {
  const sessionUser = req.session.auth.user;
  const fallbackUser = {
    id: sessionUser.id,
    firstName: sessionUser.firstName || null,
    lastName: sessionUser.lastName || null,
    fullName: buildDisplayName(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
    email: sessionUser.email,
    initials: buildInitials(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
  };

  try {
    const supabase = createSupabaseAdminClient();

    const currentProfileResult = await supabase
      .from('profiles')
      .select('id,first_name,last_name,email')
      .eq('id', sessionUser.id)
      .maybeSingle();

    const currentProfile = currentProfileResult.data || null;
    const currentFirstName = (currentProfile && currentProfile.first_name) || sessionUser.firstName || null;
    const currentLastName =
      (currentProfile && typeof currentProfile.last_name === 'string')
        ? currentProfile.last_name
        : sessionUser.lastName || null;

    const user = {
      id: sessionUser.id,
      firstName: currentFirstName,
      lastName: currentLastName,
      fullName: buildDisplayName(
        currentFirstName,
        currentLastName,
        (currentProfile && currentProfile.email) || sessionUser.email
      ),
      email: (currentProfile && currentProfile.email) || sessionUser.email,
      initials: buildInitials(
        currentFirstName,
        currentLastName,
        (currentProfile && currentProfile.email) || sessionUser.email
      ),
    };

    const communityId = await resolveCommunityId(supabase, sessionUser.id, explicitCommunityId);
    const viewModel = await buildCommunityPageModel(supabase, communityId, sessionUser.id);

    return res.render('community', {
      user,
      community: viewModel.community,
      members: viewModel.members,
      memberPreview: viewModel.memberPreview,
      remainingMemberCount: viewModel.remainingMemberCount,
      posts: viewModel.posts,
      notFoundMessage: viewModel.notFoundMessage,
      formError: typeof req.query.error === 'string' ? req.query.error : null,
    });
  } catch (_err) {
    return res.status(500).render('community', {
      user: fallbackUser,
      community: null,
      members: [],
      memberPreview: [],
      remainingMemberCount: 0,
      posts: [],
      notFoundMessage: 'Unable to load this community right now.',
      formError: null,
    });
  }
}

router.get('/', requireAuth, async (req, res) => {
  const explicitCommunityId = toPositiveInteger(req.query.id);
  return renderCommunity(req, res, explicitCommunityId);
});

router.post('/:id/join', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);

  if (!communityId) {
    return res.redirect('/communities');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const community = await fetchCommunityById(supabase, communityId);

    if (!community) {
      return res.redirect('/communities');
    }

    await supabase
      .from('community_members')
      .upsert(
        [{ user_id: sessionUser.id, community_id: communityId, role: 'member' }],
        { onConflict: 'user_id,community_id' }
      );
  } catch (_err) {
    // Ignore and redirect to destination.
  }

  const redirectTo = typeof req.body.redirectTo === 'string' && req.body.redirectTo.trim()
    ? req.body.redirectTo.trim()
    : fallbackRedirectForCommunity(communityId);

  return res.redirect(redirectTo);
});

router.post('/:id/leave', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);

  if (!communityId) {
    return res.redirect('/communities');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const community = await fetchCommunityById(supabase, communityId);

    if (!community) {
      return res.redirect('/communities');
    }

    if (community.creator_id !== sessionUser.id) {
      await supabase
        .from('community_members')
        .delete()
        .eq('user_id', sessionUser.id)
        .eq('community_id', communityId);
    }
  } catch (_err) {
    // Ignore and redirect to destination.
  }

  const redirectTo = typeof req.body.redirectTo === 'string' && req.body.redirectTo.trim()
    ? req.body.redirectTo.trim()
    : fallbackRedirectForCommunity(communityId);

  return res.redirect(redirectTo);
});

router.post('/:id/posts', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  const redirectBase = communityId ? `/communities/${communityId}` : '/communities';

  if (!communityId) {
    return res.redirect('/communities');
  }

  if (!content) {
    return res.redirect(
      `${redirectBase}?error=${encodeURIComponent('Post content cannot be empty.')}`
    );
  }

  if (content.length > 4000) {
    return res.redirect(
      `${redirectBase}?error=${encodeURIComponent('Post content is too long (max 4000 characters).')}`
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const postAccess = await canUserPostInCommunity(supabase, communityId, sessionUser.id);

    if (!postAccess.exists) {
      return res.redirect('/communities');
    }

    if (!postAccess.allowed) {
      return res.redirect(
        `${redirectBase}?error=${encodeURIComponent('Join this community before posting.')}`
      );
    }

    const { error } = await supabase
      .from('posts')
      .insert({
        author_id: sessionUser.id,
        content,
        is_official: false,
        community_id: communityId,
        course_id: null,
      });

    if (error) {
      return res.redirect(
        `${redirectBase}?error=${encodeURIComponent('Unable to publish post right now.')}`
      );
    }

    return res.redirect(redirectBase);
  } catch (_err) {
    return res.redirect(
      `${redirectBase}?error=${encodeURIComponent('Unable to publish post right now.')}`
    );
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const explicitCommunityId = toPositiveInteger(req.params.id);

  if (!explicitCommunityId) {
    return res.status(404).render('community', {
      user: {
        id: sessionUser.id,
        firstName: sessionUser.firstName || null,
        lastName: sessionUser.lastName || null,
        fullName: buildDisplayName(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
        email: sessionUser.email,
        initials: buildInitials(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
      },
      community: null,
      members: [],
      memberPreview: [],
      remainingMemberCount: 0,
      posts: [],
      notFoundMessage: 'Community not found.',
      formError: null,
    });
  }

  return renderCommunity(req, res, explicitCommunityId);
});

module.exports = router;
