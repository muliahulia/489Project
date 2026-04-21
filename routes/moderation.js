var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');

function requireGlobalAdmin(req, res, next) {
  const role = req.session
    && req.session.auth
    && req.session.auth.user
    && typeof req.session.auth.user.role === 'string'
    ? req.session.auth.user.role.trim().toLowerCase()
    : '';

  if (role === 'admin') {
    return next();
  }

  const err = new Error('Forbidden');
  err.status = 403;
  return next(err);
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return typeof maxLength === 'number' ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeDomain(value) {
  const raw = normalizeText(value, 255).toLowerCase();
  if (!raw) {
    return '';
  }

  const withoutProtocol = raw.replace(/^https?:\/\//, '');
  const withoutPath = withoutProtocol.split('/')[0];
  const normalized = withoutPath.replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) {
    return '';
  }
  return normalized;
}

function normalizeStoragePath(value) {
  const raw = normalizeText(value, 500);
  if (!raw) {
    return '';
  }
  const noLeadingSlash = raw.replace(/^\/+/, '');
  if (!noLeadingSlash || noLeadingSlash.includes('..')) {
    return '';
  }
  return noLeadingSlash;
}

function pickFirstStringField(row, fieldNames) {
  if (!row || !Array.isArray(fieldNames)) {
    return '';
  }

  for (const fieldName of fieldNames) {
    if (typeof row[fieldName] === 'string' && row[fieldName].trim()) {
      return row[fieldName].trim();
    }
  }
  return '';
}

async function fetchSchoolColumnSet(supabase) {
  const defaultColumns = new Set(['id', 'name', 'domain', 'logo_url']);
  const { data, error } = await supabase
    .from('information_schema.columns')
    .select('column_name')
    .eq('table_schema', 'public')
    .eq('table_name', 'schools');

  if (error || !Array.isArray(data) || data.length === 0) {
    return defaultColumns;
  }

  return new Set(data.map((row) => row.column_name).filter(Boolean));
}

function firstExistingColumn(columnSet, preferredColumns) {
  for (const columnName of preferredColumns) {
    if (columnSet.has(columnName)) {
      return columnName;
    }
  }
  return null;
}

function parseSchoolId(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function buildStoragePublicUrl(path) {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const storageBucket = 'media';
  const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(storageBucket)}/${encodedPath}`;
}

async function logAdminAction(supabase, payload) {
  const { error } = await supabase.from('admin_actions').insert({
    admin_id: payload.adminId || null,
    action_type: payload.actionType || 'unknown',
    target_type: payload.targetType || null,
    target_id: Number.isInteger(payload.targetId) ? payload.targetId : null,
    target_user_id: payload.targetUserId || null,
    description: payload.description || null,
  });

  if (error) {
    throw error;
  }
}

router.get('/account', (req, res) => {
  res.render('accountmoderation');
});

router.get('/community', (req, res) => {
  res.render('communitymoderator');
});

router.get('/school', requireAuth, requireGlobalAdmin, async (req, res) => {
  const supabase = createSupabaseAdminClient();
  let rows = [];

  try {
    const { data, error } = await supabase
      .from('schools')
      .select('*')
      .order('name', { ascending: true });

    if (!error && Array.isArray(data)) {
      rows = data;
    }
  } catch (_err) {
    rows = [];
  }

  const schools = rows.map((row) => ({
    id: row.id || null,
    name: row.name || 'Unnamed School',
    domain: row.domain || '',
    logoUrl: pickFirstStringField(row, ['logo_url', 'logo', 'logo_path', 'image_url', 'logomark_url', 'logomark']),
  }));

  return res.render('schoolModeration', {
    schools,
    successMessage: typeof req.query.success === 'string' ? req.query.success : '',
    errorMessage: typeof req.query.error === 'string' ? req.query.error : '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    storageBucket: 'media',
  });
});

router.post('/school', requireAuth, requireGlobalAdmin, async (req, res) => {
  const name = normalizeText(req.body.name, 160);
  const domain = normalizeDomain(req.body.domain);
  const logoPath = normalizeStoragePath(req.body.logoPath);

  if (!name) {
    return res.redirect('/moderation/school?error=School%20name%20is%20required');
  }

  if (!domain) {
    return res.redirect('/moderation/school?error=Please%20provide%20a%20valid%20domain');
  }

  if (req.body.logoPath && !logoPath) {
    return res.redirect('/moderation/school?error=Uploaded%20logo%20path%20is%20invalid');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const adminUserId = req.session && req.session.auth && req.session.auth.user
      ? req.session.auth.user.id
      : null;
    const columnSet = await fetchSchoolColumnSet(supabase);
    const payload = { name };

    if (columnSet.has('domain')) {
      payload.domain = domain;
    }

    const logoColumn = firstExistingColumn(columnSet, ['logo_url', 'logo', 'logo_path', 'image_url']);
    if (logoColumn) {
      let resolvedLogoUrl = '';

      if (logoPath) {
        resolvedLogoUrl = buildStoragePublicUrl(logoPath);
      }

      if (resolvedLogoUrl) {
        payload[logoColumn] = resolvedLogoUrl;
      }
    }

    const { data: insertedSchool, error } = await supabase
      .from('schools')
      .insert(payload)
      .select('id')
      .maybeSingle();

    if (error) {
      return res.redirect(`/moderation/school?error=${encodeURIComponent(error.message || 'Unable to add school')}`);
    }

    await logAdminAction(supabase, {
      adminId: adminUserId,
      actionType: 'school_created',
      targetType: 'school',
      targetId: insertedSchool && Number.isInteger(insertedSchool.id) ? insertedSchool.id : null,
      description: `Created school ${name}${domain ? ` (${domain})` : ''}`,
    });

    return res.redirect('/moderation/school?success=School%20added%20successfully');
  } catch (_err) {
    return res.redirect('/moderation/school?error=Unable%20to%20add%20school');
  }
});

router.post('/school/:id', requireAuth, requireGlobalAdmin, async (req, res) => {
  const schoolId = parseSchoolId(req.params.id);
  const name = normalizeText(req.body.name, 160);
  const domain = normalizeDomain(req.body.domain);
  const logoPath = normalizeStoragePath(req.body.logoPath);

  if (!schoolId) {
    return res.redirect('/moderation/school?error=Invalid%20school%20id');
  }

  if (!name) {
    return res.redirect('/moderation/school?error=School%20name%20is%20required');
  }

  if (!domain) {
    return res.redirect('/moderation/school?error=Please%20provide%20a%20valid%20domain');
  }

  if (req.body.logoPath && !logoPath) {
    return res.redirect('/moderation/school?error=Uploaded%20logo%20path%20is%20invalid');
  }

  try {
    const supabase = createSupabaseAdminClient();
    const adminUserId = req.session && req.session.auth && req.session.auth.user
      ? req.session.auth.user.id
      : null;
    const columnSet = await fetchSchoolColumnSet(supabase);
    const payload = { name };

    if (columnSet.has('domain')) {
      payload.domain = domain;
    }

    const logoColumn = firstExistingColumn(columnSet, ['logo_url', 'logo', 'logo_path', 'image_url']);
    if (logoColumn && logoPath) {
      payload[logoColumn] = buildStoragePublicUrl(logoPath);
    }

    const { data: updatedSchool, error } = await supabase
      .from('schools')
      .update(payload)
      .eq('id', schoolId)
      .select('id')
      .maybeSingle();

    if (error) {
      return res.redirect(`/moderation/school?error=${encodeURIComponent(error.message || 'Unable to update school')}`);
    }
    if (!updatedSchool) {
      return res.redirect('/moderation/school?error=School%20not%20found');
    }

    await logAdminAction(supabase, {
      adminId: adminUserId,
      actionType: 'school_updated',
      targetType: 'school',
      targetId: schoolId,
      description: `Updated school ${name}${domain ? ` (${domain})` : ''}`,
    });

    return res.redirect('/moderation/school?success=School%20updated%20successfully');
  } catch (_err) {
    return res.redirect('/moderation/school?error=Unable%20to%20update%20school');
  }
});

router.get('/reports', (req, res) => {
  res.redirect('/admin/reports');
});

router.get('/', (req, res) => {
  res.render('report');
});

module.exports = router;
