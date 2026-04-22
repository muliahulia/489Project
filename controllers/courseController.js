const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  buildDisplayName,
  buildInitials,
  buildProfilePath,
  formatCreatedAt,
} = require('../lib/utils');
const { resolveProfileMedia, resolveProfileMediaMap } = require('../lib/profileMedia');
const courseModel = require('../models/courseModel');

const PREVIEW_MEMBER_COUNT = 5;
const DEFAULT_DESCRIPTION = 'No description has been added for this course yet.';
const DEFAULT_INSTRUCTOR = 'Instructor TBD';
const MAX_COURSE_NAME_LENGTH = 120;
const MAX_COURSE_DESCRIPTION_LENGTH = 1000;
const MAX_COURSE_PREFIX_LENGTH = 16;
const MAX_COURSE_NUMBER = 32767;
const MAX_INSTRUCTOR_LENGTH = 120;

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
    profileAvatarUrl: sessionUser.profileAvatarUrl || null,
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
    profileAvatarUrl:
      (profile && profile.profileAvatarUrl) || sessionUser.profileAvatarUrl || null,
  };
}

function buildAccessProfile(profile, sessionUser) {
  if (profile) {
    return profile;
  }

  return {
    id: sessionUser.id,
    role: sessionUser.role || 'student',
    school_id: sessionUser.schoolId || null,
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

function normalizeRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

function idsMatch(left, right) {
  if (!left || !right) {
    return false;
  }
  return String(left) === String(right);
}

function normalizeCoursePayload(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const instructorName =
    typeof body.instructor_name === 'string' ? body.instructor_name.trim() : '';
  const coursePrefix =
    typeof body.course_prefix === 'string' ? body.course_prefix.trim().toUpperCase() : '';
  const rawCourseNumber =
    typeof body.course_number === 'string' ? body.course_number.trim() : '';
  const courseNumber = rawCourseNumber === '' ? null : Number.parseInt(rawCourseNumber, 10);

  return {
    name,
    description,
    instructorName,
    coursePrefix,
    rawCourseNumber,
    courseNumber,
  };
}

function buildCourseCreationAccess(profile) {
  const role = normalizeRole(profile && profile.role);
  const schoolId = profile && profile.school_id ? profile.school_id : null;

  if (role !== 'official' && role !== 'admin') {
    return {
      allowed: false,
      schoolId,
      reason: 'Only school officials and admins can create courses.',
    };
  }

  if (!schoolId) {
    return {
      allowed: false,
      schoolId: null,
      reason: 'Your account must be linked to a school before you can create courses.',
    };
  }

  return {
    allowed: true,
    schoolId,
    reason: null,
  };
}

function buildCourseManageAccess(profile, course) {
  const role = normalizeRole(profile && profile.role);
  const profileId = profile && profile.id ? profile.id : null;
  const profileSchoolId = profile && profile.school_id ? profile.school_id : null;
  const courseSchoolId = course && course.school_id ? course.school_id : null;
  const isCreator = Boolean(
    course && course.created_by && profileId && course.created_by === profileId
  );

  if (role === 'admin') {
    return {
      allowed: true,
      reason: null,
    };
  }

  if (role === 'official' && idsMatch(profileSchoolId, courseSchoolId)) {
    return {
      allowed: true,
      reason: null,
    };
  }

  if (isCreator) {
    return {
      allowed: true,
      reason: null,
    };
  }

  return {
    allowed: false,
    reason: 'You do not have permission to manage this course.',
  };
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
  const profileMediaById = await resolveProfileMediaMap(supabase, profiles);
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const commentCountByPostId = new Map();
  const commentsByPostId = new Map();

  comments.forEach((comment) => {
    const author = profileById.get(comment.author_id);
    const authorEmail = (author && author.email) || '';
    const authorMedia = profileMediaById.get(comment.author_id);
    const list = commentsByPostId.get(comment.post_id) || [];

    list.push({
      id: comment.id,
      authorName: displayName(author),
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      authorAvatarUrl: authorMedia && authorMedia.avatarUrl ? authorMedia.avatarUrl : null,
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
  const profileMediaById = await resolveProfileMediaMap(supabase, profiles);
  const profileById = new Map(profiles.map((row) => [row.id, row]));

  return postRows.map((post) => {
    const author = profileById.get(post.author_id);
    const authorEmail = (author && author.email) || '';
    const authorMedia = profileMediaById.get(post.author_id);
    const normalizedAuthorRole =
      author && typeof author.role === 'string' ? author.role.trim().toLowerCase() : '';
    let authorRoleLabel = null;
    if (normalizedAuthorRole === 'admin') {
      authorRoleLabel = 'UniConnect Admin';
    } else if (normalizedAuthorRole === 'official') {
      authorRoleLabel = 'School Official';
    }

    return {
      id: post.id,
      authorId: post.author_id,
      authorProfileHref: buildProfilePath(
        post.author_id,
        author && author.first_name,
        author && author.last_name
      ),
      authorName: displayName(author),
      authorRole: normalizedAuthorRole,
      authorRoleLabel,
      authorInitials: buildInitials(
        author && author.first_name,
        author && author.last_name,
        authorEmail
      ),
      authorAvatarUrl: authorMedia && authorMedia.avatarUrl ? authorMedia.avatarUrl : null,
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
    profileHref: buildProfilePath(
      profile && profile.id,
      profile && profile.first_name,
      profile && profile.last_name
    ),
    profileAvatarUrl: profile && profile.profileAvatarUrl ? profile.profileAvatarUrl : null,
    initials: buildInitials(
      profile && profile.first_name,
      profile && profile.last_name,
      profile && profile.email
    ),
  };
}

function compareCoursesByName(left, right) {
  return left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
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
    const profileMedia = profile ? await resolveProfileMedia(supabase, profile) : null;
    if (profile) {
      profile.profileAvatarUrl = profileMedia && profileMedia.avatarUrl ? profileMedia.avatarUrl : null;
    }
    const user = buildCurrentUserViewModel(profile, sessionUser);
    const accessProfile = buildAccessProfile(profile, sessionUser);
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
    const [school, allEnrollments] = await Promise.all([
      schoolId ? courseModel.fetchSchoolById(supabase, schoolId) : Promise.resolve(null),
      courseModel.fetchCourseEnrollmentsByCourseIds(supabase, courseIds),
    ]);
    const enrollmentCountByCourseId = new Map();

    allEnrollments.forEach((enrollment) => {
      const nextCount = (enrollmentCountByCourseId.get(enrollment.course_id) || 0) + 1;
      enrollmentCountByCourseId.set(enrollment.course_id, nextCount);
    });

    const courseCards = directoryCourses.map((course, index) => {
        const name = (course.name && String(course.name).trim()) || 'Untitled Course';
        const description =
          (course.description && String(course.description).trim()) || DEFAULT_DESCRIPTION;
        const instructorName =
          (course.instructor_name && String(course.instructor_name).trim()) || DEFAULT_INSTRUCTOR;
        const enrollment = userEnrollmentByCourseId.get(course.id) || null;
        const isInstructor = Boolean(course.created_by && course.created_by === sessionUser.id);
        const memberCount = enrollmentCountByCourseId.get(course.id) || 0;
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
          instructorName,
          bubbleText: buildBubbleText(name),
          avatarClass: `v${(index % 7) + 1}`,
          memberCount,
          memberLabel: `${memberCount} ${memberCount === 1 ? 'student' : 'students'}`,
          detailHref: `/courses/${course.id}`,
          manageHref: `/courses/manage/${course.id}`,
          isEnrolled: Boolean(enrollment),
          isInstructor,
          canManage: buildCourseManageAccess(accessProfile, course).allowed,
          membershipLabel,
        };
      });

    const myCourses = courseCards
      .filter((course) => course.isInstructor || course.isEnrolled)
      .sort((left, right) => {
        const leftPriority = left.isInstructor ? 1 : 0;
        const rightPriority = right.isInstructor ? 1 : 0;

        if (leftPriority !== rightPriority) {
          return rightPriority - leftPriority;
        }

        return compareCoursesByName(left, right);
      });

    const availableCourses = courseCards
      .filter((course) => !course.isInstructor && !course.isEnrolled)
      .sort(compareCoursesByName);

    return res.render('courses', {
      user,
      schoolName: school && school.name ? school.name : null,
      myCourses,
      availableCourses,
      canCreateCourse: buildCourseCreationAccess(accessProfile).allowed,
      pageError: typeof req.query.error === 'string' ? req.query.error : null,
      directoryMessage: schoolId
        ? null
        : 'Your profile is not linked to a school yet, so only your enrolled courses can be shown.',
    });
  } catch (_err) {
    return res.render('courses', {
      user: fallbackUser,
      schoolName: null,
      myCourses: [],
      availableCourses: [],
      canCreateCourse: false,
      pageError: typeof req.query.error === 'string' ? req.query.error : null,
      directoryMessage: 'Unable to load courses right now.',
    });
  }
}

async function showCreateCourse(req, res) {
  const sessionUser = req.session.auth.user;
  const fallbackUser = buildFallbackUser(sessionUser);

  try {
    const supabase = createSupabaseAdminClient();
    const profile = await courseModel.fetchProfileById(supabase, sessionUser.id);
    const user = buildCurrentUserViewModel(profile, sessionUser);
    const creationAccess = buildCourseCreationAccess(buildAccessProfile(profile, sessionUser));

    if (!creationAccess.allowed) {
      return res.redirect(
        `/courses?error=${encodeURIComponent(creationAccess.reason || 'You do not have access to create courses.')}`
      );
    }

    const school = await courseModel.fetchSchoolById(supabase, creationAccess.schoolId);

    return res.render('create-course', {
      user,
      schoolName: school && school.name ? school.name : 'Your school',
      formError: typeof req.query.error === 'string' ? req.query.error : null,
      formValues: {
        name: typeof req.query.name === 'string' ? req.query.name : '',
        description: typeof req.query.description === 'string' ? req.query.description : '',
        instructorName:
          typeof req.query.instructor_name === 'string' ? req.query.instructor_name : '',
        coursePrefix:
          typeof req.query.course_prefix === 'string' ? req.query.course_prefix : '',
        courseNumber:
          typeof req.query.course_number === 'string' ? req.query.course_number : '',
      },
    });
  } catch (_err) {
    return res.status(500).render('create-course', {
      user: fallbackUser,
      schoolName: 'Your school',
      formError: 'Unable to load the create course form right now.',
      formValues: {
        name: '',
        description: '',
        instructorName: '',
        coursePrefix: '',
        courseNumber: '',
      },
    });
  }
}

async function showManageCourse(req, res) {
  const sessionUser = req.session.auth.user;
  const fallbackUser = buildFallbackUser(sessionUser);
  const courseId = toPositiveInteger(req.params.id);

  if (!courseId) {
    return res.redirect('/courses');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const [profile, course] = await Promise.all([
      courseModel.fetchProfileById(supabase, sessionUser.id),
      courseModel.fetchCourseById(supabase, courseId),
    ]);

    if (!course) {
      return res.redirect('/courses');
    }

    const manageAccess = buildCourseManageAccess(
      buildAccessProfile(profile, sessionUser),
      course
    );
    if (!manageAccess.allowed) {
      return res.redirect(
        `/courses/${courseId}?error=${encodeURIComponent(manageAccess.reason)}`
      );
    }

    const [user, school] = await Promise.all([
      Promise.resolve(buildCurrentUserViewModel(profile, sessionUser)),
      course.school_id ? courseModel.fetchSchoolById(supabase, course.school_id) : Promise.resolve(null),
    ]);

    return res.render('manage-course', {
      user,
      courseId: course.id,
      courseName:
        typeof req.query.name === 'string'
          ? req.query.name
          : (course.name && String(course.name).trim()) || 'Untitled Course',
      courseDescription:
        typeof req.query.description === 'string'
          ? req.query.description
          : typeof course.description === 'string'
            ? course.description
            : '',
      coursePrefix:
        typeof req.query.course_prefix === 'string'
          ? req.query.course_prefix
          : typeof course.course_prefix === 'string'
            ? course.course_prefix
            : '',
      courseNumber:
        typeof req.query.course_number === 'string'
          ? req.query.course_number
          : typeof course.course_number === 'number'
            ? String(course.course_number)
            : '',
      instructorName:
        typeof req.query.instructor_name === 'string'
          ? req.query.instructor_name
          : typeof course.instructor_name === 'string'
            ? course.instructor_name
            : '',
      schoolName: school && school.name ? school.name : 'Unknown school',
      formError: typeof req.query.error === 'string' ? req.query.error : null,
      formSuccess: typeof req.query.success === 'string' ? req.query.success : null,
    });
  } catch (_err) {
    return res.status(500).render('manage-course', {
      user: fallbackUser,
      courseId,
      courseName: 'Untitled Course',
      courseDescription: '',
      coursePrefix: '',
      courseNumber: '',
      instructorName: '',
      schoolName: 'Unknown school',
      formError: 'Unable to load the manage course form right now.',
      formSuccess: null,
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
    const profileMedia = profile ? await resolveProfileMedia(supabase, profile) : null;
    if (profile) {
      profile.profileAvatarUrl = profileMedia && profileMedia.avatarUrl ? profileMedia.avatarUrl : null;
    }
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

    const [school, enrollments] = await Promise.all([
      courseRow.school_id ? courseModel.fetchSchoolById(supabase, courseRow.school_id) : Promise.resolve(null),
      courseModel.fetchCourseEnrollmentsByCourseIds(supabase, [courseId]),
    ]);
    const viewerEnrollment = enrollments.find((row) => row.user_id === sessionUser.id) || null;
    const viewerIsInstructor = Boolean(
      courseRow.created_by && courseRow.created_by === sessionUser.id
    );
    const canViewPosts = Boolean(viewerEnrollment || viewerIsInstructor);
    const memberIds = [...new Set(enrollments.map((row) => row.user_id).filter(Boolean))];
    const memberProfiles = await courseModel.fetchProfilesByIds(supabase, memberIds);
    const memberMediaById = await resolveProfileMediaMap(supabase, memberProfiles);
    memberProfiles.forEach((memberProfile) => {
      memberProfile.profileAvatarUrl = memberMediaById.get(memberProfile.id)?.avatarUrl || null;
    });
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
      instructorName:
        (courseRow.instructor_name && String(courseRow.instructor_name).trim()) || DEFAULT_INSTRUCTOR,
      bubbleText: buildBubbleText(courseRow.name),
      schoolName: school && school.name ? school.name : 'Unknown school',
      memberCount,
      memberLabel: `${memberCount} ${memberCount === 1 ? 'student' : 'students'}`,
      isEnrolled: Boolean(viewerEnrollment),
      isInstructor: viewerIsInstructor,
      canManage: buildCourseManageAccess(buildAccessProfile(profile, sessionUser), courseRow).allowed,
      manageHref: `/courses/manage/${courseRow.id}`,
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

async function createCourse(req, res) {
  const sessionUser = req.session.auth.user;
  const { name, description, instructorName, coursePrefix, rawCourseNumber, courseNumber } = normalizeCoursePayload(req.body);
  const redirectSuffix =
    `&name=${encodeURIComponent(name)}&description=${encodeURIComponent(description)}&instructor_name=${encodeURIComponent(instructorName)}&course_prefix=${encodeURIComponent(coursePrefix)}&course_number=${encodeURIComponent(rawCourseNumber)}`;

  if (!name) {
    return res.redirect(
      `/courses/create?error=${encodeURIComponent('Course name is required.')}${redirectSuffix}`
    );
  }

  if (name.length > MAX_COURSE_NAME_LENGTH) {
    return res.redirect(
      `/courses/create?error=${encodeURIComponent(`Course name is too long (max ${MAX_COURSE_NAME_LENGTH} characters).`)}${redirectSuffix}`
    );
  }

  if (description.length > MAX_COURSE_DESCRIPTION_LENGTH) {
    return res.redirect(
      `/courses/create?error=${encodeURIComponent(`Course description is too long (max ${MAX_COURSE_DESCRIPTION_LENGTH} characters).`)}${redirectSuffix}`
    );
  }

  if (!instructorName) {
    return res.redirect(
      `/courses/create?error=${encodeURIComponent('Instructor name is required.')}${redirectSuffix}`
    );
  }

  if (instructorName.length > MAX_INSTRUCTOR_LENGTH) {
    return res.redirect(
      `/courses/create?error=${encodeURIComponent(`Instructor name is too long (max ${MAX_INSTRUCTOR_LENGTH} characters).`)}${redirectSuffix}`
    );
  }

  if (coursePrefix.length > MAX_COURSE_PREFIX_LENGTH) {
    return res.redirect(
      `/courses/create?error=${encodeURIComponent(`Course prefix is too long (max ${MAX_COURSE_PREFIX_LENGTH} characters).`)}${redirectSuffix}`
    );
  }

  if (rawCourseNumber && (!Number.isInteger(courseNumber) || courseNumber < 0 || courseNumber > MAX_COURSE_NUMBER)) {
    return res.redirect(
      `/courses/create?error=${encodeURIComponent(`Course number must be a whole number between 0 and ${MAX_COURSE_NUMBER}.`)}${redirectSuffix}`
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const profile = await courseModel.fetchProfileById(supabase, sessionUser.id);
    const creationAccess = buildCourseCreationAccess(buildAccessProfile(profile, sessionUser));

    if (!creationAccess.allowed) {
      return res.redirect(
        `/courses?error=${encodeURIComponent(creationAccess.reason || 'You do not have access to create courses.')}`
      );
    }

    const createdCourse = await courseModel.createCourseRecord(supabase, {
      schoolId: creationAccess.schoolId,
      name,
      description,
      instructorName,
      coursePrefix: coursePrefix || null,
      courseNumber,
      creatorId: sessionUser.id,
    });

    if (!createdCourse) {
      return res.redirect(
        `/courses/create?error=${encodeURIComponent('Unable to create course right now.')}${redirectSuffix}`
      );
    }

    return res.redirect(`/courses/${createdCourse.id}`);
  } catch (_err) {
    return res.redirect(
      `/courses/create?error=${encodeURIComponent('Unable to create course right now.')}${redirectSuffix}`
    );
  }
}

async function updateCourse(req, res) {
  const sessionUser = req.session.auth.user;
  const courseId = toPositiveInteger(req.params.id);
  const { name, description, instructorName, coursePrefix, rawCourseNumber, courseNumber } =
    normalizeCoursePayload(req.body);
  const redirectSuffix =
    `&name=${encodeURIComponent(name)}&description=${encodeURIComponent(description)}&instructor_name=${encodeURIComponent(instructorName)}&course_prefix=${encodeURIComponent(coursePrefix)}&course_number=${encodeURIComponent(rawCourseNumber)}`;

  if (!courseId) {
    return res.redirect('/courses');
  }

  if (!name) {
    return res.redirect(
      `/courses/manage/${courseId}?error=${encodeURIComponent('Course name is required.')}${redirectSuffix}`
    );
  }

  if (name.length > MAX_COURSE_NAME_LENGTH) {
    return res.redirect(
      `/courses/manage/${courseId}?error=${encodeURIComponent(`Course name is too long (max ${MAX_COURSE_NAME_LENGTH} characters).`)}${redirectSuffix}`
    );
  }

  if (description.length > MAX_COURSE_DESCRIPTION_LENGTH) {
    return res.redirect(
      `/courses/manage/${courseId}?error=${encodeURIComponent(`Course description is too long (max ${MAX_COURSE_DESCRIPTION_LENGTH} characters).`)}${redirectSuffix}`
    );
  }

  if (!instructorName) {
    return res.redirect(
      `/courses/manage/${courseId}?error=${encodeURIComponent('Instructor name is required.')}${redirectSuffix}`
    );
  }

  if (instructorName.length > MAX_INSTRUCTOR_LENGTH) {
    return res.redirect(
      `/courses/manage/${courseId}?error=${encodeURIComponent(`Instructor name is too long (max ${MAX_INSTRUCTOR_LENGTH} characters).`)}${redirectSuffix}`
    );
  }

  if (coursePrefix.length > MAX_COURSE_PREFIX_LENGTH) {
    return res.redirect(
      `/courses/manage/${courseId}?error=${encodeURIComponent(`Course prefix is too long (max ${MAX_COURSE_PREFIX_LENGTH} characters).`)}${redirectSuffix}`
    );
  }

  if (
    rawCourseNumber
    && (!Number.isInteger(courseNumber) || courseNumber < 0 || courseNumber > MAX_COURSE_NUMBER)
  ) {
    return res.redirect(
      `/courses/manage/${courseId}?error=${encodeURIComponent(`Course number must be a whole number between 0 and ${MAX_COURSE_NUMBER}.`)}${redirectSuffix}`
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const [profile, course] = await Promise.all([
      courseModel.fetchProfileById(supabase, sessionUser.id),
      courseModel.fetchCourseById(supabase, courseId),
    ]);

    if (!course) {
      return res.redirect('/courses');
    }

    const manageAccess = buildCourseManageAccess(
      buildAccessProfile(profile, sessionUser),
      course
    );
    if (!manageAccess.allowed) {
      return res.redirect(
        `/courses/${courseId}?error=${encodeURIComponent(manageAccess.reason)}`
      );
    }

    const updatedCourse = await courseModel.updateCourseRecord(supabase, {
      courseId,
      name,
      description,
      instructorName,
      coursePrefix: coursePrefix || null,
      courseNumber,
    });

    if (!updatedCourse) {
      return res.redirect(
        `/courses/manage/${courseId}?error=${encodeURIComponent('Unable to save changes right now.')}${redirectSuffix}`
      );
    }

    return res.redirect(
      `/courses/manage/${courseId}?success=${encodeURIComponent('Course updated successfully.')}`
    );
  } catch (_err) {
    return res.redirect(
      `/courses/manage/${courseId}?error=${encodeURIComponent('Unable to save changes right now.')}${redirectSuffix}`
    );
  }
}

module.exports = {
  listCourses,
  showCreateCourse,
  showManageCourse,
  showCourseById,
  joinCourse,
  leaveCourse,
  createCoursePost,
  createCourse,
  updateCourse,
};
