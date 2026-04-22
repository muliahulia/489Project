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

  return data
    .map((row) => row.id)
    .filter(Boolean);
}

async function fetchSchoolEntitySets(supabase, schoolId) {
  const schoolProfileIds = await fetchSchoolProfileIds(supabase, schoolId);
  const profileIdSet = new Set(schoolProfileIds);

  const { data: courseRows, error: coursesError } = await supabase
    .from('courses')
    .select('id')
    .eq('school_id', schoolId);
  const courseIdSet = !coursesError && Array.isArray(courseRows)
    ? new Set(courseRows.map((row) => row.id).filter(Boolean))
    : new Set();

  let communityRows = [];
  if (schoolProfileIds.length > 0) {
    const communitiesResult = await supabase
      .from('communities')
      .select('id')
      .in('creator_id', schoolProfileIds);
    if (!communitiesResult.error && Array.isArray(communitiesResult.data)) {
      communityRows = communitiesResult.data;
    }
  }
  const communityIdSet = new Set(communityRows.map((row) => row.id).filter(Boolean));

  return {
    profileIdSet,
    courseIdSet,
    communityIdSet,
  };
}

function isPostVisibleByEntitySets(post, schoolEntitySets) {
  if (!post || !schoolEntitySets) {
    return false;
  }

  if (post.course_id) {
    return schoolEntitySets.courseIdSet.has(post.course_id);
  }

  if (post.community_id) {
    return schoolEntitySets.communityIdSet.has(post.community_id);
  }

  return schoolEntitySets.profileIdSet.has(post.author_id);
}

async function isPostVisibleToSchool(supabase, post, options = {}) {
  if (!post) {
    return false;
  }

  if (!isSchoolScoped(options)) {
    return true;
  }

  const schoolId = options.schoolId || null;
  if (!schoolId) {
    return false;
  }

  const schoolEntitySets = options.schoolEntitySets
    || (await fetchSchoolEntitySets(supabase, schoolId));
  return isPostVisibleByEntitySets(post, schoolEntitySets);
}

async function filterCommunityRowsBySchool(supabase, rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  if (!isSchoolScoped(options)) {
    return rows;
  }

  const schoolId = options.schoolId || null;
  if (!schoolId) {
    return [];
  }

  const creatorIds = [...new Set(rows.map((row) => row.creator_id).filter(Boolean))];
  if (creatorIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('school_id', schoolId)
    .in('id', creatorIds);

  if (error || !Array.isArray(data) || data.length === 0) {
    return [];
  }

  const allowedCreatorIds = new Set(data.map((row) => row.id));
  return rows.filter((row) => allowedCreatorIds.has(row.creator_id));
}

async function fetchProfileById(supabase, userId, options = {}) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  if (!isSchoolScoped(options)) {
    return data;
  }

  const schoolId = options.schoolId || null;
  const viewerUserId = options.viewerUserId || null;
  if (viewerUserId && idsMatch(viewerUserId, data.id)) {
    return data;
  }

  if (!schoolId || !data.school_id || !idsMatch(schoolId, data.school_id)) {
    return null;
  }

  return data;
}

