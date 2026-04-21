var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');

const ACTIVE_USERS_TIMEZONE = process.env.ACTIVE_USERS_TIMEZONE || 'America/Los_Angeles';
const USERS_PAGE_SIZE = 1000;
const REPORT_LOOKBACK_HOURS = 48;
const REPORT_TABLE_LIMIT = 100;
const USER_SEARCH_LIMIT = 100;
const USER_ACTIVITY_PAGE_SIZE = 20;
const REPORT_TYPE_MAP = {
  post: 'post',
  user: 'user',
  community: 'community',
};

function dateKeyForTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isDateTodayInTimeZone(value, todayKey, timeZone) {
  if (!value) {
    return false;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return dateKeyForTimeZone(parsed, timeZone) === todayKey;
}

function formatProfileLabel(row) {
  if (!row) {
    return 'Unknown User';
  }

  const first = typeof row.first_name === 'string' ? row.first_name.trim() : '';
  const last = typeof row.last_name === 'string' ? row.last_name.trim() : '';
  const fullName = [first, last].filter(Boolean).join(' ').trim();
  if (fullName) {
    return fullName;
  }

  if (row.email && typeof row.email === 'string') {
    return row.email;
  }

  return 'Unknown User';
}

function fallbackUserLabel(userId) {
  return userId ? `User ${userId}` : 'Unknown User';
}

function sanitizeSearchQuery(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, 80);
}

function isLikelyUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sanitizeModalName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'update-email' || normalized === 'penalize') {
    return normalized;
  }
  return '';
}

function isLikelyEmail(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeReportType(rawType) {
  if (!rawType || typeof rawType !== 'string') {
    return null;
  }

  const normalized = rawType.trim().toLowerCase();
  return REPORT_TYPE_MAP[normalized] || null;
}

function tableNameForReportType(reportType) {
  if (reportType === 'post') {
    return 'post_reports';
  }
  if (reportType === 'user') {
    return 'user_reports';
  }
  if (reportType === 'community') {
    return 'community_reports';
  }
  return null;
}

async function fetchActiveUsersToday() {
  const supabase = createSupabaseAdminClient();
  const todayKey = dateKeyForTimeZone(new Date(), ACTIVE_USERS_TIMEZONE);
  let page = 1;
  let total = 0;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: USERS_PAGE_SIZE,
    });

    if (error) {
      throw error;
    }

    const users = data && Array.isArray(data.users) ? data.users : [];
    if (users.length === 0) {
      break;
    }

    total += users.reduce((count, user) => {
      return count + (isDateTodayInTimeZone(user.last_sign_in_at, todayKey, ACTIVE_USERS_TIMEZONE) ? 1 : 0);
    }, 0);

    if (users.length < USERS_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return total;
}

async function fetchReportsToday() {
  const supabase = createSupabaseAdminClient();
  const todayKey = dateKeyForTimeZone(new Date(), ACTIVE_USERS_TIMEZONE);
  const windowStart = new Date(Date.now() - (REPORT_LOOKBACK_HOURS * 60 * 60 * 1000)).toISOString();
  let reportCount = 0;
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('post_reports')
      .select('created_at')
      .gte('created_at', windowStart)
      .range(from, to);

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      break;
    }

    reportCount += rows.reduce((count, row) => {
      return count + (isDateTodayInTimeZone(row.created_at, todayKey, ACTIVE_USERS_TIMEZONE) ? 1 : 0);
    }, 0);

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return reportCount;
}

async function fetchFlaggedCommunities() {
  const supabase = createSupabaseAdminClient();
  let from = 0;
  const pageSize = 1000;
  const communityIds = new Set();

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('community_reports')
      .select('community_id')
      .eq('status', 'pending')
      .range(from, to);

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      break;
    }

    rows.forEach((row) => {
      if (row && row.community_id) {
        communityIds.add(row.community_id);
      }
    });

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return communityIds.size;
}

