var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');

const ACTIVE_USERS_TIMEZONE = process.env.ACTIVE_USERS_TIMEZONE || 'America/Los_Angeles';
const USERS_PAGE_SIZE = 1000;
const REPORT_LOOKBACK_HOURS = 48;

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

router.get('/', requireAuth, async (req, res) => {
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

module.exports = router;
