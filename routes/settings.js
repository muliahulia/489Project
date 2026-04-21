var express = require('express');
var router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createSupabaseAdminClient } = require('../lib/supabase');
const {
  DEFAULT_STORAGE_BUCKET,
  fetchProfileColumnSet,
  normalizeStoragePath,
  resolveProfileMedia,
} = require('../lib/profileMedia');

router.get('/', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', sessionUser.id)
    .single();

  const profile = data || {};
  const columnSet = await fetchProfileColumnSet(supabase);
  const media = await resolveProfileMedia(supabase, profile, { columnSet });

  res.render('settings', {
    user: sessionUser,
    profile,
    profileAvatarUrl: media.avatarUrl,
    profileBannerUrl: media.bannerUrl,
    profileAvatarPath: media.avatarPath,
    profileBannerPath: media.bannerPath,
    storageBucket: DEFAULT_STORAGE_BUCKET,
    supabaseUrl: process.env.SUPABASE_URL || '',
  });
});

router.post('/update', requireAuth, async (req, res) => {
  const sessionUser = req.session.auth.user;
  const first_name = typeof req.body.first_name === 'string' ? req.body.first_name.trim() : '';
  const last_name = typeof req.body.last_name === 'string' ? req.body.last_name.trim() : '';
  const bio = typeof req.body.bio === 'string' ? req.body.bio.trim() : '';
  const rawAvatarPath = typeof req.body.avatarPath === 'string' ? req.body.avatarPath.trim() : '';
  const rawBannerPath = typeof req.body.bannerPath === 'string' ? req.body.bannerPath.trim() : '';

  const supabase = createSupabaseAdminClient();
  const columnSet = await fetchProfileColumnSet(supabase);
  const payload = {
    id: sessionUser.id,
    email: sessionUser.email,
    first_name,
    last_name: last_name || null,
    bio: bio || null,
  };

  const avatarColumnCandidates = [
    'avatar_path',
    'profile_photo_path',
    'profile_image_path',
    'avatar_url',
    'profile_photo_url',
    'profile_image_url',
    'image_url',
  ];
  const bannerColumnCandidates = [
    'banner_path',
    'cover_path',
    'cover_image_path',
    'banner_url',
    'cover_url',
    'cover_image_url',
    'banner_image_url',
  ];
  const avatarBucketColumnCandidates = ['avatar_bucket', 'profile_photo_bucket', 'profile_image_bucket'];
  const bannerBucketColumnCandidates = ['banner_bucket', 'cover_bucket', 'cover_image_bucket'];
  const sharedBucketColumnCandidates = ['media_bucket', 'storage_bucket', 'image_bucket', 'profile_bucket'];

  const pickColumn = (candidates) => candidates.find((name) => columnSet.has(name)) || null;
  const avatarColumn = pickColumn(avatarColumnCandidates);
  const bannerColumn = pickColumn(bannerColumnCandidates);
  const avatarBucketColumn = pickColumn(avatarBucketColumnCandidates);
  const bannerBucketColumn = pickColumn(bannerBucketColumnCandidates);
  const sharedBucketColumn = pickColumn(sharedBucketColumnCandidates);

  if (avatarColumn) {
    if (!rawAvatarPath) {
      payload[avatarColumn] = null;
    } else {
      const normalized = normalizeStoragePath(rawAvatarPath);
      if (!normalized) {
        return res.redirect('/settings');
      }
      payload[avatarColumn] = normalized;
    }
  }

  if (bannerColumn) {
    if (!rawBannerPath) {
      payload[bannerColumn] = null;
    } else {
      const normalized = normalizeStoragePath(rawBannerPath);
      if (!normalized) {
        return res.redirect('/settings');
      }
      payload[bannerColumn] = normalized;
    }
  }

  const hasAvatarMedia = Boolean(avatarColumn && payload[avatarColumn]);
  const hasBannerMedia = Boolean(bannerColumn && payload[bannerColumn]);

  if (hasAvatarMedia && avatarBucketColumn) {
    payload[avatarBucketColumn] = DEFAULT_STORAGE_BUCKET;
  }

  if (hasBannerMedia && bannerBucketColumn) {
    payload[bannerBucketColumn] = DEFAULT_STORAGE_BUCKET;
  }

  if ((hasAvatarMedia || hasBannerMedia) && sharedBucketColumn) {
    payload[sharedBucketColumn] = DEFAULT_STORAGE_BUCKET;
  }
  
  const { error } = await supabase
    .from('profiles')
    .upsert(payload);

  if (error) {
    console.error('Settings update error:', error);
    return res.redirect('/settings');
  }

  if (req.session.auth && req.session.auth.user) {
    req.session.auth.user.firstName = first_name;
    req.session.auth.user.lastName = last_name;
    req.session.auth.user.bio = bio;
  }

  return res.redirect('/profile');
});

module.exports = router;
