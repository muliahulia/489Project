const DEFAULT_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'media';
const SIGNED_IMAGE_TTL_SECONDS = 120;

function idsMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  return String(left) === String(right);
}

function isSchoolScoped(options = {}) {
  return !Boolean(options.isGlobalAdmin);
}

async function fetchSchoolProfileIds(supabase, schoolId) {
  if (!schoolId) {
    return [];
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('school_id', schoolId);

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data.map((row) => row.id).filter(Boolean);
}

async function fetchCreatorSchoolIdByCommunityId(supabase, communityIds) {
  if (!Array.isArray(communityIds) || communityIds.length === 0) {
    return new Map();
  }

  const { data: communities, error: communitiesError } = await supabase
    .from('communities')
    .select('id,creator_id')
    .in('id', communityIds);

  if (communitiesError || !Array.isArray(communities)) {
    return new Map();
  }

  const creatorIds = [...new Set(communities.map((row) => row.creator_id).filter(Boolean))];
  if (creatorIds.length === 0) {
    return new Map();
  }

  const { data: creatorRows, error: creatorsError } = await supabase
    .from('profiles')
    .select('id,school_id')
    .in('id', creatorIds);

  if (creatorsError || !Array.isArray(creatorRows)) {
    return new Map();
  }

  const creatorSchoolById = new Map(
    creatorRows.map((row) => [row.id, row.school_id || null])
  );
  const schoolByCommunityId = new Map();
  communities.forEach((community) => {
    schoolByCommunityId.set(
      community.id,
      creatorSchoolById.get(community.creator_id) || null
    );
  });

  return schoolByCommunityId;
}

function normalizeStoragePath(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

async function createSignedImageUrl(supabase, bucket, objectPath) {
  const path = normalizeStoragePath(objectPath);
  if (!path) {
    return null;
  }

  const storageBucket =
    typeof bucket === 'string' && bucket.trim() ? bucket.trim() : DEFAULT_STORAGE_BUCKET;

  try {
    const { data, error } = await supabase.storage
      .from(storageBucket)
      .createSignedUrl(path, SIGNED_IMAGE_TTL_SECONDS);

    if (error || !data || !data.signedUrl) {
      return null;
    }

    return data.signedUrl;
  } catch (_err) {
    return null;
  }
}

async function fetchCommunityDirectoryData(supabase) {
  const [communitiesResult, membershipsResult] = await Promise.all([
    supabase
      .from('communities')
      .select('id,name,description,creator_id,created_at,logo_bucket,logo_path')
      .order('name', { ascending: true }),
    supabase
      .from('community_members')
      .select('community_id,user_id'),
  ]);

  return {
    communities: communitiesResult.error || !communitiesResult.data ? [] : communitiesResult.data,
    memberships: membershipsResult.error || !membershipsResult.data ? [] : membershipsResult.data,
  };
}

async function createCommunityRecord(supabase, community) {
  const { data, error } = await supabase
    .from('communities')
    .insert({
      name: community.name,
      description: community.description || null,
      creator_id: community.creatorId,
      school_id: community.schoolId || null,
      is_private: Boolean(community.isPrivate),
      logo_bucket: community.logoBucket || DEFAULT_STORAGE_BUCKET,
      logo_path: community.logoPath || null,
    })
    .select('id')
    .single();

  return {
    community: error || !data ? null : data,
    error: error || null,
  };
}

async function upsertCommunityMembership(supabase, membership) {
  const { error } = await supabase
    .from('community_members')
    .upsert(
      [{
        user_id: membership.userId,
        community_id: membership.communityId,
        role: membership.role || 'member',
      }],
      { onConflict: 'user_id,community_id' }
    );

  return !error;
}

async function fetchCommunityForManage(supabase, communityId) {
  const { data, error } = await supabase
    .from('communities')
    .select('id,name,description,is_private,creator_id,logo_bucket,logo_path')
    .eq('id', communityId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function updateCommunityForCreator(supabase, updatePayload) {
  const { data, error } = await supabase
    .from('communities')
    .update({
      name: updatePayload.name,
      description: updatePayload.description || null,
      is_private: Boolean(updatePayload.isPrivate),
      logo_bucket: updatePayload.logoBucket || DEFAULT_STORAGE_BUCKET,
      logo_path: updatePayload.logoPath || null,
    })
    .eq('id', updatePayload.communityId)
    .eq('creator_id', updatePayload.creatorId)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function updateCommunityById(supabase, updatePayload) {
  const { data, error } = await supabase
    .from('communities')
    .update({
      name: updatePayload.name,
      description: updatePayload.description || null,
      is_private: Boolean(updatePayload.isPrivate),
      logo_bucket: updatePayload.logoBucket || DEFAULT_STORAGE_BUCKET,
      logo_path: updatePayload.logoPath || null,
    })
    .eq('id', updatePayload.communityId)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function fetchCommunityOwnerRecord(supabase, communityId) {
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

async function deleteCommunityForCreator(supabase, communityId, creatorId) {
  const { error } = await supabase
    .from('communities')
    .delete()
    .eq('id', communityId)
    .eq('creator_id', creatorId);

  return !error;
}

async function deleteCommunityById(supabase, communityId) {
  const { error } = await supabase
    .from('communities')
    .delete()
    .eq('id', communityId);

  return !error;
}

async function removeCommunityWithDependencies(supabase, communityId) {
  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('id')
    .eq('community_id', communityId);

  if (postsError) {
    return false;
  }

  const postIds = Array.isArray(posts) ? posts.map((row) => row.id).filter(Boolean) : [];

  if (postIds.length > 0) {
    const { data: comments, error: commentsError } = await supabase
      .from('comments')
      .select('id')
      .in('post_id', postIds);

    if (commentsError) {
      return false;
    }

    const commentIds = Array.isArray(comments) ? comments.map((row) => row.id).filter(Boolean) : [];

    const { error: reportByPostError } = await supabase
      .from('post_reports')
      .delete()
      .in('post_id', postIds);

    if (reportByPostError) {
      return false;
    }

    if (commentIds.length > 0) {
      const { error: reportByCommentError } = await supabase
        .from('post_reports')
        .delete()
        .in('comment_id', commentIds);

      if (reportByCommentError) {
        return false;
      }
    }

    const { error: reactionsError } = await supabase
      .from('reactions')
      .delete()
      .in('post_id', postIds);

    if (reactionsError) {
      return false;
    }

    const { error: commentsDeleteError } = await supabase
      .from('comments')
      .delete()
      .in('post_id', postIds);

    if (commentsDeleteError) {
      return false;
    }

    const { error: postsDeleteError } = await supabase
      .from('posts')
      .delete()
      .in('id', postIds);

    if (postsDeleteError) {
      return false;
    }
  }

  const { error: membersError } = await supabase
    .from('community_members')
    .delete()
    .eq('community_id', communityId);

  return !membersError;
}

async function fetchCommunityIdentity(supabase, communityId) {
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

async function fetchProfileById(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function fetchProfilesByIds(supabase, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids);

  if (error || !data) {
    return [];
  }

  return data;
}

async function resolveCommunityId(supabase, userId, explicitCommunityId, options = {}) {
  const schoolScoped = isSchoolScoped(options);
  const schoolId = options.schoolId || null;

  if (explicitCommunityId) {
    if (!schoolScoped) {
      return explicitCommunityId;
    }

    if (!schoolId) {
      return null;
    }

    const schoolByCommunityId = await fetchCreatorSchoolIdByCommunityId(
      supabase,
      [explicitCommunityId]
    );
    return idsMatch(schoolByCommunityId.get(explicitCommunityId), schoolId)
      ? explicitCommunityId
      : null;
  }

  if (schoolScoped && !schoolId) {
    return null;
  }

  const membershipResult = await supabase
    .from('community_members')
    .select('community_id')
    .eq('user_id', userId)
    .order('community_id', { ascending: true });

  const membershipCommunityIds = !membershipResult.error && Array.isArray(membershipResult.data)
    ? membershipResult.data.map((row) => row.community_id).filter(Boolean)
    : [];
  if (membershipCommunityIds.length > 0) {
    if (!schoolScoped) {
      return membershipCommunityIds[0];
    }

    const schoolByCommunityId = await fetchCreatorSchoolIdByCommunityId(
      supabase,
      membershipCommunityIds
    );
    const firstSchoolScopedMembershipId = membershipCommunityIds.find((communityId) =>
      idsMatch(schoolByCommunityId.get(communityId), schoolId)
    );
    if (firstSchoolScopedMembershipId) {
      return firstSchoolScopedMembershipId;
    }
  }

  if (!schoolScoped) {
    const firstCommunityResult = await supabase
      .from('communities')
      .select('id')
      .order('id', { ascending: true })
      .limit(1);
    if (!firstCommunityResult.error
      && Array.isArray(firstCommunityResult.data)
      && firstCommunityResult.data.length > 0
    ) {
      return firstCommunityResult.data[0].id;
    }
    return null;
  }

  const schoolProfileIds = await fetchSchoolProfileIds(supabase, schoolId);
  if (schoolProfileIds.length === 0) {
    return null;
  }

  const firstSchoolCommunityResult = await supabase
    .from('communities')
    .select('id')
    .in('creator_id', schoolProfileIds)
    .order('id', { ascending: true })
    .limit(1);
  if (!firstSchoolCommunityResult.error
    && Array.isArray(firstSchoolCommunityResult.data)
    && firstSchoolCommunityResult.data.length > 0
  ) {
    return firstSchoolCommunityResult.data[0].id;
  }

  return null;
}

async function fetchCommunityPageData(supabase, communityId, options = {}) {
  const schoolScoped = isSchoolScoped(options);
  const schoolId = options.schoolId || null;
  const communityResult = await supabase
    .from('communities')
    .select('id,name,description,creator_id,is_private,created_at')
    .eq('id', communityId)
    .maybeSingle();

  if (communityResult.error || !communityResult.data) {
    return null;
  }

  const communityRow = communityResult.data;
  const [creatorResult, memberRowsResult, postsResult] = await Promise.all([
    communityRow.creator_id
      ? supabase
          .from('profiles')
          .select('id,first_name,last_name,email,school_id')
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
  if (schoolScoped) {
    if (!schoolId || !creatorProfile || !idsMatch(creatorProfile.school_id, schoolId)) {
      return null;
    }
  }

  const rawMemberIds = (memberRowsResult.data || []).map((row) => row.user_id).filter(Boolean);
  const memberIdSet = new Set(rawMemberIds);

  if (communityRow.creator_id && !memberIdSet.has(communityRow.creator_id)) {
    memberIdSet.add(communityRow.creator_id);
  }

  return {
    community: communityRow,
    creatorProfile,
    memberIds: [...memberIdSet],
    postRows: postsResult.error || !postsResult.data ? [] : postsResult.data,
  };
}

async function fetchCommentsByPostIds(supabase, postIds) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('comments')
    .select('id,post_id,author_id,content,created_at,is_deleted')
    .eq('is_deleted', false)
    .in('post_id', postIds)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchLikeRowsByPostIds(supabase, postIds) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('reactions')
    .select('post_id')
    .eq('type', 'like')
    .in('post_id', postIds);

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchUserLikeRowsByPostIds(supabase, postIds, userId) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('reactions')
    .select('post_id')
    .eq('type', 'like')
    .eq('user_id', userId)
    .in('post_id', postIds);

  if (error || !data) {
    return [];
  }

  return data;
}

async function userCanPostInCommunity(supabase, communityId, userId) {
  const community = await fetchCommunityIdentity(supabase, communityId);
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

async function joinCommunity(supabase, userId, communityId) {
  return upsertCommunityMembership(supabase, {
    userId,
    communityId,
    role: 'member',
  });
}

async function leaveCommunity(supabase, userId, communityId) {
  const { error } = await supabase
    .from('community_members')
    .delete()
    .eq('user_id', userId)
    .eq('community_id', communityId);

  return !error;
}

async function createCommunityPost(supabase, payload) {
  const { error } = await supabase
    .from('posts')
    .insert({
      author_id: payload.authorId,
      content: payload.content,
      is_official: false,
      community_id: payload.communityId,
      course_id: null,
    });

  return !error;
}

module.exports = {
  DEFAULT_STORAGE_BUCKET,
  normalizeStoragePath,
  createSignedImageUrl,
  fetchCommunityDirectoryData,
  createCommunityRecord,
  upsertCommunityMembership,
  fetchCommunityForManage,
  updateCommunityForCreator,
  updateCommunityById,
  fetchCommunityOwnerRecord,
  deleteCommunityForCreator,
  deleteCommunityById,
  removeCommunityWithDependencies,
  fetchCommunityIdentity,
  fetchProfileById,
  fetchProfilesByIds,
  resolveCommunityId,
  fetchCommunityPageData,
  fetchCommentsByPostIds,
  fetchLikeRowsByPostIds,
  fetchUserLikeRowsByPostIds,
  userCanPostInCommunity,
  joinCommunity,
  leaveCommunity,
  createCommunityPost,
};
