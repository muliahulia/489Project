async function fetchProfileById(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,first_name,last_name,email,school_id')
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
    .select('id,first_name,last_name,email,school_id')
    .in('id', ids);

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchSchoolById(supabase, schoolId) {
  if (!schoolId) {
    return null;
  }

  const { data, error } = await supabase
    .from('schools')
    .select('id,name')
    .eq('id', schoolId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function fetchCourseEnrollmentsForUser(supabase, userId) {
  const { data, error } = await supabase
    .from('course_enrollments')
    .select('user_id,course_id,role')
    .eq('user_id', userId);

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchCoursesForSchool(supabase, schoolId) {
  if (!schoolId) {
    return [];
  }

  const { data, error } = await supabase
    .from('courses')
    .select('id,school_id,name,description,created_by')
    .eq('school_id', schoolId)
    .order('name', { ascending: true });

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
    .select('id,school_id,name,description,created_by')
    .in('id', ids)
    .order('name', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchCourseById(supabase, courseId) {
  const { data, error } = await supabase
    .from('courses')
    .select('id,school_id,name,description,created_by')
    .eq('id', courseId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function fetchCourseEnrollmentsByCourseIds(supabase, courseIds) {
  if (!Array.isArray(courseIds) || courseIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('course_enrollments')
    .select('user_id,course_id,role')
    .in('course_id', courseIds);

  if (error || !data) {
    return [];
  }

  return data;
}

async function fetchCourseEnrollmentForUser(supabase, courseId, userId) {
  const { data, error } = await supabase
    .from('course_enrollments')
    .select('user_id,course_id,role')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function upsertCourseEnrollment(supabase, enrollment) {
  const { error } = await supabase
    .from('course_enrollments')
    .upsert(
      [{
        user_id: enrollment.userId,
        course_id: enrollment.courseId,
        role: enrollment.role || 'student',
      }],
      { onConflict: 'user_id,course_id' }
    );

  return !error;
}

async function deleteCourseEnrollment(supabase, userId, courseId) {
  const { error } = await supabase
    .from('course_enrollments')
    .delete()
    .eq('user_id', userId)
    .eq('course_id', courseId);

  return !error;
}

async function fetchCoursePosts(supabase, courseId, limit = 50) {
  const { data, error } = await supabase
    .from('posts')
    .select('id,author_id,content,is_official,community_id,course_id,created_at,is_deleted')
    .eq('course_id', courseId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data;
}

async function createCoursePost(supabase, payload) {
  const { error } = await supabase
    .from('posts')
    .insert({
      author_id: payload.authorId,
      content: payload.content,
      is_official: false,
      course_id: payload.courseId,
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

async function userCanPostInCourse(supabase, courseId, userId) {
  const [course, enrollment] = await Promise.all([
    fetchCourseById(supabase, courseId),
    fetchCourseEnrollmentForUser(supabase, courseId, userId),
  ]);

  if (!course) {
    return {
      exists: false,
      allowed: false,
    };
  }

  return {
    exists: true,
    allowed: Boolean(enrollment || (course.created_by && course.created_by === userId)),
  };
}

module.exports = {
  fetchProfileById,
  fetchProfilesByIds,
  fetchSchoolById,
  fetchCourseEnrollmentsForUser,
  fetchCoursesForSchool,
  fetchCoursesByIds,
  fetchCourseById,
  fetchCourseEnrollmentsByCourseIds,
  fetchCourseEnrollmentForUser,
  upsertCourseEnrollment,
  deleteCourseEnrollment,
  fetchCoursePosts,
  createCoursePost,
  fetchLikeRowsByPostIds,
  fetchUserLikeRowsByPostIds,
  fetchCommentsByPostIds,
  userCanPostInCourse,
};
