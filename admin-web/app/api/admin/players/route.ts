import {
  accessCookieName,
  assertAdmin,
  createDevServiceSupabase,
  isDevBypassEnabled,
} from "@/lib/supabase-server";
import type { AdminPlayer } from "@/lib/types";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

async function accessTokenFromCookies() {
  return (await cookies()).get(accessCookieName)?.value;
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get("search")?.trim() || "";

  try {
    if (isDevBypassEnabled()) {
      const supabase = createDevServiceSupabase();
      let query = supabase
        .from("profiles")
        .select("id,email,player_id,username,avatar_id,points,games_played,games_won,games_lost,is_admin,created_at,updated_at")
        .eq("is_admin", false)
        .order("created_at", { ascending: false })
        .limit(100);

      if (search) {
        query = query.or(`username.ilike.%${search}%,player_id.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { data: profileRows, error: profileError } = await query;
      if (profileError) throw profileError;

      const profileIds = (profileRows ?? []).map((p: any) => p.id);
      const walletMap = new Map<string, any>();

      if (profileIds.length > 0) {
        const { data: walletRows, error: walletError } = await supabase
          .from("wallets")
          .select("user_id,mc,coin,gem")
          .in("user_id", profileIds);

        if (!walletError && walletRows) {
          walletRows.forEach((w: any) => walletMap.set(w.user_id, w));
        }
      }

      const players: AdminPlayer[] = (profileRows ?? []).map((row: any) => {
        const wallet = walletMap.get(row.id);
        return {
          user_id: row.id,
          email: row.email ?? null,
          player_id: row.player_id,
          username: row.username,
          avatar_id: row.avatar_id,
          coin: Number(wallet?.coin ?? 0),
          points: Number(row.points ?? 0),
          games_played: Number(row.games_played ?? 0),
          games_won: Number(row.games_won ?? 0),
          games_lost: Number(row.games_lost ?? 0),
          aznif: Number(wallet?.mc ?? 0),
          gem: Number(wallet?.gem ?? 0),
          is_admin: Boolean(row.is_admin),
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      });

      return NextResponse.json({ players });
    }

    const accessToken = await accessTokenFromCookies();
    if (!accessToken) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { supabase } = await assertAdmin(accessToken);
    const { data, error } = await supabase.rpc("admin_list_players", {
      p_search: search || null,
      p_limit: 100,
    });

    if (error) throw error;

    return NextResponse.json({ players: (data ?? []) as AdminPlayer[] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load players" },
      { status: 403 },
    );
  }
}
