var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');

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

  return {
    communityName,
    description,
    isPrivate: visibility === 'private',
  };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const supabase = createSupabaseAdminClient();

    const [communitiesResult, membershipsResult] = await Promise.all([
      supabase
        .from('communities')
        .select('id,name,description,creator_id,created_at')
        .order('name', { ascending: true }),
      supabase
        .from('community_members')
        .select('community_id,user_id'),
    ]);

    const communities = communitiesResult.error || !communitiesResult.data
      ? []
      : communitiesResult.data;
    const memberships = membershipsResult.error || !membershipsResult.data
      ? []
      : membershipsResult.data;

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
        'No description has been added for this community yet.';

      return {
        id: community.id,
        name,
        description,
        memberCount,
        memberLabel: `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`,
        bubbleText: buildBubbleText(name),
        avatarClass: `v${(index % 8) + 1}`,
      };
    });

    return res.render('communities', {
      communities: communityCards,
    });
  } catch (_err) {
    return res.render('communities', {
      communities: [],
    });
  }
});

router.get('/create-community', requireAuth, (req, res) => {
  return res.render('create-community', {
    formError: typeof req.query.error === 'string' ? req.query.error : null,
  });
});

router.post('/create-community', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const { communityName, description, isPrivate } = normalizeCreatePayload(req.body);

  if (!communityName) {
    return res.redirect(
      '/communities/create-community?error=' + encodeURIComponent('Community name is required.')
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: createdCommunity, error: createError } = await supabase
      .from('communities')
      .insert({
        name: communityName,
        description: description || null,
        creator_id: sessionUser.id,
        is_private: isPrivate,
      })
      .select('id')
      .single();

    if (createError || !createdCommunity) {
      return res.redirect(
        '/communities/create-community?error=' +
          encodeURIComponent('Unable to create community right now.')
      );
    }

    await supabase
      .from('community_members')
      .upsert(
        [{ user_id: sessionUser.id, community_id: createdCommunity.id, role: 'owner' }],
        { onConflict: 'user_id,community_id' }
      );

    return res.redirect(`/community/${createdCommunity.id}`);
  } catch (_err) {
    return res.redirect(
      '/communities/create-community?error=' + encodeURIComponent('Unable to create community right now.')
    );
  }
});

router.get('/manage', requireAuth, (req, res) => {
  res.render('manage-community');
});

module.exports = router;
