/**
 * @module config/supabase
 * @description Supabase client factory. Creates and exports two pre-configured
 * Supabase clients for different access levels.
 *
 * @exports {Object} clients
 * @property {import('@supabase/supabase-js').SupabaseClient} supabase
 *   Public client using the anonymous key. Used for auth token verification
 *   (e.g., getUser, signInWithPassword, signUp). Respects Row Level Security.
 * @property {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 *   Admin client using the service role key. Bypasses Row Level Security.
 *   Used for privileged operations (e.g., auth.admin.*, direct table queries).
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./index');

/**
 * Public Supabase client (anonymous key).
 * Use for user-facing auth flows and RLS-protected queries.
 *
 * @type {import('@supabase/supabase-js').SupabaseClient}
 */
const supabase = createClient(config.supabase.url, config.supabase.anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

/**
 * Admin Supabase client (service role key).
 * Bypasses RLS — use only for server-side admin operations.
 *
 * @type {import('@supabase/supabase-js').SupabaseClient}
 */
const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
);

module.exports = { supabase, supabaseAdmin };
