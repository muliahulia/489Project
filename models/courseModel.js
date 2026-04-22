const { fetchProfileById, fetchProfilesByIds } = require('./shared/profileQueries');
const {
  fetchLikeRowsByPostIds,
  fetchUserLikeRowsByPostIds,
  fetchCommentRowsByPostIds,
} = require('./shared/postInteractions');

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
    .select('id,school_id,name,description,course_prefix,course_number,instructor_name,created_by')
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
    .select('id,school_id,name,description,course_prefix,course_number,instructor_name,created_by')
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
    .select('id,school_id,name,description,course_prefix,course_number,instructor_name,created_by')
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

async function createCourseRecord(supabase, payload) {
  const { data, error } = await supabase
    .from('courses')
    .insert({
      school_id: payload.schoolId,
      name: payload.name,
      description: payload.description,
      course_prefix: payload.coursePrefix,
      course_number: payload.courseNumber,
      instructor_name: payload.instructorName,
      created_by: payload.creatorId,
    })
    .select('id,school_id,name,description,course_prefix,course_number,instructor_name,created_by')
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function updateCourseRecord(supabase, payload) {
  const { data, error } = await supabase
    .from('courses')
    .update({
      name: payload.name,
      description: payload.description,
      course_prefix: payload.coursePrefix,
      course_number: payload.courseNumber,
      instructor_name: payload.instructorName,
    })
    .eq('id', payload.courseId)
    .select('id,school_id,name,description,course_prefix,course_number,instructor_name,created_by')
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function fetchCommentsByPostIds(supabase, postIds) {
  const { rows } = await fetchCommentRowsByPostIds(supabase, postIds);
  return rows;
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
  createCourseRecord,
  updateCourseRecord,
  fetchLikeRowsByPostIds,
  fetchUserLikeRowsByPostIds,
  fetchCommentsByPostIds,
  userCanPostInCourse,
};