async function fetchAccountsUnderPenalty() {
  const supabase = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  let from = 0;
  const pageSize = 1000;
  const penalizedUserIds = new Set();

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('user_penalties')
      .select('user_id')
      .or(`expires_at.is.null,expires_at.gte.${nowIso}`)
      .range(from, to);

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      break;
    }

    rows.forEach((row) => {
      if (row && row.user_id) {
        penalizedUserIds.add(row.user_id);
      }
    });

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return penalizedUserIds.size;
}

async function fetchPendingCount(tableName) {
  const supabase = createSupabaseAdminClient();
  const { count, error } = await supabase
    .from(tableName)
    .select('*', { head: true, count: 'exact' })
    .eq('status', 'pending');

  if (error) {
    throw error;
  }

  return typeof count === 'number' ? count : 0;
}

async function fetchReportRows(tableName, columns) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(tableName)
    .select(columns)
    .order('created_at', { ascending: false })
    .limit(REPORT_TABLE_LIMIT);

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

async function fetchPostAuthorIdsByPostId(postIds) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    return {};
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('posts')
    .select('id,author_id')
    .in('id', postIds);

  if (error || !Array.isArray(data)) {
    return {};
  }

  return data.reduce((acc, row) => {
    acc[row.id] = row.author_id || null;
    return acc;
  }, {});
}

