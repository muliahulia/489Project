const DEFAULT_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'media';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 120;

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

function resolveStorageBucketName(bucket) {
  return typeof bucket === 'string' && bucket.trim() ? bucket.trim() : DEFAULT_STORAGE_BUCKET;
}

function buildPublicStorageUrl(bucket, objectPath, options = {}) {
  const path = normalizeStoragePath(objectPath);
  const bucketName = resolveStorageBucketName(bucket);
  const supabaseUrl = typeof options.supabaseUrl === 'string'
    ? options.supabaseUrl.trim()
    : (typeof process.env.SUPABASE_URL === 'string' ? process.env.SUPABASE_URL.trim() : '');

  if (!path || !bucketName || !supabaseUrl) {
    return null;
  }

  const encodedPath = path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucketName)}/${encodedPath}`;
}

async function createSignedStorageUrl(supabase, objectPath, options = {}) {
  const path = normalizeStoragePath(objectPath);
  if (!path || !supabase || !supabase.storage) {
    return null;
  }

  const bucketName = resolveStorageBucketName(options.bucket);
  const ttlSeconds = Number.isInteger(options.ttlSeconds) && options.ttlSeconds > 0
    ? options.ttlSeconds
    : DEFAULT_SIGNED_URL_TTL_SECONDS;

  try {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(path, ttlSeconds);

    if (error || !data || !data.signedUrl) {
      return null;
    }

    return data.signedUrl;
  } catch (_err) {
    return null;
  }
}

module.exports = {
  DEFAULT_STORAGE_BUCKET,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  normalizeStoragePath,
  buildPublicStorageUrl,
  createSignedStorageUrl,
};
