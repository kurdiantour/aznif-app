import { accessCookieName, assertAdmin, createDevServiceSupabase, isDevBypassEnabled } from "@/lib/supabase-server";
import type { AdminPlayer } from "@/lib/types";
import { cookies } from "next/headers";
import Link from "next/link";

async function getPlayers(): Promise<AdminPlayer[]> {
  if (isDevBypassEnabled()) {
    const supabase = createDevServiceSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,player_id,username,avatar_id,points,games_played,games_won,games_lost,is_admin,created_at,updated_at,wallets(mc,gold)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return (data ?? []).map((row: any) => ({
      user_id: row.id,
      email: row.email,
      player_id: row.player_id,
      username: row.username,
      avatar_id: row.avatar_id,
      points: Number(row.points ?? 0),
      games_played: Number(row.games_played ?? 0),
      games_won: Number(row.games_won ?? 0),
      games_lost: Number(row.games_lost ?? 0),
      aznif: Number(row.wallets?.mc ?? 0),
      gold: Number(row.wallets?.gold ?? 0),
      is_admin: Boolean(row.is_admin),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  const accessToken = (await cookies()).get(accessCookieName)?.value;
  if (!accessToken) return [];
  const { supabase } = await assertAdmin(accessToken);
  const { data } = await supabase.rpc("admin_list_players", { p_search: null, p_limit: 100 });
  return (data ?? []) as AdminPlayer[];
}

export default async function DashboardPage() {
  const players = await getPlayers();
  const activePlayers = players.filter((player) => Number(player.games_played ?? 0) > 0).length;
  const totals = players.reduce(
    (acc, player) => ({
      aznif: acc.aznif + Number(player.aznif ?? 0),
      gold: acc.gold + Number(player.gold ?? 0),
      admins: acc.admins + (player.is_admin ? 1 : 0),
      wins: acc.wins + Number(player.games_won ?? 0),
      games: acc.games + Number(player.games_played ?? 0),
    }),
    { aznif: 0, gold: 0, admins: 0, wins: 0, games: 0 },
  );
  const winRate = totals.games > 0 ? Math.round((totals.wins / totals.games) * 100) : 0;
  const recentPlayers = players.slice(0, 5);

  return (
    <>
      <header className="header">
        <div>
          <h2>Welcome Back, Admin!</h2>
          <p className="muted">Here is what is happening with Aznif Domino today.</p>
        </div>
        <div className="header-actions">
          <button className="ghost-button" type="button">Previous Year</button>
          <Link className="dark-button" href="/users">View Players</Link>
        </div>
      </header>

      <section className="stats-grid">
        <div className="stat-card peach"><span>Total Players</span><strong>{players.length}</strong><small>▲ {activePlayers} active</small></div>
        <div className="stat-card green"><span>Admins</span><strong>{totals.admins}</strong><small>▲ secure access</small></div>
        <div className="stat-card blue"><span>Total Aznif</span><strong>{totals.aznif.toLocaleString()}</strong><small>▲ wallet balance</small></div>
        <div className="stat-card teal"><span>Total Gold</span><strong>{totals.gold.toLocaleString()}</strong><small>▲ premium balance</small></div>
        <div className="stat-card rose"><span>Win Rate</span><strong>{winRate}%</strong><small>● all matches</small></div>
      </section>

      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <div className="panel-title">
            <h3>Summary</h3>
            <div><span className="legend aznif-dot" /> Aznif <span className="legend gold-dot" /> Gold</div>
          </div>
          <div className="chart">
            <div className="chart-line line-a" />
            <div className="chart-line line-b" />
            <div className="chart-point"><strong>{players.length}</strong><span>Players</span></div>
          </div>
        </div>

        <div className="panel side-panel">
          <div className="panel-title">
            <h3>Top Balances</h3>
            <span>•••</span>
          </div>
          {players.slice(0, 3).map((player) => (
            <div className="compact-row" key={player.user_id}>
              <div className="mini-avatar">{(player.username || "A").slice(0, 1).toUpperCase()}</div>
              <div><strong>{player.username}</strong><span>ID: {player.player_id}</span></div>
              <b>{Number(player.aznif ?? 0).toLocaleString()}</b>
            </div>
          ))}
        </div>

        <div className="panel recent-panel">
          <div className="panel-title">
            <h3>Recent Players</h3>
            <Link href="/users">View All</Link>
          </div>
          <table className="mini-table">
            <thead>
              <tr><th>Player</th><th>Points</th><th>Aznif</th><th>Gold</th><th>Status</th></tr>
            </thead>
            <tbody>
              {recentPlayers.map((player) => (
                <tr key={player.user_id}>
                  <td>{player.username}</td>
                  <td>{Number(player.points ?? 0).toLocaleString()}</td>
                  <td>{Number(player.aznif ?? 0).toLocaleString()}</td>
                  <td>{Number(player.gold ?? 0).toLocaleString()}</td>
                  <td><span className={player.is_admin ? "pill warning" : "pill success"}>{player.is_admin ? "Admin" : "Player"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
