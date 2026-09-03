import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "server-only";

export const accessCookieName = "aznif_admin_access_token";
export const refreshCookieName = "aznif_admin_refresh_token";

export function isDevBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ADMIN_DEV_BYPASS === "true";
}

function supabaseUrl() {
  const value = process.env.SUPABASE_URL;
  if (!value) throw new Error("SUPABASE_URL is required for admin-web.");
  return value;
}

function supabaseAnonKey() {
  const value = process.env.SUPABASE_ANON_KEY;
  if (!value) throw new Error("SUPABASE_ANON_KEY is required for admin-web.");
  return value;
}

function supabaseServiceRoleKey() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin-web server access.");
  return value;
}

export function createServerSupabase(accessToken?: string): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}

export function createAdminSupabase(): SupabaseClient {
  const key = supabaseServiceRoleKey();
  return createClient(supabaseUrl(), key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
    },
  });
}

export const createDevServiceSupabase = createAdminSupabase;

export async function assertAdmin(accessToken: string) {
  const supabase = createServerSupabase(accessToken);
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

  if (userError || !userData.user) {
    throw new Error("Authentication required");
  }

  const { data, error } = await supabase.rpc("current_user_is_admin");

  if (error) {
    throw error;
  }

  if (data !== true) {
    throw new Error("Admin access required");
  }

  return { supabase, user: userData.user };
}
