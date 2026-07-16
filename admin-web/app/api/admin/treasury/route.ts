import {
  accessCookieName,
  assertAdmin,
  createDevServiceSupabase,
  isDevBypassEnabled,
} from "@/lib/supabase-server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

async function accessTokenFromCookies() {
  return (await cookies()).get(accessCookieName)?.value;
}

export async function GET() {
  try {
    if (isDevBypassEnabled()) {
      const supabase = createDevServiceSupabase();
      const { data, error } = await supabase.rpc("admin_get_aznif_treasury", { p_limit: 50 });
      if (error) throw error;
      return NextResponse.json({ treasury: data });
    }

    const accessToken = await accessTokenFromCookies();
    if (!accessToken) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { supabase } = await assertAdmin(accessToken);
    const { data, error } = await supabase.rpc("admin_get_aznif_treasury", { p_limit: 50 });
    if (error) throw error;

    return NextResponse.json({ treasury: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load treasury";
    if (process.env.NODE_ENV !== "production") {
      console.error("Admin treasury load failed:", error);
    }
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
