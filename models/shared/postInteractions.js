function hasPostIds(postIds) {
  return Array.isArray(postIds) && postIds.length > 0;
}

async function fetchLikeRowsByPostIds(supabase, postIds) {
  if (!hasPostIds(postIds)) {
    return [];
  }

  const { data, error } = await supabase
    .from('reactions')
    .select('post_id')
    .eq('type', 'like')
    .in('post_id', postIds);

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data;
}

async function fetchUserLikeRowsByPostIds(supabase, postIds, userId) {
  if (!hasPostIds(postIds)) {
    return [];
  }

  const { data, error } = await supabase
    .from('reactions')
    .select('post_id')
    .eq('type', 'like')
    .eq('user_id', userId)
    .in('post_id', postIds);

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data;
}

async function fetchCommentRowsByPostIds(supabase, postIds) {
  if (!hasPostIds(postIds)) {
    return {
      rows: [],
      error: null,
    };
  }

  const { data, error } = await supabase
    .from('comments')
    .select('id,post_id,author_id,content,created_at,is_deleted')
    .eq('is_deleted', false)
    .in('post_id', postIds)
    .order('created_at', { ascending: true });

  return {
    rows: Array.isArray(data) ? data : [],
    error: error || null,
  };
}

module.exports = {
  fetchLikeRowsByPostIds,
  fetchUserLikeRowsByPostIds,
  fetchCommentRowsByPostIds,
};
