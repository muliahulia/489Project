const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function createSupabaseAnonClient() {
  assertEnv('SUPABASE_URL', supabaseUrl);
  assertEnv('SUPABASE_PUBLISHABLE_KEY (or legacy SUPABASE_ANON_KEY)', supabasePublishableKey);

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createSupabaseAdminClient() {
  assertEnv('SUPABASE_URL', supabaseUrl);
  assertEnv('SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)', supabaseSecretKey);

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

module.exports = {
  createSupabaseAnonClient,
  createSupabaseAdminClient,
};