async function fetchCommentAuthorIdsByCommentId(commentIds) {
  if (!Array.isArray(commentIds) || commentIds.length === 0) {
    return {};
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('comments')
    .select('id,author_id')
    .in('id', commentIds);

  if (error || !Array.isArray(data)) {
    return {};
  }

  return data.reduce((acc, row) => {
    acc[row.id] = row.author_id || null;
    return acc;
  }, {});
}

async function fetchProfileLabelsById(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return {};
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id,first_name,last_name,email')
    .in('id', userIds);

  if (error || !Array.isArray(data)) {
    return {};
  }

  return data.reduce((acc, row) => {
    acc[row.id] = formatProfileLabel(row);
    return acc;
  }, {});
}

async function fetchCommunityNamesById(communityIds) {
  if (!Array.isArray(communityIds) || communityIds.length === 0) {
    return {};
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('communities')
    .select('id,name')
    .in('id', communityIds);

  if (error || !Array.isArray(data)) {
    return {};
  }

  return data.reduce((acc, row) => {
    acc[row.id] = row.name || `Community #${row.id}`;
    return acc;
  }, {});
}

async function fetchCommunityMetaById(communityIds) {
  if (!Array.isArray(communityIds) || communityIds.length === 0) {
    return {};
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('communities')
    .select('id,name,creator_id')
    .in('id', communityIds);

  if (error || !Array.isArray(data)) {
    return {};
  }

  return data.reduce((acc, row) => {
    acc[row.id] = {
      name: row.name || `Community #${row.id}`,
      creatorId: row.creator_id || null,
    };
    return acc;
  }, {});
}

async function fetchReportsPageData() {
  const [postReports, userReports, communityReports] = await Promise.all([
    fetchReportRows('post_reports', 'id,reporter_id,post_id,comment_id,reason,status,created_at'),
    fetchReportRows('user_reports', 'id,reporter_id,reported_user_id,reason,status,created_at'),
    fetchReportRows('community_reports', 'id,reporter_id,community_id,reason,status,created_at'),
  ]);

  const reporterIds = [...new Set(
    [...postReports, ...userReports, ...communityReports]
      .map((row) => row.reporter_id)
      .filter(Boolean)
  )];
  const reportedUserIds = [...new Set(
    userReports
      .map((row) => row.reported_user_id)
      .filter(Boolean)
  )];
  const postIds = [...new Set(
    postReports
      .map((row) => row.post_id)
      .filter(Boolean)
  )];
  const commentIds = [...new Set(
    postReports
      .map((row) => row.comment_id)
      .filter(Boolean)
  )];
  const communityIds = [...new Set(
    communityReports
      .map((row) => row.community_id)
      .filter(Boolean)
  )];

  const [
    pendingPostReports,
    pendingUserReports,
    pendingCommunityReports,
    postAuthorsByPostId,
    commentAuthorsByCommentId,
    communityMetaById,
  ] = await Promise.all([
    fetchPendingCount('post_reports'),
    fetchPendingCount('user_reports'),
    fetchPendingCount('community_reports'),
    fetchPostAuthorIdsByPostId(postIds),
    fetchCommentAuthorIdsByCommentId(commentIds),
    fetchCommunityMetaById(communityIds),
  ]);

  const reportedCommunityCreatorIds = [...new Set(
    Object.values(communityMetaById)
      .map((row) => row && row.creatorId)
      .filter(Boolean)
  )];
  const reportedContentAuthorIds = [...new Set(
    [
      ...Object.values(postAuthorsByPostId),
      ...Object.values(commentAuthorsByCommentId),
    ].filter(Boolean)
  )];
  const allProfileIds = [...new Set([
    ...reporterIds,
    ...reportedUserIds,
    ...reportedContentAuthorIds,
    ...reportedCommunityCreatorIds,
  ])];
  const profileLabels = await fetchProfileLabelsById(allProfileIds);

  const normalizedPostReports = postReports.map((row) => {
    const isCommentTarget = Boolean(row.comment_id);
    const reportedAuthorId = isCommentTarget
      ? commentAuthorsByCommentId[row.comment_id]
      : postAuthorsByPostId[row.post_id];
    const reportedAuthorLabel = profileLabels[reportedAuthorId] || fallbackUserLabel(reportedAuthorId);

    return {
      id: row.id,
      reportType: 'Post',
      reporter: profileLabels[row.reporter_id] || fallbackUserLabel(row.reporter_id),
      reported: reportedAuthorLabel,
      reason: row.reason || 'No reason provided',
      status: row.status || 'pending',
      created_at: row.created_at || null,
      viewHref: `/admin/reports/post/${row.id}`,
    };
  });

  const normalizedUserReports = userReports.map((row) => ({
    id: row.id,
    reportType: 'User',
    reporter: profileLabels[row.reporter_id] || fallbackUserLabel(row.reporter_id),
    reported: profileLabels[row.reported_user_id] || fallbackUserLabel(row.reported_user_id),
    reason: row.reason || 'No reason provided',
    status: row.status || 'pending',
    created_at: row.created_at || null,
    viewHref: `/admin/reports/user/${row.id}`,
  }));

  const normalizedCommunityReports = communityReports.map((row) => ({
    id: row.id,
    reportType: 'Community',
    reporter: profileLabels[row.reporter_id] || fallbackUserLabel(row.reporter_id),
    reported: profileLabels[communityMetaById[row.community_id] && communityMetaById[row.community_id].creatorId]
      || 'Unknown User',
    reason: row.reason || 'No reason provided',
    status: row.status || 'pending',
    created_at: row.created_at || null,
    viewHref: `/admin/reports/community/${row.id}`,
  }));

  const combinedReports = [
    ...normalizedPostReports,
    ...normalizedUserReports,
    ...normalizedCommunityReports,
  ].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });

  return {
    combinedReports,
    totalReports: combinedReports.length,
    pendingPostReports,
    pendingUserReports,
    pendingCommunityReports,
  };
}

async function fetchUsersBySearchQuery(searchQuery) {
  const supabase = createSupabaseAdminClient();
  const query = sanitizeSearchQuery(searchQuery);

  if (!query) {
    return [];
  }

  let request = supabase
    .from('profiles')
    .select('id,first_name,last_name,email,role,is_active,created_at,last_login')
    .order('created_at', { ascending: false })
    .limit(USER_SEARCH_LIMIT);

  const escapedQuery = query.replace(/[%_]/g, '\\$&');
  request = request.or(
    `first_name.ilike.%${escapedQuery}%,last_name.ilike.%${escapedQuery}%,email.ilike.%${escapedQuery}%`
  );

  const { data, error } = await request;
  if (error || !Array.isArray(data)) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    fullName: formatProfileLabel(row),
    email: row.email || 'Unknown',
    role: row.role || 'student',
    isActive: typeof row.is_active === 'boolean' ? row.is_active : true,
    createdAt: row.created_at || null,
    lastLogin: row.last_login || null,
    viewHref: `/admin/users/${row.id}`,
  }));
}

