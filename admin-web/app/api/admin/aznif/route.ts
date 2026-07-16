import {
  accessCookieName,
  assertAdmin,
  createDevServiceSupabase,
  isDevBypassEnabled,
} from "@/lib/supabase-server";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

async function accessTokenFromCookies() {
  return (await cookies()).get(accessCookieName)?.value;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const userId = String(body?.userId ?? "");
  const amount = Math.floor(Number(body?.amount ?? 0));

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Aznif amount must be a positive number" }, { status: 400 });
  }

  try {
    if (isDevBypassEnabled()) {
      const supabase = createDevServiceSupabase();
      const { data, error } = await supabase.rpc("admin_add_aznif", {
        p_user_id: userId,
        p_amount: amount,
      });

      if (error) throw error;

      return NextResponse.json({ ok: true, result: data });
    }

    const accessToken = await accessTokenFromCookies();
    if (!accessToken) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { supabase } = await assertAdmin(accessToken);
    const { data, error } = await supabase.rpc("admin_add_aznif", {
      p_user_id: userId,
      p_amount: amount,
    });

    if (error) throw error;

    return NextResponse.json({ ok: true, result: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to add Aznif" },
      { status: 403 },
    );
  }
}



