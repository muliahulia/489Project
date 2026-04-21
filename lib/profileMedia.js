const DEFAULT_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'media';
const SIGNED_MEDIA_TTL_SECONDS = 120;
const PROFILE_COLUMN_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedProfileColumnSet = null;
let cachedProfileColumnSetAt = 0;

const AVATAR_COLUMN_CANDIDATES = [
  'avatar_path',
  'profile_photo_path',
  'profile_image_path',
  'avatar_url',
  'profile_photo_url',
  'profile_image_url',
  'image_url',
];

const BANNER_COLUMN_CANDIDATES = [
  'banner_path',
  'cover_path',
  'cover_image_path',
  'banner_url',
  'cover_url',
  'cover_image_url',
  'banner_image_url',
];

const AVATAR_BUCKET_COLUMN_CANDIDATES = [
  'avatar_bucket',
  'profile_photo_bucket',
  'profile_image_bucket',
];

const BANNER_BUCKET_COLUMN_CANDIDATES = [
  'banner_bucket',
  'cover_bucket',
  'cover_image_bucket',
];

const SHARED_BUCKET_COLUMN_CANDIDATES = [
  'media_bucket',
  'storage_bucket',
  'image_bucket',
  'profile_bucket',
];

function firstExistingColumn(columnSet, preferredColumns) {
  if (!columnSet || !(columnSet instanceof Set)) {
    return null;
  }

  for (const columnName of preferredColumns) {
    if (columnSet.has(columnName)) {
      return columnName;
    }
  }

  return null;
}

function normalizeStoragePath(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const noLeadingSlash = trimmed.replace(/^\/+/, '');
  if (!noLeadingSlash || /(^|\/)\.\.(\/|$)/.test(noLeadingSlash)) {
    return null;
  }

  return noLeadingSlash;
}

function pickStringField(row, columnName) {
  if (!row || !columnName) {
    return '';
  }

  const value = row[columnName];
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function resolveProfileMediaColumns(columnSet) {
  return {
    avatarColumn: firstExistingColumn(columnSet, AVATAR_COLUMN_CANDIDATES),
    bannerColumn: firstExistingColumn(columnSet, BANNER_COLUMN_CANDIDATES),
    avatarBucketColumn: firstExistingColumn(columnSet, AVATAR_BUCKET_COLUMN_CANDIDATES),
    bannerBucketColumn: firstExistingColumn(columnSet, BANNER_BUCKET_COLUMN_CANDIDATES),
    sharedBucketColumn: firstExistingColumn(columnSet, SHARED_BUCKET_COLUMN_CANDIDATES),
  };
}

async function fetchProfileColumnSet(supabase) {
  const now = Date.now();
  if (
    cachedProfileColumnSet
    && now - cachedProfileColumnSetAt < PROFILE_COLUMN_CACHE_TTL_MS
  ) {
    return new Set(cachedProfileColumnSet);
  }

  const coreColumns = [
    'id',
    'first_name',
    'last_name',
    'email',
    'bio',
    'role',
    'created_at',
  ];
  const fallbackColumns = new Set(coreColumns);
  const probeCandidates = [
    ...new Set([
      ...AVATAR_COLUMN_CANDIDATES,
      ...BANNER_COLUMN_CANDIDATES,
      ...AVATAR_BUCKET_COLUMN_CANDIDATES,
      ...BANNER_BUCKET_COLUMN_CANDIDATES,
      ...SHARED_BUCKET_COLUMN_CANDIDATES,
    ]),
  ];

  const { data, error } = await supabase
    .from('information_schema.columns')
    .select('column_name')
    .eq('table_schema', 'public')
    .eq('table_name', 'profiles');

  if (!error && Array.isArray(data) && data.length > 0) {
    const detected = new Set(data.map((row) => row.column_name).filter(Boolean));
    cachedProfileColumnSet = new Set(detected);
    cachedProfileColumnSetAt = now;
    return detected;
  }

  for (const columnName of probeCandidates) {
    const probe = await supabase
      .from('profiles')
      .select(columnName)
      .limit(1);

    if (!probe.error) {
      fallbackColumns.add(columnName);
      continue;
    }

    if (
      typeof probe.error.message === 'string'
      && probe.error.message.toLowerCase().includes('does not exist')
    ) {
      continue;
    }
  }

  cachedProfileColumnSet = new Set(fallbackColumns);
  cachedProfileColumnSetAt = now;
  return fallbackColumns;
}

async function buildSignedMediaUrl(supabase, bucket, rawValue) {
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const path = normalizeStoragePath(trimmed);
  if (!path) {
    return null;
  }

  const storageBucket =
    typeof bucket === 'string' && bucket.trim() ? bucket.trim() : DEFAULT_STORAGE_BUCKET;

  try {
    const { data, error } = await supabase.storage
      .from(storageBucket)
      .createSignedUrl(path, SIGNED_MEDIA_TTL_SECONDS);

    if (error || !data || !data.signedUrl) {
      return null;
    }

    return data.signedUrl;
  } catch (_err) {
    return null;
  }
}

async function resolveProfileMedia(supabase, profileRow, options = {}) {
  const row = profileRow || {};
  const columnSet = options.columnSet || (await fetchProfileColumnSet(supabase));
  const columns = resolveProfileMediaColumns(columnSet);
  const avatarBucket = DEFAULT_STORAGE_BUCKET;
  const bannerBucket = DEFAULT_STORAGE_BUCKET;

  const avatarRaw = pickStringField(row, columns.avatarColumn);
  const bannerRaw = pickStringField(row, columns.bannerColumn);

  return {
    columns,
    storageBucket: DEFAULT_STORAGE_BUCKET,
    avatarBucket,
    bannerBucket,
    avatarPath: normalizeStoragePath(avatarRaw) || '',
    bannerPath: normalizeStoragePath(bannerRaw) || '',
    avatarUrl: await buildSignedMediaUrl(supabase, avatarBucket, avatarRaw),
    bannerUrl: await buildSignedMediaUrl(supabase, bannerBucket, bannerRaw),
  };
}

async function resolveProfileMediaMap(supabase, profileRows, options = {}) {
  const rows = Array.isArray(profileRows) ? profileRows.filter(Boolean) : [];
  const columnSet = options.columnSet || (await fetchProfileColumnSet(supabase));
  const mediaEntries = await Promise.all(
    rows.map(async (row) => {
      const media = await resolveProfileMedia(supabase, row, { columnSet });
      return [row.id, media];
    })
  );

  return new Map(mediaEntries.filter(([id]) => Boolean(id)));
}

module.exports = {
  DEFAULT_STORAGE_BUCKET,
  fetchProfileColumnSet,
  firstExistingColumn,
  normalizeStoragePath,
  resolveProfileMediaColumns,
  resolveProfileMedia,
  resolveProfileMediaMap,
};