async function countRowsByEq(supabase, tableName, columnName, value) {
  const { count, error } = await supabase
    .from(tableName)
    .select('*', { head: true, count: 'exact' })
    .eq(columnName, value);

  if (error) {
    return 0;
  }

  return typeof count === 'number' ? count : 0;
}

async function fetchAdminUserDetail(userId) {
  const supabase = createSupabaseAdminClient();
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,first_name,last_name,email,role,is_active,created_at,last_login,school_id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile) {
    return null;
  }

  let schoolName = null;
  if (profile.school_id) {
    const { data: schoolData, error: schoolError } = await supabase
      .from('schools')
      .select('name')
      .eq('id', profile.school_id)
      .maybeSingle();

    if (!schoolError && schoolData && schoolData.name) {
      schoolName = schoolData.name;
    }
  }

  const nowIso = new Date().toISOString();
  const [
    postsAuthored,
    commentsAuthored,
    communitiesJoined,
    coursesEnrolled,
    postReportsFiled,
    userReportsFiled,
    communityReportsFiled,
    reportsAgainstUser,
    activePenalties,
  ] = await Promise.all([
    countRowsByEq(supabase, 'posts', 'author_id', userId),
    countRowsByEq(supabase, 'comments', 'author_id', userId),
    countRowsByEq(supabase, 'community_members', 'user_id', userId),
    countRowsByEq(supabase, 'course_enrollments', 'user_id', userId),
    countRowsByEq(supabase, 'post_reports', 'reporter_id', userId),
    countRowsByEq(supabase, 'user_reports', 'reporter_id', userId),
    countRowsByEq(supabase, 'community_reports', 'reporter_id', userId),
    countRowsByEq(supabase, 'user_reports', 'reported_user_id', userId),
    (async () => {
      const { count, error } = await supabase
        .from('user_penalties')
        .select('*', { head: true, count: 'exact' })
        .eq('user_id', userId)
        .or(`expires_at.is.null,expires_at.gte.${nowIso}`);

      if (error) {
        return 0;
      }
      return typeof count === 'number' ? count : 0;
    })(),
  ]);

  return {
    id: profile.id,
    fullName: formatProfileLabel(profile),
    email: profile.email || 'Unknown',
    role: profile.role || 'student',
    isActive: typeof profile.is_active === 'boolean' ? profile.is_active : true,
    createdAt: profile.created_at || null,
    lastLogin: profile.last_login || null,
    schoolName: schoolName || 'Not set',
    metrics: {
      postsAuthored,
      commentsAuthored,
      communitiesJoined,
      coursesEnrolled,
      reportsFiled: postReportsFiled + userReportsFiled + communityReportsFiled,
      reportsAgainstUser,
      activePenalties,
    },
  };
}

