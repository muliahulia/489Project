var express = require('express');
var router = express.Router();
const { createSupabaseAdminClient } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

router.post('/signed-upload-url', requireAuth, async (req, res) => {
  const { fileName, folder, bucket: requestedBucket } = req.body || {};

  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({ error: 'fileName is required.' });
  }

  const defaultBucket = process.env.SUPABASE_STORAGE_BUCKET;
  const bucket = typeof requestedBucket === 'string' && requestedBucket.trim()
    ? requestedBucket.trim()
    : defaultBucket;
  if (!bucket) {
    return res.status(500).json({ error: 'SUPABASE_STORAGE_BUCKET is not configured.' });
  }
  if (!/^[a-z0-9_-]+$/i.test(bucket)) {
    return res.status(400).json({ error: 'Invalid bucket name.' });
  }

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const user = req.session?.auth?.user;
    const baseFolder = typeof folder === 'string' && folder.trim() ? folder.trim() : 'uploads';
  const objectPath = `${baseFolder}/${userId}/${Date.now()}-${safeFileName}`;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(objectPath);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({
    token: data.token,
    path: objectPath,
    bucket,
  });
});

module.exports = router;
