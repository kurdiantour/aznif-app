import {
  accessCookieName,
  assertAdmin,
  createAdminSupabase,
  createDevServiceSupabase,
  isDevBypassEnabled,
} from "@/lib/supabase-server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRemoteTreasuryReport } from "@/lib/treasury-report";

async function accessTokenFromCookies() {
  return (await cookies()).get(accessCookieName)?.value;
}

export async function GET() {
  try {
    if (isDevBypassEnabled()) {
      const supabase = createDevServiceSupabase();
      const treasury = await getRemoteTreasuryReport(supabase);
      return NextResponse.json({ totalEarned: Number(treasury.burnedTotal ?? 0) });
    }

    const accessToken = await accessTokenFromCookies();
    if (!accessToken) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { supabase } = await assertAdmin(accessToken);
    const service = createAdminSupabase();
    const treasury = await getRemoteTreasuryReport(supabase, service);

    return NextResponse.json({ totalEarned: Number(treasury.burnedTotal ?? 0) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load commission income" },
      { status: 403 },
    );
  }
}
