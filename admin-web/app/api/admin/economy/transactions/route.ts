import {
  accessCookieName,
  assertAdmin,
  createAdminSupabase,
  createDevServiceSupabase,
  isDevBypassEnabled,
} from "@/lib/supabase-server";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAznifTransactions } from "@/lib/aznif-economy";

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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category") || undefined;
    const type = searchParams.get("type") || undefined;
    const game = searchParams.get("game") || undefined;
    const search = searchParams.get("search") || undefined;
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;
    const page = Number(searchParams.get("page") || 1);
    const limit = Number(searchParams.get("limit") || 50);

    const filters = { category, type, game, search, fromDate, toDate, page, limit };

    if (isDevBypassEnabled()) {
      const supabase = createDevServiceSupabase();
      const result = await getAznifTransactions(supabase, filters);
      return NextResponse.json(result);
    }

    const accessToken = await accessTokenFromCookies();
    if (!accessToken) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    await assertAdmin(accessToken);
    const service = createAdminSupabase();
    const result = await getAznifTransactions(service, filters);
    return NextResponse.json(result);
  } catch (error) {
    const message = extractErrorMessage(error, "Unable to load Aznif transactions");
    if (process.env.NODE_ENV !== "production") {
      console.error("Admin Aznif transactions load failed:", error);
    }
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
