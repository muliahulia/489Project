const { buildDisplayName, buildInitials } = require('./utils');

function emptyLikeState() {
  return {
    likeCountByPostId: new Map(),
    likedPostIds: new Set(),
  };
}

function emptyCommentState() {
  return {
    commentCountByPostId: new Map(),
    commentsByPostId: new Map(),
  };
}

async function fetchLikeState(options = {}) {
  const {
    postIds,
    userId,
    fetchLikeRows,
    fetchUserLikeRows,
    skipUserLikesWithoutUserId,
  } = options;

  if (!Array.isArray(postIds) || postIds.length === 0) {
    return emptyLikeState();
  }

  const likesPromise = typeof fetchLikeRows === 'function'
    ? fetchLikeRows(postIds)
    : Promise.resolve([]);

  const shouldFetchUserLikes =
    typeof fetchUserLikeRows === 'function'
    && !(skipUserLikesWithoutUserId && !userId);

  const userLikesPromise = shouldFetchUserLikes
    ? fetchUserLikeRows(postIds, userId)
    : Promise.resolve([]);

  const [likes, userLikes] = await Promise.all([likesPromise, userLikesPromise]);
  const likeCountByPostId = new Map();

  (Array.isArray(likes) ? likes : []).forEach((row) => {
    if (!row || !row.post_id) {
      return;
    }

    const count = likeCountByPostId.get(row.post_id) || 0;
    likeCountByPostId.set(row.post_id, count + 1);
  });

  return {
    likeCountByPostId,
    likedPostIds: new Set(
      (Array.isArray(userLikes) ? userLikes : [])
        .map((row) => row && row.post_id)
        .filter(Boolean)
    ),
  };
}

function buildCommentCollections(options = {}) {
  const {
    comments,
    profiles,
    profileMediaById,
    formatDateLabel,
    skipUnknownAuthors,
  } = options;

  const safeComments = Array.isArray(comments) ? comments : [];
  const safeProfiles = Array.isArray(profiles) ? profiles : [];
  const mediaById = profileMediaById instanceof Map ? profileMediaById : new Map();
  const shouldSkipUnknownAuthors = Boolean(skipUnknownAuthors);

  if (safeComments.length === 0) {
    return emptyCommentState();
  }

  const profileById = new Map(safeProfiles.map((row) => [row.id, row]));
  const commentCountByPostId = new Map();
  const commentsByPostId = new Map();

  safeComments.forEach((comment) => {
    if (!comment || !comment.post_id) {
      return;
    }

    const author = profileById.get(comment.author_id);
    if (!author && shouldSkipUnknownAuthors) {
      return;
    }

    const authorEmail = (author && author.email) || '';
    const authorMedia = mediaById.get(comment.author_id);
    const list = commentsByPostId.get(comment.post_id) || [];

    list.push({
      id: comment.id,
      authorName: buildDisplayName(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      authorAvatarUrl: authorMedia && authorMedia.avatarUrl ? authorMedia.avatarUrl : null,
      createdAtLabel:
        typeof formatDateLabel === 'function'
          ? formatDateLabel(comment.created_at)
          : comment.created_at,
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

module.exports = {
  emptyLikeState,
  emptyCommentState,
  fetchLikeState,
  buildCommentCollections,
};
