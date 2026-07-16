"use client";

import type { AdminPlayer } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

export default function UsersTable() {
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading players...");

  const loadPlayers = useCallback(async (nextSearch = search) => {
    setStatus("Loading players...");
    const params = new URLSearchParams();
    if (nextSearch.trim()) params.set("search", nextSearch.trim());

    const response = await fetch(`/api/admin/players?${params.toString()}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(result.error ?? "Unable to load players.");
      return;
    }

    const nextPlayers = (result.players ?? []) as AdminPlayer[];
    setPlayers(nextPlayers);
    setStatus(`${nextPlayers.length} players loaded.`);
  }, [search]);

  useEffect(() => {
    void loadPlayers("");
  }, [loadPlayers]);

  return (
    <>
      <header className="header">
        <div>
          <h2>Players</h2>
          <p className="muted">Search and review real player data. Balances and points are read-only here.</p>
        </div>
        <form className="tools" onSubmit={(event) => { event.preventDefault(); void loadPlayers(search); }}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, or Player ID" />
          <button type="submit">Search</button>
        </form>
      </header>

      <div className="status ok">{status}</div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Email</th>
              <th>Points</th>
              <th>Aznif</th>
              <th>Gold</th>
              <th>Games</th>
              <th>Wins</th>
              <th>Losses</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr key={player.user_id}>
                <td>
                  <div className="player-cell">
                    <div className="avatar">{(player.username || "A").slice(0, 1).toUpperCase()}</div>
                    <div>
                      <strong>{player.username}</strong>
                      <span>{player.player_id}</span>
                    </div>
                  </div>
                </td>
                <td>{player.email ?? "-"}</td>
                <td><span className="readonly-value">{Number(player.points ?? 0).toLocaleString()}</span></td>
                <td><span className="readonly-value">{Number(player.aznif ?? 0).toLocaleString()}</span></td>
                <td><span className="readonly-value">{Number(player.gold ?? 0).toLocaleString()}</span></td>
                <td>{Number(player.games_played ?? 0).toLocaleString()}</td>
                <td>{Number(player.games_won ?? 0).toLocaleString()}</td>
                <td>{Number(player.games_lost ?? 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
