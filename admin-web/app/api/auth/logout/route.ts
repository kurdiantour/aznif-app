import { accessCookieName, refreshCookieName } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(accessCookieName);
  response.cookies.delete(refreshCookieName);
  return response;
}
