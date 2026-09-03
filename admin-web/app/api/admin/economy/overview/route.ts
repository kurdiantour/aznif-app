import {
  accessCookieName,
  assertAdmin,
  createAdminSupabase,
  createDevServiceSupabase,
  isDevBypassEnabled,
} from "@/lib/supabase-server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAznifEconomyOverview } from "@/lib/aznif-economy";
import { getRemoteTreasuryReport } from "@/lib/treasury-report";

async function accessTokenFromCookies() {
  return (await cookies()).get(accessCookieName)?.value;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    if ("message" in error && typeof (error as any).message === "string") {
      return (error as any).message;
    }
    if ("error" in error && typeof (error as any).error === "string") {
      return (error as any).error;
    }
  }
  return fallback;
}

export async function GET() {
  try {
    if (isDevBypassEnabled()) {
      const supabase = createDevServiceSupabase();
      const rawTreasury = await getRemoteTreasuryReport(supabase);
      const overview = await getAznifEconomyOverview(supabase, rawTreasury);
      return NextResponse.json({ overview });
    }

    const accessToken = await accessTokenFromCookies();
    if (!accessToken) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { supabase } = await assertAdmin(accessToken);
    const service = createAdminSupabase();
    const rawTreasury = await getRemoteTreasuryReport(supabase, service);
    const overview = await getAznifEconomyOverview(service, rawTreasury);

    return NextResponse.json({ overview });
  } catch (error) {
    const message = extractErrorMessage(error, "Unable to load Aznif economy overview");
    if (process.env.NODE_ENV !== "production") {
      console.error("Admin Aznif economy overview load failed:", error);
    }
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
