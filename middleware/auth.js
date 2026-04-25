const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  DEFAULT_STORAGE_BUCKET,
  normalizeStoragePath,
  resolveProfileMedia,
} = require('../lib/profileMedia');
const { buildPublicStorageUrl, createSignedStorageUrl } = require('../lib/storage');
const { pickFirstStringField } = require('../lib/fieldUtils');

const SCHOOL_LOGO_COLUMN_CANDIDATES = [
  'logo_url',
  'logo',
  'logo_path',
  'image_url',
  'logomark_url',
  'logomark',
];
const SCHOOL_BUCKET_COLUMN_CANDIDATES = [
  'logo_bucket',
  'image_bucket',
  'media_bucket',
  'storage_bucket',
];
const SIGNED_MEDIA_TTL_SECONDS = 120;

async function resolveSchoolBranding(supabase, schoolId) {
  if (!schoolId) {
    return {
      schoolName: null,
      schoolLogoUrl: null,
    };
  }

  try {
    const { data, error } = await supabase
      .from('schools')
      .select('*')
      .eq('id', schoolId)
      .maybeSingle();

    if (error || !data) {
      return {
        schoolName: null,
        schoolLogoUrl: null,
      };
    }

    const schoolName = typeof data.name === 'string' && data.name.trim()
      ? data.name.trim()
      : null;
    const rawLogoValue = pickFirstStringField(data, SCHOOL_LOGO_COLUMN_CANDIDATES);
    if (!rawLogoValue) {
      return {
        schoolName,
        schoolLogoUrl: null,
      };
    }

    if (/^https?:\/\//i.test(rawLogoValue)) {
      return {
        schoolName,
        schoolLogoUrl: rawLogoValue,
      };
    }

    const normalizedLogoPath = normalizeStoragePath(rawLogoValue);
    if (!normalizedLogoPath) {
      return {
        schoolName,
        schoolLogoUrl: null,
      };
    }

    const explicitBucket = pickFirstStringField(data, SCHOOL_BUCKET_COLUMN_CANDIDATES);
    const bucketName = explicitBucket || DEFAULT_STORAGE_BUCKET;
    const signedUrl = await createSignedStorageUrl(supabase, normalizedLogoPath, {
      bucket: bucketName,
      ttlSeconds: SIGNED_MEDIA_TTL_SECONDS,
    });

    if (signedUrl) {
      return {
        schoolName,
        schoolLogoUrl: signedUrl,
      };
    }

    return {
      schoolName,
      schoolLogoUrl: buildPublicStorageUrl(bucketName, normalizedLogoPath),
    };
  } catch (_err) {
    return {
      schoolName: null,
      schoolLogoUrl: null,
    };
  }
}

async function attachSessionUser(req, res, next) {
  const authSession = req.session && req.session.auth;

  if (authSession && authSession.user && authSession.user.id) {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authSession.user.id)
        .maybeSingle();

      if (!error && data) {
        if (typeof data.role === 'string' && data.role.trim()) {
          authSession.user.role = data.role.trim();
        }

        if (typeof data.first_name === 'string') {
          authSession.user.firstName = data.first_name;
        }

        if (typeof data.last_name === 'string') {
          authSession.user.lastName = data.last_name;
        }

        if (typeof data.email === 'string' && data.email.trim()) {
          authSession.user.email = data.email.trim();
        }

        authSession.user.schoolId = data.school_id || null;
        const media = await resolveProfileMedia(supabase, data);
        authSession.user.profileAvatarUrl = media.avatarUrl || null;

        const schoolBranding = await resolveSchoolBranding(supabase, data.school_id || null);
        authSession.user.schoolName = schoolBranding.schoolName;
        authSession.user.schoolLogoUrl = schoolBranding.schoolLogoUrl;
      }
    } catch (_err) {
      // Keep existing session role when profile lookup fails.
    }
  }

  res.locals.currentUser = authSession ? authSession.user : null;
  res.locals.user = authSession ? authSession.user : null;
  res.locals.schoolName = authSession && authSession.user ? authSession.user.schoolName : null;
  res.locals.schoolLogoUrl = authSession && authSession.user ? authSession.user.schoolLogoUrl : null;
  next();
}

function requireAuth(req, res, next) {
  if (req.session?.auth?.user) return next();
  return res.redirect('/login');
}

module.exports = { attachSessionUser, requireAuth };
