async function fetchProfileById(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,first_name,last_name,email')
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
    .select('id,first_name,last_name,email')
    .in('id', ids);

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchCoursesByIds(supabase, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('courses')
    .select('id,name')
    .in('id', ids);

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchCommunitiesByIds(supabase, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('communities')
    .select('id,name')
    .in('id', ids);

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchVisibleFeedPosts(supabase, visibilityFilter, limit = 50) {
  const { data, error } = await supabase
    .from('posts')
    .select('id,author_id,content,is_official,community_id,course_id,created_at,is_deleted')
    .eq('is_deleted', false)
    .or(visibilityFilter)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchVisiblePostById(supabase, postId, visibilityFilter) {
  const { data, error } = await supabase
    .from('posts')
    .select('id,author_id,content,is_official,community_id,course_id,created_at,is_deleted')
    .eq('id', postId)
    .eq('is_deleted', false)
    .or(visibilityFilter)
    .maybeSingle();

  if (error || !data) {
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

async function fetchCommentsByPostIds(supabase, postIds) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return { comments: [], error: null };
  }

  const { data, error } = await supabase
    .from('comments')
    .select('id,post_id,author_id,content,created_at,is_deleted')
    .eq('is_deleted', false)
    .in('post_id', postIds)
    .order('created_at', { ascending: true });

  return {
    comments: error || !data ? [] : data,
    error,
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

module.exports = {
  fetchProfileById,
  fetchProfilesByIds,
  fetchCoursesByIds,
  fetchCommunitiesByIds,
  fetchVisibleFeedPosts,
  fetchVisiblePostById,
  createFeedPost,
  fetchLikeRowsByPostIds,
  fetchUserLikeRowsByPostIds,
  fetchCommentsByPostIds,
  fetchReactionForUserAndPost,
  deleteReactionForUserAndPost,
  upsertLikeReaction,
  countLikesForPost,
  createComment,
};