async function fetchProfilesByIds(supabase, ids, options = {}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  let request = supabase
    .from('profiles')
    .select('*')
    .in('id', ids);

  if (isSchoolScoped(options)) {
    const schoolId = options.schoolId || null;
    if (!schoolId) {
      return [];
    }
    request = request.eq('school_id', schoolId);
  }

  const { data, error } = await request;

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchCoursesByIds(supabase, ids, options = {}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  let request = supabase
    .from('courses')
    .select('id,name,school_id')
    .in('id', ids);

  if (isSchoolScoped(options)) {
    const schoolId = options.schoolId || null;
    if (!schoolId) {
      return [];
    }
    request = request.eq('school_id', schoolId);
  }

  const { data, error } = await request;

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

async function fetchCommunitiesByIds(supabase, ids, options = {}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('communities')
    .select('id,name,creator_id')
    .in('id', ids);

  if (error || !data) {
    return [];
  }

  const filteredRows = await filterCommunityRowsBySchool(supabase, data, options);
  return filteredRows.map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

async function fetchGlobalFeedPosts(supabase, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 10;
  const offset = Number.isInteger(options.offset) && options.offset >= 0 ? options.offset : 0;
  const rangeEnd = offset + (limit * 5);
  let schoolEntitySets = null;
  let request = supabase
    .from('posts')
    .select('id,author_id,content,image_url,is_official,community_id,course_id,created_at,is_deleted')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (isSchoolScoped(options)) {
    const schoolId = options.schoolId || null;
    if (!schoolId) {
      return {
        rows: [],
        hasMore: false,
      };
    }

    schoolEntitySets = await fetchSchoolEntitySets(supabase, schoolId);
    const schoolProfileIds = [...schoolEntitySets.profileIdSet];
    if (schoolProfileIds.length === 0) {
      return {
        rows: [],
        hasMore: false,
      };
    }

    request = request.in('author_id', schoolProfileIds);
  }

  const { data, error } = await request.range(offset, rangeEnd);

  if (error || !data) {
    return {
      rows: [],
      hasMore: false,
    };
  }

  const scopedRows = isSchoolScoped(options)
    ? data.filter((post) => isPostVisibleByEntitySets(post, schoolEntitySets))
    : data;
  const hasMore = scopedRows.length > limit;
  return {
    rows: hasMore ? scopedRows.slice(0, limit) : scopedRows,
    hasMore,
  };
}

async function fetchGlobalPostsByAuthorId(supabase, authorId, options = {}) {
  if (!authorId) {
    return [];
  }

  let schoolEntitySets = options.schoolEntitySets || null;
  if (isSchoolScoped(options)) {
    const schoolId = options.schoolId || null;
    if (!schoolId) {
      return [];
    }
    schoolEntitySets = schoolEntitySets || (await fetchSchoolEntitySets(supabase, schoolId));
    if (!schoolEntitySets.profileIdSet.has(authorId)) {
      return [];
    }
  }

  const { data, error } = await supabase
    .from('posts')
    .select('id,author_id,content,image_url,is_official,community_id,course_id,created_at,is_deleted')
    .eq('author_id', authorId)
    .eq('is_deleted', false)
    .is('community_id', null)
    .is('course_id', null)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  if (isSchoolScoped(options)) {
    return data.filter((post) => isPostVisibleByEntitySets(post, schoolEntitySets));
  }

  return data;
}

async function fetchVisiblePostById(supabase, postId, visibilityFilter, options = {}) {
  const { data, error } = await supabase
    .from('posts')
    .select('id,author_id,content,image_url,is_official,community_id,course_id,created_at,is_deleted')
    .eq('id', postId)
    .eq('is_deleted', false)
    .or(visibilityFilter)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  if (!(await isPostVisibleToSchool(supabase, data, options))) {
    return null;
  }

  return data;
}

async function fetchActivePostById(supabase, postId, options = {}) {
  const { data, error } = await supabase
    .from('posts')
    .select('id,author_id,content,image_url,is_official,community_id,course_id,created_at,is_deleted')
    .eq('id', postId)
    .eq('is_deleted', false)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  if (!(await isPostVisibleToSchool(supabase, data, options))) {
    return null;
  }

  return data;
}

async function createFeedPost(supabase, payload) {
  const { error } = await supabase
    .from('posts')
    .insert({
      author_id: payload.authorId,
      content: payload.content,
      is_official: false,
      course_id: null,
      community_id: null,
    });

  return !error;
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

async function fetchCommentsByPostIds(supabase, postIds, options = {}) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return { comments: [], error: null };
  }

  const { data, error } = await supabase
    .from('comments')
    .select('id,post_id,author_id,content,created_at,is_deleted')
    .eq('is_deleted', false)
    .in('post_id', postIds)
    .order('created_at', { ascending: true });

  if (error || !Array.isArray(data)) {
    return {
      comments: [],
      error,
    };
  }

  if (!isSchoolScoped(options)) {
    return {
      comments: data,
      error: null,
    };
  }

  const schoolId = options.schoolId || null;
  if (!schoolId) {
    return {
      comments: [],
      error: null,
    };
  }

  const authorIds = [...new Set(data.map((comment) => comment.author_id).filter(Boolean))];
  if (authorIds.length === 0) {
    return {
      comments: [],
      error: null,
    };
  }

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('school_id', schoolId)
    .in('id', authorIds);

  if (profileError || !Array.isArray(profileRows)) {
    return {
      comments: [],
      error: profileError,
    };
  }

  const allowedAuthorIds = new Set(profileRows.map((row) => row.id));
  return {
    comments: data.filter((comment) => allowedAuthorIds.has(comment.author_id)),
    error: null,
  };
}

async function fetchReactionForUserAndPost(supabase, userId, postId) {
  const { data, error } = await supabase
    .from('reactions')
    .select('user_id,post_id,type')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();

  return {
    reaction: data || null,
    error,
  };
}

async function deleteReactionForUserAndPost(supabase, userId, postId) {
  const { error } = await supabase
    .from('reactions')
    .delete()
    .eq('user_id', userId)
    .eq('post_id', postId);

  return !error;
}

async function upsertLikeReaction(supabase, userId, postId) {
  const { error } = await supabase
    .from('reactions')
    .upsert(
      [{ user_id: userId, post_id: postId, type: 'like' }],
      { onConflict: 'user_id,post_id' }
    );

  return !error;
}

async function countLikesForPost(supabase, postId) {
  const { count, error } = await supabase
    .from('reactions')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId)
    .eq('type', 'like');

  if (error) {
    return null;
  }

  return count || 0;
}

async function createComment(supabase, payload) {
  const { error } = await supabase
    .from('comments')
    .insert({
      post_id: payload.postId,
      author_id: payload.authorId,
      content: payload.content,
      is_deleted: false,
    });

  return !error;
}

async function fetchPostReportByReporterAndPost(supabase, reporterId, postId) {
  const { data, error } = await supabase
    .from('post_reports')
    .select('id,status,created_at')
    .eq('reporter_id', reporterId)
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function reportPost(supabase, payload) {
  const { data, error } = await supabase
    .from('post_reports')
    .insert({
      post_id: payload.postId,
      reporter_id: payload.reporterId,
      reason: payload.reason,
    })
    .select('id,status')
    .maybeSingle();

  return {
    report: data || null,
    error: error || null,
  };
}

async function deletePost(supabase, postId) {
  const { error } = await supabase
    .from('posts')
    .update({ is_deleted: true })
    .eq('id', postId);

  return !error;
}

async function fetchPostById(supabase, postId, options = {}) {
  const { data, error } = await supabase
    .from('posts')
    .select('id,author_id,content,is_deleted')
    .eq('id', postId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  if (!(await isPostVisibleToSchool(supabase, data, options))) {
    return null;
  }

  return data;
}

async function createFeedPostWithImage(supabase, payload) {
  const { error } = await supabase
    .from('posts')
    .insert({
      author_id: payload.authorId,
      content: payload.content,
      image_url: payload.imageUrl || null,
      is_official: false,
      course_id: null,
      community_id: null,
    });

  if (error) {
    console.error('CREATE POST DB ERROR:', error);
  }

  return !error;
}

module.exports = {
  fetchProfileById,
  fetchProfilesByIds,
  fetchCoursesByIds,
  fetchCommunitiesByIds,
  fetchGlobalFeedPosts,
  fetchGlobalPostsByAuthorId,
  fetchVisiblePostById,
  fetchActivePostById,
  createFeedPost,
  createFeedPostWithImage,
  fetchPostById,
  fetchLikeRowsByPostIds,
  fetchUserLikeRowsByPostIds,
  fetchCommentsByPostIds,
  fetchReactionForUserAndPost,
  deleteReactionForUserAndPost,
  upsertLikeReaction,
  countLikesForPost,
  createComment,
  fetchPostReportByReporterAndPost,
  reportPost,
  deletePost,
};