async function fetchUserActivityLogsPage(userId, pageNumber) {
  const supabase = createSupabaseAdminClient();
  const page = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  const from = (page - 1) * USER_ACTIVITY_PAGE_SIZE;
  const to = from + USER_ACTIVITY_PAGE_SIZE - 1;

  const [rowsResult, countResult] = await Promise.all([
    supabase
      .from('user_activity_logs')
      .select('id,action_type,target_type,target_id,metadata,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to),
    supabase
      .from('user_activity_logs')
      .select('*', { head: true, count: 'exact' })
      .eq('user_id', userId),
  ]);

  const rows = !rowsResult.error && Array.isArray(rowsResult.data) ? rowsResult.data : [];
  const totalCount = !countResult.error && typeof countResult.count === 'number' ? countResult.count : 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / USER_ACTIVITY_PAGE_SIZE));

  return {
    rows: rows.map((row) => ({
      id: row.id,
      actionType: row.action_type || 'unknown',
      targetType: row.target_type || 'n/a',
      targetId: row.target_id || null,
      metadata: row.metadata || null,
      createdAt: row.created_at || null,
    })),
    page,
    totalPages,
    totalCount,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

async function fetchReportDetail(reportType, reportId) {
  const supabase = createSupabaseAdminClient();

  if (reportType === 'post') {
    const { data, error } = await supabase
      .from('post_reports')
      .select('id,reporter_id,post_id,comment_id,reason,status,admin_note,created_at')
      .eq('id', reportId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const isComment = Boolean(data.comment_id);
    let reportedAuthorId = null;

    if (isComment) {
      const commentResult = await supabase
        .from('comments')
        .select('author_id')
        .eq('id', data.comment_id)
        .maybeSingle();
      if (!commentResult.error && commentResult.data) {
        reportedAuthorId = commentResult.data.author_id || null;
      }
    } else {
      const postResult = await supabase
        .from('posts')
        .select('author_id')
        .eq('id', data.post_id)
        .maybeSingle();
      if (!postResult.error && postResult.data) {
        reportedAuthorId = postResult.data.author_id || null;
      }
    }

    const profileLabels = await fetchProfileLabelsById(
      [data.reporter_id, reportedAuthorId].filter(Boolean)
    );
    const targetId = isComment ? data.comment_id : data.post_id;
    const targetKind = isComment ? 'Comment' : 'Post';
    const reportedAuthorLabel = profileLabels[reportedAuthorId] || 'Unknown User';

    return {
      id: data.id,
      reportTypeSlug: 'post',
      reportType: 'Post',
      reporter: profileLabels[data.reporter_id] || fallbackUserLabel(data.reporter_id),
      reported: reportedAuthorLabel,
      reportedUserId: reportedAuthorId || null,
      contentLabel: `${targetKind} #${targetId || '?'}`,
      postId: data.post_id || null,
      commentId: data.comment_id || null,
      reason: data.reason || 'No reason provided',
      status: data.status || 'pending',
      adminNote: data.admin_note || '',
      createdAt: data.created_at || null,
      backHref: '/admin/reports',
    };
  }

  if (reportType === 'user') {
    const { data, error } = await supabase
      .from('user_reports')
      .select('id,reporter_id,reported_user_id,reason,status,admin_note,created_at')
      .eq('id', reportId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const profileLabels = await fetchProfileLabelsById(
      [data.reporter_id, data.reported_user_id].filter(Boolean)
    );

    return {
      id: data.id,
      reportTypeSlug: 'user',
      reportType: 'User',
      reporter: profileLabels[data.reporter_id] || fallbackUserLabel(data.reporter_id),
      reported: profileLabels[data.reported_user_id] || fallbackUserLabel(data.reported_user_id),
      reportedUserId: data.reported_user_id || null,
      contentLabel: null,
      postId: null,
      commentId: null,
      reason: data.reason || 'No reason provided',
      status: data.status || 'pending',
      adminNote: data.admin_note || '',
      createdAt: data.created_at || null,
      backHref: '/admin/reports',
    };
  }

  if (reportType === 'community') {
    const { data, error } = await supabase
      .from('community_reports')
      .select('id,reporter_id,community_id,reason,status,admin_note,created_at')
      .eq('id', reportId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const communityMetaById = await fetchCommunityMetaById([data.community_id].filter(Boolean));
    const communityMeta = communityMetaById[data.community_id] || null;
    const reportedUserId = communityMeta && communityMeta.creatorId ? communityMeta.creatorId : null;
    const profileLabels = await fetchProfileLabelsById([data.reporter_id, reportedUserId].filter(Boolean));
    const reportedLabel =
      profileLabels[reportedUserId] || fallbackUserLabel(reportedUserId);

    return {
      id: data.id,
      reportTypeSlug: 'community',
      reportType: 'Community',
      reporter: profileLabels[data.reporter_id] || fallbackUserLabel(data.reporter_id),
      reported: reportedLabel,
      reportedUserId,
      contentLabel: communityMeta ? communityMeta.name : `Community #${data.community_id}`,
      postId: null,
      commentId: null,
      communityId: data.community_id || null,
      reason: data.reason || 'No reason provided',
      status: data.status || 'pending',
      adminNote: data.admin_note || '',
      createdAt: data.created_at || null,
      backHref: '/admin/reports',
    };
  }

  return null;
}

async function applyModerationActions(supabase, report, actions, adminUserId) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return;
  }

  if (actions.includes('penalize_user') && report.reportedUserId) {
    const penaltyReason = `Report ${report.reportType} #${report.id}: ${report.reason}`;
    const penaltyInsert = await supabase
      .from('user_penalties')
      .insert({
        user_id: report.reportedUserId,
        issued_by: adminUserId || null,
        reason: penaltyReason,
      });

    if (penaltyInsert.error) {
      throw penaltyInsert.error;
    }
  }

  if (actions.includes('remove_content')) {
    if (report.reportTypeSlug === 'post') {
      if (report.commentId) {
        const commentUpdate = await supabase
          .from('comments')
          .update({ is_deleted: true })
          .eq('id', report.commentId);
        if (commentUpdate.error) {
          throw commentUpdate.error;
        }
      } else if (report.postId) {
        const postUpdate = await supabase
          .from('posts')
          .update({ is_deleted: true })
          .eq('id', report.postId);
        if (postUpdate.error) {
          throw postUpdate.error;
        }
      }
    } else if (report.reportTypeSlug === 'user' && report.reportedUserId) {
      const [postsUpdate, commentsUpdate] = await Promise.all([
        supabase.from('posts').update({ is_deleted: true }).eq('author_id', report.reportedUserId),
        supabase.from('comments').update({ is_deleted: true }).eq('author_id', report.reportedUserId),
      ]);

      if (postsUpdate.error) {
        throw postsUpdate.error;
      }
      if (commentsUpdate.error) {
        throw commentsUpdate.error;
      }
    } else if (report.reportTypeSlug === 'community' && report.communityId) {
      const postsResult = await supabase
        .from('posts')
        .select('id')
        .eq('community_id', report.communityId);

      if (postsResult.error) {
        throw postsResult.error;
      }

      const postIds = Array.isArray(postsResult.data)
        ? postsResult.data.map((row) => row.id).filter(Boolean)
        : [];

      const postUpdate = await supabase
        .from('posts')
        .update({ is_deleted: true })
        .eq('community_id', report.communityId);
      if (postUpdate.error) {
        throw postUpdate.error;
      }

      if (postIds.length > 0) {
        const commentsUpdate = await supabase
          .from('comments')
          .update({ is_deleted: true })
          .in('post_id', postIds);
        if (commentsUpdate.error) {
          throw commentsUpdate.error;
        }
      }
    }
  }
}

router.get('/', requireAuth, (_req, res) => {
  res.redirect('/admin/dashboard');
});

router.get('/dashboard', requireAuth, async (req, res) => {
  let activeUsersToday = 0;
  let reportsToday = 0;
  let accountsUnderPenalty = 0;
  let flaggedCommunities = 0;

  try {
    activeUsersToday = await fetchActiveUsersToday();
  } catch (_err) {
    // Keep a safe default when user activity lookup fails.
  }

  try {
    reportsToday = await fetchReportsToday();
  } catch (_err) {
    // Keep a safe default when report lookup fails.
  }

  try {
    accountsUnderPenalty = await fetchAccountsUnderPenalty();
  } catch (_err) {
    // Keep a safe default when penalty lookup fails.
  }

  try {
    flaggedCommunities = await fetchFlaggedCommunities();
  } catch (_err) {
    // Keep a safe default when community report lookup fails.
  }

  res.render('adminDashboard', {
    activeUsersToday,
    reportsToday,
    accountsUnderPenalty,
    flaggedCommunities,
  });
});

router.get('/users', requireAuth, async (req, res) => {
  const searchQuery = sanitizeSearchQuery(req.query.q);
  let users = [];

  try {
    users = await fetchUsersBySearchQuery(searchQuery);
  } catch (_err) {
    users = [];
  }

  return res.render('adminUsers', {
    searchQuery,
    users,
  });
});

router.get('/users/:id', requireAuth, async (req, res, next) => {
  const userId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  const tab = typeof req.query.tab === 'string' && req.query.tab.trim().toLowerCase() === 'activity'
    ? 'activity'
    : 'overview';
  const successMessage = typeof req.query.success === 'string' ? req.query.success : '';
  const errorMessage = typeof req.query.error === 'string' ? req.query.error : '';
  const openModal = sanitizeModalName(req.query.modal);
  const requestedPage = Number.parseInt(req.query.page, 10);
  const activityPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  if (!isLikelyUuid(userId)) {
    const err = new Error('User not found');
    err.status = 404;
    return next(err);
  }

  try {
    const [userDetail, activityLogs] = await Promise.all([
      fetchAdminUserDetail(userId),
      fetchUserActivityLogsPage(userId, activityPage),
    ]);
    if (!userDetail) {
      const err = new Error('User not found');
      err.status = 404;
      return next(err);
    }

    return res.render('adminUserDetail', {
      userDetail,
      tab,
      activityLogs,
      successMessage,
      errorMessage,
      openModal,
    });
  } catch (_err) {
    const err = new Error('Unable to load user details');
    err.status = 500;
    return next(err);
  }
});

router.post('/users/:id/update-email', requireAuth, async (req, res, next) => {
  const userId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  const nextEmail = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  if (!isLikelyUuid(userId)) {
    const err = new Error('User not found');
    err.status = 404;
    return next(err);
  }

  if (!isLikelyEmail(nextEmail)) {
    return res.redirect(`/admin/users/${userId}?tab=overview&modal=update-email&error=${encodeURIComponent('Please provide a valid email address')}`);
  }

  try {
    const supabase = createSupabaseAdminClient();
    const profileResult = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (profileResult.error || !profileResult.data) {
      const err = new Error('User not found');
      err.status = 404;
      return next(err);
    }

    const authUpdateResult = await supabase.auth.admin.updateUserById(userId, {
      email: nextEmail,
    });

    if (authUpdateResult.error) {
      return res.redirect(`/admin/users/${userId}?tab=overview&modal=update-email&error=${encodeURIComponent(authUpdateResult.error.message || 'Unable to update email')}`);
    }

    const profileUpdateResult = await supabase
      .from('profiles')
      .update({ email: nextEmail })
      .eq('id', userId);

    if (profileUpdateResult.error) {
      return res.redirect(`/admin/users/${userId}?tab=overview&modal=update-email&error=${encodeURIComponent('Auth email updated, but profile email update failed')}`);
    }

    return res.redirect(`/admin/users/${userId}?tab=overview&success=${encodeURIComponent('Email updated successfully')}`);
  } catch (_err) {
    return res.redirect(`/admin/users/${userId}?tab=overview&modal=update-email&error=${encodeURIComponent('Unable to update email')}`);
  }
});

router.post('/users/:id/penalize', requireAuth, async (req, res, next) => {
  const userId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  const expiresAtRaw = typeof req.body.expiresAt === 'string' ? req.body.expiresAt.trim() : '';
  const adminUserId = req.session && req.session.auth && req.session.auth.user
    ? req.session.auth.user.id
    : null;

  if (!isLikelyUuid(userId)) {
    const err = new Error('User not found');
    err.status = 404;
    return next(err);
  }

  if (!reason) {
    return res.redirect(`/admin/users/${userId}?tab=overview&modal=penalize&error=${encodeURIComponent('Penalty reason is required')}`);
  }

  let expiresAt = null;
  if (expiresAtRaw) {
    const parsed = new Date(expiresAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return res.redirect(`/admin/users/${userId}?tab=overview&modal=penalize&error=${encodeURIComponent('Invalid expiration date')}`);
    }
    expiresAt = parsed.toISOString();
  }

  try {
    const supabase = createSupabaseAdminClient();
    const profileResult = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (profileResult.error || !profileResult.data) {
      const err = new Error('User not found');
      err.status = 404;
      return next(err);
    }

    const penaltyResult = await supabase
      .from('user_penalties')
      .insert({
        user_id: userId,
        issued_by: adminUserId,
        reason,
        expires_at: expiresAt,
      });

    if (penaltyResult.error) {
      return res.redirect(`/admin/users/${userId}?tab=overview&modal=penalize&error=${encodeURIComponent('Unable to create penalty')}`);
    }

    return res.redirect(`/admin/users/${userId}?tab=overview&success=${encodeURIComponent('Penalty added successfully')}`);
  } catch (_err) {
    return res.redirect(`/admin/users/${userId}?tab=overview&modal=penalize&error=${encodeURIComponent('Unable to create penalty')}`);
  }
});

router.get('/reports', requireAuth, async (req, res) => {
  let reportData = {
    combinedReports: [],
    totalReports: 0,
    pendingPostReports: 0,
    pendingUserReports: 0,
    pendingCommunityReports: 0,
  };

  try {
    reportData = await fetchReportsPageData();
  } catch (_err) {
    // Render page with safe defaults when report lookups fail.
  }

  res.render('reportDashboard', reportData);
});

router.get('/reports/:type/:id', requireAuth, async (req, res, next) => {
  const reportType = normalizeReportType(req.params.type);
  const reportId = Number.parseInt(req.params.id, 10);

  if (!reportType || !Number.isInteger(reportId) || reportId <= 0) {
    const err = new Error('Report not found');
    err.status = 404;
    return next(err);
  }

  try {
    const report = await fetchReportDetail(reportType, reportId);
    if (!report) {
      const err = new Error('Report not found');
      err.status = 404;
      return next(err);
    }

    return res.render('Report', {
      report,
      saveSuccess: req.query.saved === '1',
      saveError: req.query.error || null,
    });
  } catch (_err) {
    const err = new Error('Unable to load report details');
    err.status = 500;
    return next(err);
  }
});

router.post('/reports/:type/:id', requireAuth, async (req, res, next) => {
  const reportType = normalizeReportType(req.params.type);
  const reportId = Number.parseInt(req.params.id, 10);
  const tableName = tableNameForReportType(reportType);

  if (!reportType || !tableName || !Number.isInteger(reportId) || reportId <= 0) {
    const err = new Error('Report not found');
    err.status = 404;
    return next(err);
  }

  const decision = typeof req.body.decision === 'string' ? req.body.decision.trim().toLowerCase() : '';
  const rawAdminNote = typeof req.body.adminNote === 'string' ? req.body.adminNote.trim() : '';
  const moderationActionsRaw = req.body.moderationActions;
  const moderationActionsList = Array.isArray(moderationActionsRaw)
    ? moderationActionsRaw
    : (typeof moderationActionsRaw === 'string' && moderationActionsRaw ? [moderationActionsRaw] : []);
  const moderationActions = moderationActionsList
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter(Boolean);
  const allowedStatuses = new Set(['resolved', 'rejected']);
  const allowedActions = new Set(['penalize_user', 'remove_content']);

  if (!allowedStatuses.has(decision)) {
    return res.redirect(`/admin/reports/${reportType}/${reportId}?error=${encodeURIComponent('Invalid moderation decision')}`);
  }

  if (!moderationActions.every((action) => allowedActions.has(action))) {
    return res.redirect(`/admin/reports/${reportType}/${reportId}?error=${encodeURIComponent('Invalid moderation action')}`);
  }

  try {
    const supabase = createSupabaseAdminClient();
    const adminUserId = req.session && req.session.auth && req.session.auth.user
      ? req.session.auth.user.id
      : null;
    const report = await fetchReportDetail(reportType, reportId);

    if (!report) {
      return res.redirect(`/admin/reports/${reportType}/${reportId}?error=${encodeURIComponent('Report not found')}`);
    }

    if (decision === 'resolved') {
      await applyModerationActions(supabase, report, moderationActions, adminUserId);
    }

    const updatePayload = {
      status: decision,
      admin_note: rawAdminNote || null,
    };

    const { error } = await supabase
      .from(tableName)
      .update(updatePayload)
      .eq('id', reportId);

    if (error) {
      return res.redirect(`/admin/reports/${reportType}/${reportId}?error=${encodeURIComponent('Unable to save report changes')}`);
    }

    return res.redirect(`/admin/reports/${reportType}/${reportId}?saved=1`);
  } catch (_err) {
    return res.redirect(`/admin/reports/${reportType}/${reportId}?error=${encodeURIComponent('Unable to save report changes')}`);
  }
});

module.exports = router;
