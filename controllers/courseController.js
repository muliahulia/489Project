const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  buildDisplayName,
  buildInitials,
  formatCreatedAt,
} = require('../lib/utils');
const courseModel = require('../models/courseModel');

const PREVIEW_MEMBER_COUNT = 5;
const DEFAULT_DESCRIPTION = 'No description has been added for this course yet.';

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

function displayName(profile) {
  if (!profile) {
    return 'Unknown User';
  }

  return buildDisplayName(profile.first_name, profile.last_name, profile.email);
}

function buildFallbackUser(sessionUser) {
  return {
    id: sessionUser.id,
    firstName: sessionUser.firstName || null,
    lastName: sessionUser.lastName || null,
    fullName: buildDisplayName(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
    email: sessionUser.email,
    initials: buildInitials(sessionUser.firstName, sessionUser.lastName, sessionUser.email),
  };
}

function buildCurrentUserViewModel(profile, sessionUser) {
  const firstName = (profile && profile.first_name) || sessionUser.firstName || null;
  const lastName =
    profile && typeof profile.last_name === 'string'
      ? profile.last_name
      : sessionUser.lastName || null;
  const email = (profile && profile.email) || sessionUser.email;

  return {
    id: sessionUser.id,
    firstName,
    lastName,
    fullName: buildDisplayName(firstName, lastName, email),
    email,
    initials: buildInitials(firstName, lastName, email),
  };
}

function buildSafeRedirectPath(value, fallbackPath) {
  if (typeof value !== 'string') {
    return fallbackPath;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallbackPath;
  }

  return trimmed;
}

function fallbackRedirectForCourse(courseId) {
  return `/courses/${courseId}`;
}

async function buildLikeState(supabase, postIds, userId) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return {
      likeCountByPostId: new Map(),
      likedPostIds: new Set(),
    };
  }

  const [likes, userLikes] = await Promise.all([
    courseModel.fetchLikeRowsByPostIds(supabase, postIds),
    courseModel.fetchUserLikeRowsByPostIds(supabase, postIds, userId),
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

  const comments = await courseModel.fetchCommentsByPostIds(supabase, postIds);
  const authorIds = [...new Set(comments.map((comment) => comment.author_id).filter(Boolean))];
  const profiles = await courseModel.fetchProfilesByIds(supabase, authorIds);
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const commentCountByPostId = new Map();
  const commentsByPostId = new Map();

  comments.forEach((comment) => {
    const author = profileById.get(comment.author_id);
    const authorEmail = (author && author.email) || '';
    const list = commentsByPostId.get(comment.post_id) || [];

    list.push({
      id: comment.id,
      authorName: displayName(author),
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      createdAtLabel: formatCreatedAt(comment.created_at),
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

async function buildCoursePostsViewModel(supabase, course, postRows, viewerUserId) {
  if (!Array.isArray(postRows) || postRows.length === 0) {
    return [];
  }

  const postIds = postRows.map((post) => post.id).filter(Boolean);
  const authorIds = [...new Set(postRows.map((post) => post.author_id).filter(Boolean))];
  const [profiles, likeState, commentState] = await Promise.all([
    courseModel.fetchProfilesByIds(supabase, authorIds),
    buildLikeState(supabase, postIds, viewerUserId),
    buildCommentState(supabase, postIds),
  ]);
  const profileById = new Map(profiles.map((row) => [row.id, row]));

  return postRows.map((post) => {
    const author = profileById.get(post.author_id);
    const authorEmail = (author && author.email) || '';

    return {
      id: post.id,
      authorName: displayName(author),
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      createdAtLabel: formatCreatedAt(post.created_at),
      scopeLabel: course.name,
      scopeHref: `/courses/${course.id}`,
      content: post.content,
      likeCount: likeState.likeCountByPostId.get(post.id) || 0,
      liked: likeState.likedPostIds.has(post.id),
      commentCount: commentState.commentCountByPostId.get(post.id) || 0,
      comments: commentState.commentsByPostId.get(post.id) || [],
    };
  });
}

function buildMemberViewModel(profile) {
  return {
    id: profile && profile.id ? profile.id : null,
    name: displayName(profile),
    initials: buildInitials(
      profile && profile.first_name,
      profile && profile.last_name,
      profile && profile.email
    ),
  };
}

async function listCourses(req, res) {
  const sessionUser = req.session.auth.user;
  const fallbackUser = buildFallbackUser(sessionUser);

  try {
    const supabase = createSupabaseAdminClient();
    const [profile, userEnrollments] = await Promise.all([
      courseModel.fetchProfileById(supabase, sessionUser.id),
      courseModel.fetchCourseEnrollmentsForUser(supabase, sessionUser.id),
    ]);
    const user = buildCurrentUserViewModel(profile, sessionUser);
    const schoolId = profile && profile.school_id ? profile.school_id : null;
    const userEnrollmentByCourseId = new Map(
      userEnrollments.map((row) => [row.course_id, row])
    );
    const enrolledCourseIds = userEnrollments
      .map((row) => row.course_id)
      .filter(Boolean);
    const directoryCourses = schoolId
      ? await courseModel.fetchCoursesForSchool(supabase, schoolId)
      : await courseModel.fetchCoursesByIds(supabase, enrolledCourseIds);
    const courseIds = directoryCourses.map((course) => course.id).filter(Boolean);
    const creatorIds = [...new Set(directoryCourses.map((course) => course.created_by).filter(Boolean))];
    const [school, allEnrollments, creatorProfiles] = await Promise.all([
      schoolId ? courseModel.fetchSchoolById(supabase, schoolId) : Promise.resolve(null),
      courseModel.fetchCourseEnrollmentsByCourseIds(supabase, courseIds),
      courseModel.fetchProfilesByIds(supabase, creatorIds),
    ]);
    const enrollmentCountByCourseId = new Map();

    allEnrollments.forEach((enrollment) => {
      const nextCount = (enrollmentCountByCourseId.get(enrollment.course_id) || 0) + 1;
      enrollmentCountByCourseId.set(enrollment.course_id, nextCount);
    });

    const creatorById = new Map(creatorProfiles.map((row) => [row.id, row]));
    const courses = directoryCourses
      .map((course, index) => {
        const name = (course.name && String(course.name).trim()) || 'Untitled Course';
        const description =
          (course.description && String(course.description).trim()) || DEFAULT_DESCRIPTION;
        const enrollment = userEnrollmentByCourseId.get(course.id) || null;
        const isInstructor = Boolean(course.created_by && course.created_by === sessionUser.id);
        const memberCount = enrollmentCountByCourseId.get(course.id) || 0;
        const creator = creatorById.get(course.created_by);
        let membershipLabel = 'Available';

        if (isInstructor) {
          membershipLabel = 'Instructor';
        } else if (enrollment) {
          membershipLabel = 'Enrolled';
        }

        return {
          id: course.id,
          name,
          description,
          bubbleText: buildBubbleText(name),
          avatarClass: `v${(index % 7) + 1}`,
          creatorName: displayName(creator),
          memberCount,
          memberLabel: `${memberCount} ${memberCount === 1 ? 'student' : 'students'}`,
          detailHref: `/courses/${course.id}`,
          isEnrolled: Boolean(enrollment),
          isInstructor,
          membershipLabel,
        };
      })
      .sort((left, right) => {
        const leftPriority = left.isInstructor ? 2 : left.isEnrolled ? 1 : 0;
        const rightPriority = right.isInstructor ? 2 : right.isEnrolled ? 1 : 0;

        if (leftPriority !== rightPriority) {
          return rightPriority - leftPriority;
        }

        return left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
      });

    return res.render('courses', {
      user,
      schoolName: school && school.name ? school.name : null,
      courses,
      directoryMessage: schoolId
        ? null
        : 'Your profile is not linked to a school yet, so only your enrolled courses can be shown.',
    });
  } catch (_err) {
    return res.render('courses', {
      user: fallbackUser,
      schoolName: null,
      courses: [],
      directoryMessage: 'Unable to load courses right now.',
    });
  }
}

async function showCourseById(req, res) {
  const sessionUser = req.session.auth.user;
  const fallbackUser = buildFallbackUser(sessionUser);
  const courseId = toPositiveInteger(req.params.id);

  if (!courseId) {
    return res.status(404).render('course', {
      user: fallbackUser,
      course: null,
      members: [],
      memberPreview: [],
      remainingMemberCount: 0,
      posts: [],
      notFoundMessage: 'Course not found.',
      membershipMessage: null,
      formError: null,
    });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const [profile, courseRow] = await Promise.all([
      courseModel.fetchProfileById(supabase, sessionUser.id),
      courseModel.fetchCourseById(supabase, courseId),
    ]);
    const user = buildCurrentUserViewModel(profile, sessionUser);

    if (!courseRow) {
      return res.status(404).render('course', {
        user,
        course: null,
        members: [],
        memberPreview: [],
        remainingMemberCount: 0,
        posts: [],
        notFoundMessage: 'Course not found.',
        membershipMessage: null,
        formError: null,
      });
    }

    const [school, creatorProfile, enrollments] = await Promise.all([
      courseRow.school_id ? courseModel.fetchSchoolById(supabase, courseRow.school_id) : Promise.resolve(null),
      courseRow.created_by ? courseModel.fetchProfileById(supabase, courseRow.created_by) : Promise.resolve(null),
      courseModel.fetchCourseEnrollmentsByCourseIds(supabase, [courseId]),
    ]);
    const viewerEnrollment = enrollments.find((row) => row.user_id === sessionUser.id) || null;
    const viewerIsInstructor = Boolean(
      courseRow.created_by && courseRow.created_by === sessionUser.id
    );
    const canViewPosts = Boolean(viewerEnrollment || viewerIsInstructor);
    const memberIds = [...new Set(enrollments.map((row) => row.user_id).filter(Boolean))];
    const memberProfiles = await courseModel.fetchProfilesByIds(supabase, memberIds);
    const members = memberProfiles
      .map((profileRow) => buildMemberViewModel(profileRow))
      .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));
    const postRows = canViewPosts ? await courseModel.fetchCoursePosts(supabase, courseId) : [];
    const posts = canViewPosts
      ? await buildCoursePostsViewModel(
          supabase,
          { id: courseRow.id, name: courseRow.name || 'Course' },
          postRows,
          sessionUser.id
        )
      : [];
    const memberCount = members.length;
    const course = {
      id: courseRow.id,
      name: (courseRow.name && String(courseRow.name).trim()) || 'Untitled Course',
      description:
        (courseRow.description && String(courseRow.description).trim()) || DEFAULT_DESCRIPTION,
      bubbleText: buildBubbleText(courseRow.name),
      creatorName: displayName(creatorProfile),
      schoolName: school && school.name ? school.name : 'Unknown school',
      memberCount,
      memberLabel: `${memberCount} ${memberCount === 1 ? 'student' : 'students'}`,
      isEnrolled: Boolean(viewerEnrollment),
      isInstructor: viewerIsInstructor,
      canPost: canViewPosts,
    };

    return res.render('course', {
      user,
      course,
      members,
      memberPreview: members.slice(0, PREVIEW_MEMBER_COUNT),
      remainingMemberCount: Math.max(0, members.length - PREVIEW_MEMBER_COUNT),
      posts,
      notFoundMessage: null,
      membershipMessage: canViewPosts
        ? null
        : 'Join this course to view course discussion and publish posts.',
      formError: typeof req.query.error === 'string' ? req.query.error : null,
    });
  } catch (_err) {
    return res.status(500).render('course', {
      user: fallbackUser,
      course: null,
      members: [],
      memberPreview: [],
      remainingMemberCount: 0,
      posts: [],
      notFoundMessage: 'Unable to load this course right now.',
      membershipMessage: null,
      formError: null,
    });
  }
}

async function joinCourse(req, res) {
  const sessionUser = req.session.auth.user;
  const courseId = toPositiveInteger(req.params.id);

  if (!courseId) {
    return res.redirect('/courses');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const course = await courseModel.fetchCourseById(supabase, courseId);

    if (course && (!course.created_by || course.created_by !== sessionUser.id)) {
      await courseModel.upsertCourseEnrollment(supabase, {
        userId: sessionUser.id,
        courseId,
        role: 'student',
      });
    }
  } catch (_err) {
    // Ignore and redirect to the destination.
  }

  const redirectTo = buildSafeRedirectPath(
    req.body.redirectTo,
    fallbackRedirectForCourse(courseId)
  );

  return res.redirect(redirectTo);
}

async function leaveCourse(req, res) {
  const sessionUser = req.session.auth.user;
  const courseId = toPositiveInteger(req.params.id);

  if (!courseId) {
    return res.redirect('/courses');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const course = await courseModel.fetchCourseById(supabase, courseId);

    if (course && (!course.created_by || course.created_by !== sessionUser.id)) {
      await courseModel.deleteCourseEnrollment(supabase, sessionUser.id, courseId);
    }
  } catch (_err) {
    // Ignore and redirect to the destination.
  }

  const redirectTo = buildSafeRedirectPath(
    req.body.redirectTo,
    fallbackRedirectForCourse(courseId)
  );

  return res.redirect(redirectTo);
}

async function createCoursePost(req, res) {
  const sessionUser = req.session.auth.user;
  const courseId = toPositiveInteger(req.params.id);
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  const redirectBase = courseId ? `/courses/${courseId}` : '/courses';

  if (!courseId) {
    return res.redirect('/courses');
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
    const postAccess = await courseModel.userCanPostInCourse(
      supabase,
      courseId,
      sessionUser.id
    );

    if (!postAccess.exists) {
      return res.redirect('/courses');
    }

    if (!postAccess.allowed) {
      return res.redirect(
        `${redirectBase}?error=${encodeURIComponent('Join this course before posting.')}`
      );
    }

    const created = await courseModel.createCoursePost(supabase, {
      authorId: sessionUser.id,
      courseId,
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
  listCourses,
  showCourseById,
  joinCourse,
  leaveCourse,
  createCoursePost,
};
