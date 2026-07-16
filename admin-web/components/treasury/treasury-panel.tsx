"use client";

import { useEffect, useState } from "react";

type TreasuryLedgerEntry = {
  id: string;
  entry_type: string;
  amount: number;
  treasury_delta: number;
  user_id: string | null;
  username: string | null;
  player_id: string | null;
  wallet_transaction_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type Treasury = {
  initialSupply: number;
  currentBalance: number;
  distributedTotal: number;
  grossDistributedTotal?: number;
  netDistributedTotal?: number;
  burnedTotal: number;
  totalLedgerEntries: number;
  createdAt: string;
  updatedAt: string;
  ledger: TreasuryLedgerEntry[];
};

function formatAmount(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export default function TreasuryPanel() {
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [status, setStatus] = useState("Loading treasury...");

  async function loadTreasury() {
    setStatus("Loading treasury...");
    const response = await fetch("/api/admin/treasury", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(result.error ?? "Unable to load treasury.");
      return;
    }

    setTreasury(result.treasury as Treasury);
    setStatus("Treasury loaded.");
  }

  useEffect(() => {
    void loadTreasury();
  }, []);

  return (
    <>
      <header className="header">
        <div>
          <h2>Aznif Treasury</h2>
          <p className="muted">Track supply, distribution, burn, and ledger activity for Aznif.</p>
        </div>
        <button className="dark-button" type="button" onClick={() => void loadTreasury()}>Refresh</button>
      </header>

      <div className={status.includes("Unable") ? "status error" : "status ok"}>{status}</div>

      {treasury ? (
        <>
          <section className="stats-grid treasury-stats">
            <div className="stat-card blue"><span>Initial Supply</span><strong>{formatAmount(treasury.initialSupply)}</strong><small>baseline</small></div>
            <div className="stat-card green"><span>Current Treasury</span><strong>{formatAmount(treasury.currentBalance)}</strong><small>available</small></div>
            <div className="stat-card teal"><span>Net Distributed</span><strong>{formatAmount(treasury.netDistributedTotal ?? treasury.distributedTotal)}</strong><small>remaining with users</small></div>
            <div className="stat-card rose"><span>Burned</span><strong>{formatAmount(treasury.burnedTotal)}</strong><small>removed forever</small></div>
            <div className="stat-card peach"><span>Ledger Entries</span><strong>{formatAmount(treasury.totalLedgerEntries)}</strong><small>auditable</small></div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <h3>Treasury Ledger</h3>
              <span>Updated {formatDate(treasury.updatedAt)}</span>
            </div>
            <div className="table-wrap flat-table-wrap">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Treasury Delta</th>
                    <th>User</th>
                    <th>Wallet TX</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {treasury.ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td><span className={entry.entry_type === "burn" ? "pill warning" : "pill success"}>{entry.entry_type}</span></td>
                      <td>{formatAmount(entry.amount)}</td>
                      <td>{Number(entry.treasury_delta ?? 0).toLocaleString()}</td>
                      <td>{entry.username ? `${entry.username} (${entry.player_id})` : "-"}</td>
                      <td>{entry.wallet_transaction_id ? entry.wallet_transaction_id.slice(0, 8) : "-"}</td>
                      <td>{formatDate(entry.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}


