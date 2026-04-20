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

function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function removeCommunityWithDependencies(supabase, communityId) {
  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('id')
    .eq('community_id', communityId);

  if (postsError) {
    return { ok: false };
  }

  const postIds = Array.isArray(posts) ? posts.map((row) => row.id).filter(Boolean) : [];

  if (postIds.length > 0) {
    const { data: comments, error: commentsError } = await supabase
      .from('comments')
      .select('id')
      .in('post_id', postIds);

    if (commentsError) {
      return { ok: false };
    }

    const commentIds = Array.isArray(comments) ? comments.map((row) => row.id).filter(Boolean) : [];

    const { error: reportByPostError } = await supabase
      .from('reports')
      .delete()
      .in('post_id', postIds);

    if (reportByPostError) {
      return { ok: false };
    }

    if (commentIds.length > 0) {
      const { error: reportByCommentError } = await supabase
        .from('reports')
        .delete()
        .in('comment_id', commentIds);

      if (reportByCommentError) {
        return { ok: false };
      }
    }

    const { error: reactionsError } = await supabase
      .from('reactions')
      .delete()
      .in('post_id', postIds);

    if (reactionsError) {
      return { ok: false };
    }

    const { error: commentsDeleteError } = await supabase
      .from('comments')
      .delete()
      .in('post_id', postIds);

    if (commentsDeleteError) {
      return { ok: false };
    }

    const { error: postsDeleteError } = await supabase
      .from('posts')
      .delete()
      .in('id', postIds);

    if (postsDeleteError) {
      return { ok: false };
    }
  }

  const { error: membersError } = await supabase
    .from('community_members')
    .delete()
    .eq('community_id', communityId);

  if (membersError) {
    return { ok: false };
  }

  return { ok: true };
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

    return res.redirect(`/communities/${createdCommunity.id}`);
  } catch (_err) {
    return res.redirect(
      '/communities/create-community?error=' + encodeURIComponent('Unable to create community right now.')
    );
  }
});

router.get('/manage/:id', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);

  if (!communityId) {
    return res.redirect('/communities');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: community, error } = await supabase
      .from('communities')
      .select('id,name,description,is_private,creator_id')
      .eq('id', communityId)
      .maybeSingle();

    if (error || !community) {
      return res.redirect('/communities');
    }

    if (!community.creator_id || community.creator_id !== sessionUser.id) {
      return res.redirect(`/communities/${communityId}`);
    }

    return res.render('manage-community', {
      communityId: community.id,
      communityName: community.name || 'Community',
      communityDescription:
        typeof community.description === 'string' ? community.description : '',
      communityVisibility: community.is_private ? 'private' : 'public',
      initialTopics: [],
      formError: typeof req.query.error === 'string' ? req.query.error : null,
      formSuccess: typeof req.query.success === 'string' ? req.query.success : null,
    });
  } catch (_err) {
    return res.redirect('/communities');
  }
});

router.post('/manage/:id', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);
  const { communityName, description, isPrivate } = normalizeCreatePayload(req.body);

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
    const { data: updatedCommunity, error: updateError } = await supabase
      .from('communities')
      .update({
        name: communityName,
        description: description || null,
        is_private: isPrivate,
      })
      .eq('id', communityId)
      .eq('creator_id', sessionUser.id)
      .select('id')
      .maybeSingle();

    if (updateError || !updatedCommunity) {
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
});

router.post('/manage/:id/delete', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const communityId = toPositiveInteger(req.params.id);

  if (!communityId) {
    return res.redirect('/communities');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: community, error: communityError } = await supabase
      .from('communities')
      .select('id,creator_id')
      .eq('id', communityId)
      .maybeSingle();

    if (communityError || !community) {
      return res.redirect('/communities');
    }

    if (!community.creator_id || community.creator_id !== sessionUser.id) {
      return res.redirect(`/communities/${communityId}`);
    }

    const cleanupResult = await removeCommunityWithDependencies(supabase, communityId);
    if (!cleanupResult.ok) {
      return res.redirect(
        `/communities/manage/${communityId}?error=` +
        encodeURIComponent('Unable to delete this community right now.')
      );
    }

    const { error: deleteCommunityError } = await supabase
      .from('communities')
      .delete()
      .eq('id', communityId)
      .eq('creator_id', sessionUser.id);

    if (deleteCommunityError) {
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
});

module.exports = router;
