const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  buildDisplayName,
  buildInitials,
  buildProfilePath,
  formatCreatedAt: formatPostDate,
} = require('../lib/utils');
const { resolveProfileMedia, resolveProfileMediaMap } = require('../lib/profileMedia');
const communityModel = require('../models/communityModel');

const PREVIEW_MEMBER_COUNT = 5;
const DEFAULT_DESCRIPTION = 'No description has been added for this community yet.';

function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildBubbleText(name) {
  if (!name || typeof name !== 'string') {
    return 'N/A';
  }

  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return parts[0].slice(0, 4).toUpperCase();
}

function normalizeCreatePayload(body) {
  const source = body || {};
  const communityName = typeof source.communityName === 'string' ? source.communityName.trim() : '';
  const description = typeof source.description === 'string' ? source.description.trim() : '';
  const visibility = typeof source.visibility === 'string' ? source.visibility.trim().toLowerCase() : 'public';
  const logoPath = communityModel.normalizeStoragePath(source.logoPath);

  return {
    communityName,
    description,
    isPrivate: visibility === 'private',
    logoPath,
  };
}

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

function fallbackRedirectForCommunity(communityId) {
  return `/communities/${communityId}`;
}

function buildFallbackUser(sessionUser) {
  return {
    id: sessionUser.id,
    firstName: sessionUser.firstName || null,
    lastName: sessionUser.lastName || null,
    fullName: buildDisplayName(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
    email: sessionUser.email,
    initials: buildInitials(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
    profileAvatarUrl: sessionUser.profileAvatarUrl || null,
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
    communityModel.fetchLikeRowsByPostIds(supabase, postIds),
    communityModel.fetchUserLikeRowsByPostIds(supabase, postIds, userId),
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

  const comments = await communityModel.fetchCommentsByPostIds(supabase, postIds);
  const commentAuthorIds = [...new Set(comments.map((row) => row.author_id).filter(Boolean))];
  const commentAuthorProfiles = await communityModel.fetchProfilesByIds(supabase, commentAuthorIds);
  const commentAuthorMediaById = await resolveProfileMediaMap(supabase, commentAuthorProfiles);
  const commentAuthorById = new Map(commentAuthorProfiles.map((row) => [row.id, row]));

  const commentCountByPostId = new Map();
  const commentsByPostId = new Map();

  comments.forEach((comment) => {
    const author = commentAuthorById.get(comment.author_id);
    const authorName = displayName(author);
    const authorMedia = commentAuthorMediaById.get(comment.author_id);
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
      authorAvatarUrl: authorMedia && authorMedia.avatarUrl ? authorMedia.avatarUrl : null,
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

  const communityData = await communityModel.fetchCommunityPageData(supabase, communityId);
  if (!communityData || !communityData.community) {
    return {
      community: null,
      members: [],
      memberPreview: [],
      remainingMemberCount: 0,
      posts: [],
      notFoundMessage: 'Community not found.',
    };
  }

  const communityRow = communityData.community;
  const creatorProfile = communityData.creatorProfile;
  const memberIds = communityData.memberIds;
  const postRows = communityData.postRows;
  const memberIdSet = new Set(memberIds);
  const isCreator = Boolean(viewerUserId && communityRow.creator_id && viewerUserId === communityRow.creator_id);
  const isMember = Boolean(viewerUserId && memberIdSet.has(viewerUserId));

  const memberProfiles = await communityModel.fetchProfilesByIds(supabase, memberIds);
  const memberMediaById = await resolveProfileMediaMap(supabase, memberProfiles);
  const profileById = new Map(memberProfiles.map((row) => [row.id, row]));
  const creatorMedia = creatorProfile ? await resolveProfileMedia(supabase, creatorProfile) : null;

  const members = memberIds
    .map((memberId) => {
      const profile = profileById.get(memberId);

      if (!profile && creatorProfile && creatorProfile.id === memberId) {
        return {
          id: memberId,
          name: displayName(creatorProfile),
          initials: buildInitials(creatorProfile.first_name, creatorProfile.last_name, creatorProfile.email),
          profileAvatarUrl: creatorMedia && creatorMedia.avatarUrl ? creatorMedia.avatarUrl : null,
          profileHref: buildProfilePath(
            memberId,
            creatorProfile.first_name,
            creatorProfile.last_name
          ),
        };
      }

      return {
        id: memberId,
        name: displayName(profile),
        initials: buildInitials(
          profile && profile.first_name,
          profile && profile.last_name,
          profile && profile.email
        ),
        profileAvatarUrl: memberMediaById.get(memberId)?.avatarUrl || null,
        profileHref: buildProfilePath(
          memberId,
          profile && profile.first_name,
          profile && profile.last_name
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const postIds = postRows.map((row) => row.id).filter(Boolean);
  const postAuthorIds = [...new Set(postRows.map((row) => row.author_id).filter(Boolean))];
  const [postAuthorProfiles, likeState, commentState] = await Promise.all([
    communityModel.fetchProfilesByIds(supabase, postAuthorIds),
    buildLikeState(supabase, postIds, viewerUserId),
    buildCommentState(supabase, postIds),
  ]);
  const postAuthorMediaById = await resolveProfileMediaMap(supabase, postAuthorProfiles);
  const postAuthorById = new Map(postAuthorProfiles.map((row) => [row.id, row]));

  const posts = postRows.map((row) => {
    const author = postAuthorById.get(row.author_id);
    const authorName = displayName(author);
    const authorMedia = postAuthorMediaById.get(row.author_id);
    const normalizedAuthorRole =
      author && typeof author.role === 'string' ? author.role.trim().toLowerCase() : '';
    let authorRoleLabel = null;
    if (normalizedAuthorRole === 'admin') {
      authorRoleLabel = 'UniConnect Admin';
    } else if (normalizedAuthorRole === 'official') {
      authorRoleLabel = 'School Official';
    }
    const content = row.content && String(row.content).trim() ? String(row.content).trim() : '';

    return {
      id: row.id,
      authorId: row.author_id,
      authorProfileHref: buildProfilePath(
        row.author_id,
        author && author.first_name,
        author && author.last_name
      ),
      authorName,
      authorRole: normalizedAuthorRole,
      authorRoleLabel,
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        author && author.email
      ),
      authorAvatarUrl: authorMedia && authorMedia.avatarUrl ? authorMedia.avatarUrl : null,
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
  const fallbackUser = buildFallbackUser(sessionUser);

  try {
    const supabase = createSupabaseAdminClient();
    const currentProfile = await communityModel.fetchProfileById(supabase, sessionUser.id);
    const currentMedia = currentProfile ? await resolveProfileMedia(supabase, currentProfile) : null;
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
      profileAvatarUrl: currentMedia && currentMedia.avatarUrl ? currentMedia.avatarUrl : null,
    };

    const communityId = await communityModel.resolveCommunityId(
      supabase,
      sessionUser.id,
      explicitCommunityId
    );
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

async function listCommunities(req, res) {
  try {
    const supabase = createSupabaseAdminClient();
    const { communities, memberships } = await communityModel.fetchCommunityDirectoryData(supabase);
    const memberSetByCommunityId = new Map();

    memberships.forEach((membership) => {
      if (!membership || !membership.community_id || !membership.user_id) {
        return;
      }

      const existing = memberSetByCommunityId.get(membership.community_id) || new Set();
      existing.add(membership.user_id);
      memberSetByCommunityId.set(membership.community_id, existing);
    });

    const communityCards = communities.map((community, index) => {
      const memberSet = memberSetByCommunityId.get(community.id) || new Set();

      if (community.creator_id) {
        memberSet.add(community.creator_id);
      }

      const memberCount = memberSet.size;
      const name = (community.name && String(community.name).trim()) || 'Untitled Community';
      const description =
        (community.description && String(community.description).trim()) ||
        DEFAULT_DESCRIPTION;

      return {
        id: community.id,
        name,
        description,
        memberCount,
        memberLabel: `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`,
        bubbleText: buildBubbleText(name),
        avatarClass: `v${(index % 8) + 1}`,
        logoBucket: community.logo_bucket || communityModel.DEFAULT_STORAGE_BUCKET,
        logoPath: communityModel.normalizeStoragePath(community.logo_path),
        logoUrl: null,
      };
    });

    const logoUrls = await Promise.all(
      communityCards.map((community) =>
        communityModel.createSignedImageUrl(supabase, community.logoBucket, community.logoPath)
      )
    );

    logoUrls.forEach((logoUrl, index) => {
      communityCards[index].logoUrl = logoUrl;
    });

    return res.render('communities', {
      communities: communityCards,
    });
  } catch (_err) {
    return res.render('communities', {
      communities: [],
    });
  }
}

function showCreateCommunity(req, res) {
  return res.render('create-community', {
    formError: typeof req.query.error === 'string' ? req.query.error : null,
    supabaseUrl: process.env.SUPABASE_URL || '',
    storageBucket: communityModel.DEFAULT_STORAGE_BUCKET,
  });
}

async function createCommunity(req, res) {
  const sessionUser = req.session.auth.user;
  const { communityName, description, isPrivate, logoPath } = normalizeCreatePayload(req.body);

  if (!communityName) {
    return res.redirect(
      '/communities/create-community?error=' + encodeURIComponent('Community name is required.')
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const createdCommunity = await communityModel.createCommunityRecord(supabase, {
      name: communityName,
      description,
      creatorId: sessionUser.id,
      isPrivate,
      logoBucket: communityModel.DEFAULT_STORAGE_BUCKET,
      logoPath,
    });

    if (!createdCommunity) {
      return res.redirect(
        '/communities/create-community?error=' +
          encodeURIComponent('Unable to create community right now.')
      );
    }

    await communityModel.upsertCommunityMembership(supabase, {
      userId: sessionUser.id,
      communityId: createdCommunity.id,
      role: 'owner',
    });

    return res.redirect(`/communities/${createdCommunity.id}`);
  } catch (_err) {
    return res.redirect(
      '/communities/create-community?error=' + encodeURIComponent('Unable to create community right now.')
    );
  }
}

async function showManageCommunity(req, res) {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);

  if (!communityId) {
    return res.redirect('/communities');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const community = await communityModel.fetchCommunityForManage(supabase, communityId);

    if (!community) {
      return res.redirect('/communities');
    }

    if (!community.creator_id || community.creator_id !== sessionUser.id) {
      return res.redirect(`/communities/${communityId}`);
    }

    const logoSignedUrl = await communityModel.createSignedImageUrl(
      supabase,
      community.logo_bucket || communityModel.DEFAULT_STORAGE_BUCKET,
      community.logo_path
    );

    return res.render('manage-community', {
      communityId: community.id,
      communityName: community.name || 'Community',
      communityDescription:
        typeof community.description === 'string' ? community.description : '',
      communityVisibility: community.is_private ? 'private' : 'public',
      logoPath: communityModel.normalizeStoragePath(community.logo_path) || '',
      logoSignedUrl: logoSignedUrl || '',
      supabaseUrl: process.env.SUPABASE_URL || '',
      storageBucket: communityModel.DEFAULT_STORAGE_BUCKET,
      initialTopics: [],
      formError: typeof req.query.error === 'string' ? req.query.error : null,
      formSuccess: typeof req.query.success === 'string' ? req.query.success : null,
    });
  } catch (_err) {
    return res.redirect('/communities');
  }
}

async function updateCommunity(req, res) {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);
  const { communityName, description, isPrivate, logoPath } = normalizeCreatePayload(req.body);

  if (!communityId) {
    return res.redirect('/communities');
  }

  if (!communityName) {
    return res.redirect(
      `/communities/manage/${communityId}?error=` +
      encodeURIComponent('Community name is required.')
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const updatedCommunity = await communityModel.updateCommunityForCreator(supabase, {
      communityId,
      creatorId: sessionUser.id,
      name: communityName,
      description,
      isPrivate,
      logoBucket: communityModel.DEFAULT_STORAGE_BUCKET,
      logoPath,
    });

    if (!updatedCommunity) {
      return res.redirect(
        `/communities/manage/${communityId}?error=` +
        encodeURIComponent('Unable to save changes right now.')
      );
    }

    return res.redirect(
      `/communities/manage/${communityId}?success=` +
      encodeURIComponent('Community updated successfully.')
    );
  } catch (_err) {
    return res.redirect(
      `/communities/manage/${communityId}?error=` +
      encodeURIComponent('Unable to save changes right now.')
    );
  }
}

async function deleteCommunity(req, res) {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);

  if (!communityId) {
    return res.redirect('/communities');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const community = await communityModel.fetchCommunityOwnerRecord(supabase, communityId);

    if (!community) {
      return res.redirect('/communities');
    }

    if (!community.creator_id || community.creator_id !== sessionUser.id) {
      return res.redirect(`/communities/${communityId}`);
    }

    const cleanupSucceeded = await communityModel.removeCommunityWithDependencies(
      supabase,
      communityId
    );
    if (!cleanupSucceeded) {
      return res.redirect(
        `/communities/manage/${communityId}?error=` +
        encodeURIComponent('Unable to delete this community right now.')
      );
    }

    const deleted = await communityModel.deleteCommunityForCreator(
      supabase,
      communityId,
      sessionUser.id
    );
    if (!deleted) {
      return res.redirect(
        `/communities/manage/${communityId}?error=` +
        encodeURIComponent('Unable to delete this community right now.')
      );
    }

    return res.redirect('/communities');
  } catch (_err) {
    return res.redirect(
      `/communities/manage/${communityId}?error=` +
      encodeURIComponent('Unable to delete this community right now.')
    );
  }
}

function showCommunityHome(req, res) {
  const explicitCommunityId = toPositiveInteger(req.query.id);
  return renderCommunity(req, res, explicitCommunityId);
}

async function showCommunityById(req, res) {
  const sessionUser = req.session.auth.user;
  const explicitCommunityId = toPositiveInteger(req.params.id);

  if (!explicitCommunityId) {
    return res.status(404).render('community', {
      user: buildFallbackUser(sessionUser),
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
}

async function joinCommunity(req, res) {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);

  if (!communityId) {
    return res.redirect('/communities');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const community = await communityModel.fetchCommunityIdentity(supabase, communityId);

    if (!community) {
      return res.redirect('/communities');
    }

    await communityModel.joinCommunity(supabase, sessionUser.id, communityId);
  } catch (_err) {
    // Ignore and redirect to destination.
  }

  const redirectTo = typeof req.body.redirectTo === 'string' && req.body.redirectTo.trim()
    ? req.body.redirectTo.trim()
    : fallbackRedirectForCommunity(communityId);

  return res.redirect(redirectTo);
}

async function leaveCommunity(req, res) {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);

  if (!communityId) {
    return res.redirect('/communities');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const community = await communityModel.fetchCommunityIdentity(supabase, communityId);

    if (!community) {
      return res.redirect('/communities');
    }

    if (community.creator_id !== sessionUser.id) {
      await communityModel.leaveCommunity(supabase, sessionUser.id, communityId);
    }
  } catch (_err) {
    // Ignore and redirect to destination.
  }

  const redirectTo = typeof req.body.redirectTo === 'string' && req.body.redirectTo.trim()
    ? req.body.redirectTo.trim()
    : fallbackRedirectForCommunity(communityId);

  return res.redirect(redirectTo);
}

async function createCommunityPost(req, res) {
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
    const postAccess = await communityModel.userCanPostInCommunity(
      supabase,
      communityId,
      sessionUser.id
    );

    if (!postAccess.exists) {
      return res.redirect('/communities');
    }

    if (!postAccess.allowed) {
      return res.redirect(
        `${redirectBase}?error=${encodeURIComponent('Join this community before posting.')}`
      );
    }

    const created = await communityModel.createCommunityPost(supabase, {
      authorId: sessionUser.id,
      communityId,
      content,
    });

    if (!created) {
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
}

module.exports = {
  listCommunities,
  showCreateCommunity,
  createCommunity,
  showManageCommunity,
  updateCommunity,
  deleteCommunity,
  showCommunityHome,
  showCommunityById,
  joinCommunity,
  leaveCommunity,
  createCommunityPost,
};
