var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  buildDisplayName,
  buildInitials,
  formatCreatedAt,
  buildPostScopeFilter,
  fetchAffiliations,
} = require('../lib/utils');

router.get('/', (req, res) => {
  return res.redirect('/feed');
});

router.get('/:id', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const postId = Number.parseInt(req.params.id, 10);

  const fallbackUser = {
    id: sessionUser.id,
    firstName: sessionUser.firstName || null,
    lastName: sessionUser.lastName || null,
    fullName: buildDisplayName(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
    email: sessionUser.email,
    initials: buildInitials(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
  };

  if (!Number.isInteger(postId) || postId <= 0) {
    return res.status(404).render('post', {
      user: fallbackUser,
      post: null,
      courses: [],
      communities: [],
      notFoundMessage: 'Post does not exist.',
    });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const affiliations = await fetchAffiliations(supabase, sessionUser.id);
    const visibilityFilter = buildPostScopeFilter(
      affiliations.courseIds,
      affiliations.communityIds,
      sessionUser.id
    );

    const { data: rawPost, error: postError } = await supabase
      .from('posts')
      .select('id,author_id,content,is_official,community_id,course_id,created_at,is_deleted')
      .eq('id', postId)
      .eq('is_deleted', false)
      .or(visibilityFilter)
      .maybeSingle();

    if (postError || !rawPost) {
      return res.status(404).render('post', {
        user: fallbackUser,
        post: null,
        courses: affiliations.courses,
        communities: affiliations.communities,
        notFoundMessage: 'Post does not exist.',
      });
    }

    const [authorProfileResult, courseResult, communityResult, currentProfileResult, likesResult, userLikeResult, commentsResult] = await Promise.all([
      supabase.from('profiles').select('id,first_name,last_name,email').eq('id', rawPost.author_id).maybeSingle(),
      rawPost.course_id
        ? supabase.from('courses').select('id,name').eq('id', rawPost.course_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      rawPost.community_id
        ? supabase.from('communities').select('id,name').eq('id', rawPost.community_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('profiles').select('id,first_name,last_name,email').eq('id', sessionUser.id).maybeSingle(),
      supabase.from('reactions').select('post_id').eq('type', 'like').eq('post_id', postId),
      supabase
        .from('reactions')
        .select('post_id')
        .eq('type', 'like')
        .eq('post_id', postId)
        .eq('user_id', sessionUser.id)
        .maybeSingle(),
      supabase
        .from('comments')
        .select('id,post_id,author_id,content,created_at,is_deleted')
        .eq('post_id', postId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true }),
    ]);

    const comments = commentsResult.data || [];
    const commentAuthorIds = [...new Set(comments.map((comment) => comment.author_id).filter(Boolean))];
    const commentProfilesResult = commentAuthorIds.length > 0
      ? await supabase.from('profiles').select('id,first_name,last_name,email').in('id', commentAuthorIds)
      : { data: [], error: null };

    const commentProfileById = new Map((commentProfilesResult.data || []).map((row) => [row.id, row]));

    const author = authorProfileResult.data;
    const authorName = buildDisplayName(
      author && author.first_name,
      author && author.last_name,
      author && author.email
    );
    const authorEmail = (author && author.email) || '';

    let scopeLabel = 'General';
    let scopeHref = '#';

    if (communityResult.data) {
      scopeLabel = communityResult.data.name;
      scopeHref = '/communities';
    } else if (courseResult.data) {
      scopeLabel = courseResult.data.name;
      scopeHref = '/courses';
    }

    const post = {
      id: rawPost.id,
      authorName,
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      createdAtLabel: formatCreatedAt(rawPost.created_at),
      scopeLabel,
      scopeHref,
      content: rawPost.content,
      likeCount: (likesResult.data || []).length,
      liked: Boolean(userLikeResult.data),
      commentCount: comments.length,
      comments: comments.map((comment) => {
        const commentAuthor = commentProfileById.get(comment.author_id);
        const commentAuthorName = buildDisplayName(
          commentAuthor && commentAuthor.first_name,
          commentAuthor && commentAuthor.last_name,
          commentAuthor && commentAuthor.email
        );
        const commentAuthorEmail = (commentAuthor && commentAuthor.email) || '';

        return {
          id: comment.id,
          authorName: commentAuthorName,
          authorInitials: buildInitials(
            commentAuthor && commentAuthor.first_name,
            commentAuthor && commentAuthor.last_name,
            commentAuthorEmail
          ),
          createdAtLabel: formatCreatedAt(comment.created_at),
          content: comment.content,
        };
      }),
    };

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

    return res.render('post', {
      user,
      post,
      courses: affiliations.courses,
      communities: affiliations.communities,
      notFoundMessage: null,
    });
  } catch (_err) {
    return res.status(500).render('error', {
      message: 'Unable to load this post right now.',
      error: req.app.get('env') === 'development' ? _err : {},
    });
  }
});

module.exports = router;
