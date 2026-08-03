"use client";

import type { AdminPlayer } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function AddAznifForm() {
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("Search for a player to add Aznif.");
  const [treasuryBalance, setTreasuryBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedPlayer = useMemo(
    () => players.find((player) => player.user_id === selectedUserId) ?? null,
    [players, selectedUserId],
  );

  async function loadTreasuryBalance() {
    const response = await fetch("/api/admin/treasury", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      setTreasuryBalance(Number(result.treasury?.currentBalance ?? 0));
    }
  }

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
    setSelectedUserId((current) => current || nextPlayers[0]?.user_id || "");
    setStatus(`${nextPlayers.length} players loaded.`);
  }, [search]);

  useEffect(() => {
    void loadPlayers("");
    void loadTreasuryBalance();
  }, [loadPlayers]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericAmount = Math.floor(Number(amount));

    if (!selectedUserId) {
      setStatus("Select a player first.");
      return;
    }

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setStatus("Enter a positive Aznif amount.");
      return;
    }

    setLoading(true);
    setStatus("Adding Aznif...");

    const response = await fetch("/api/admin/aznif", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedUserId, amount: numericAmount }),
    });
    const result = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setStatus(result.error ?? "Unable to add Aznif.");
      return;
    }

    setAmount("");
    setStatus(`Added ${numericAmount.toLocaleString()} Aznif to ${selectedPlayer?.username ?? "player"}.`);
    await loadPlayers(search);
    await loadTreasuryBalance();
  }

  return (
    <>
      <header className="header">
        <div>
          <h2>Add Aznif</h2>
          <p className="muted">Credit Aznif from the Treasury to a selected player. Coin, Gem and Points cannot be edited here.</p>
        </div>
        <form className="tools" onSubmit={(event) => { event.preventDefault(); void loadPlayers(search); }}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, or Player ID" />
          <button type="submit">Search</button>
        </form>
      </header>

      <div className={status.includes("Unable") || status.includes("Enter") || status.includes("Select") || status.includes("Insufficient") ? "status error" : "status ok"}>{status}</div>

      <section className="aznif-grid">
        <div className="panel form-panel">
          <div className="panel-title">
            <h3>Credit Player</h3>
            <span>Treasury: {treasuryBalance === null ? "-" : treasuryBalance.toLocaleString()}</span>
          </div>
          <form className="form" onSubmit={submit}>
            <label>
              Player
              <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} required>
                {players.map((player) => (
                  <option value={player.user_id} key={player.user_id}>
                    {player.username} - {player.player_id} - {Number(player.aznif ?? 0).toLocaleString()} Aznif
                  </option>
                ))}
              </select>
            </label>
            <label>
              Aznif Amount
              <input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount to add" required />
            </label>
            <button className="dark-button" type="submit" disabled={loading || !selectedUserId}>{loading ? "Adding" : "Add Aznif"}</button>
          </form>
        </div>

        <div className="panel">
          <div className="panel-title">
            <h3>Selected Player</h3>
          </div>
          {selectedPlayer ? (
            <div className="selected-player">
              <div className="mini-avatar">{(selectedPlayer.username || "A").slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{selectedPlayer.username}</strong>
                <span>{selectedPlayer.player_id}</span>
              </div>
              <dl>
                <div><dt>Email</dt><dd>{selectedPlayer.email ?? "-"}</dd></div>
                <div><dt>Current Aznif</dt><dd>{Number(selectedPlayer.aznif ?? 0).toLocaleString()}</dd></div>
                <div><dt>Gem</dt><dd>{Number(selectedPlayer.gem ?? 0).toLocaleString()}</dd></div>
                <div><dt>Coin</dt><dd>{Number(selectedPlayer.coin ?? 0).toLocaleString()}</dd></div>
                <div><dt>Points</dt><dd>{Number(selectedPlayer.points ?? 0).toLocaleString()}</dd></div>
              </dl>
            </div>
          ) : (
            <p className="muted">No player selected.</p>
          )}
        </div>
      </section>
    </>
  );
}
