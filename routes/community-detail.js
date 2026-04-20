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

async function buildCommunityPageModel(supabase, communityId) {
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
  const rawMemberIds = (memberRowsResult.data || [])
    .map((row) => row.user_id)
    .filter(Boolean);
  const memberIdSet = new Set(rawMemberIds);

  if (communityRow.creator_id && !memberIdSet.has(communityRow.creator_id)) {
    memberIdSet.add(communityRow.creator_id);
  }

  const memberIds = [...memberIdSet];
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
  const postAuthorIds = [...new Set(postRows.map((row) => row.author_id).filter(Boolean))];
  const postAuthorProfiles = await fetchProfilesByIds(supabase, postAuthorIds);
  const postAuthorById = new Map(postAuthorProfiles.map((row) => [row.id, row]));

  const posts = postRows.map((row) => {
    const author = postAuthorById.get(row.author_id);
    const authorName = displayName(author);
    const content = row.content && String(row.content).trim()
      ? String(row.content).trim()
      : '';

    const paragraphs = content
      ? content.split(/\r?\n+/).map((part) => part.trim()).filter(Boolean)
      : ['No content'];

    return {
      id: row.id,
      authorName,
      authorInitials: buildInitials(author && author.first_name, author && author.last_name, author && author.email),
      createdAtLabel: formatPostDate(row.created_at),
      paragraphs,
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

    const communityId = await resolveCommunityId(
      supabase,
      sessionUser.id,
      explicitCommunityId
    );
    const viewModel = await buildCommunityPageModel(supabase, communityId);

    return res.render('community', {
      user,
      community: viewModel.community,
      members: viewModel.members,
      memberPreview: viewModel.memberPreview,
      remainingMemberCount: viewModel.remainingMemberCount,
      posts: viewModel.posts,
      notFoundMessage: viewModel.notFoundMessage,
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
    });
  }
}

router.get('/', requireAuth, async (req, res) => {
  const explicitCommunityId = toPositiveInteger(req.query.id);
  return renderCommunity(req, res, explicitCommunityId);
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
    });
  }

  return renderCommunity(req, res, explicitCommunityId);
});

module.exports = router;
