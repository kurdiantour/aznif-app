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
  returnedTotal?: number;
  burnedTotal: number;
  betBurnTotal?: number;
  dominoCommissionBurn?: number;
  dominoTakeoverBurn?: number;
  dominoRegularBurn?: number;
  okeyCommissionBurn?: number;
  okeyTakeoverBurn?: number;
  okeyRegularBurn?: number;
  totalTakeoverBurn?: number;
  totalLedgerEntries: number;
  createdAt: string;
  updatedAt: string;
  ledger: TreasuryLedgerEntry[];
};

const TREASURY_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "distribution", label: "Distribution" },
  { id: "return_to_admin", label: "Return to Admin" },
  { id: "domino_burn", label: "Domino Burn" },
  { id: "okey_burn", label: "Okey Burn" },
  { id: "bet_burn", label: "Bet Burn" },
  { id: "takeover_burn", label: "Takeover Burn" },
  { id: "initialization", label: "Initialization" },
];

function formatAmount(value: number | string | null | undefined) {
  const num = Number(value ?? 0);
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export default function TreasuryPanel() {
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [status, setStatus] = useState("Loading treasury...");
  const [activeCategory, setActiveCategory] = useState("all");

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

  const filteredLedger = (treasury?.ledger ?? []).filter((entry) => {
    if (activeCategory === "all") return true;
    const type = (entry.entry_type || "").toLowerCase();
    const isDomino =
      entry.id.startsWith("domino:") ||
      entry.username === "Domino Match" ||
      (entry.metadata as any)?.source === "domino_commission_burn";
    const isOkey =
      entry.id.startsWith("okey:") ||
      entry.username === "Okey Match" ||
      (entry.metadata as any)?.source === "okey_house_commission";
    const isTakeover =
      (entry.metadata as any)?.event === "takeover_prize_burn" ||
      (entry.metadata as any)?.is_takeover === true;
    const isBetBurn = type === "burn" && !isDomino && !isOkey;

    if (activeCategory === "distribution") return type === "distribution";
    if (activeCategory === "return_to_admin") return type === "return_to_admin" || type === "return";
    if (activeCategory === "domino_burn") return isDomino;
    if (activeCategory === "okey_burn") return isOkey;
    if (activeCategory === "bet_burn") return isBetBurn;
    if (activeCategory === "takeover_burn") return isTakeover;
    if (activeCategory === "initialization") return type === "initialization";
    return true;
  });

  const getBadgeClass = (entry: TreasuryLedgerEntry) => {
    const type = (entry.entry_type || "").toLowerCase();
    const isDomino =
      entry.id.startsWith("domino:") || (entry.metadata as any)?.source === "domino_commission_burn";
    const isOkey =
      entry.id.startsWith("okey:") || (entry.metadata as any)?.source === "okey_house_commission";
    const isTakeover =
      (entry.metadata as any)?.event === "takeover_prize_burn" ||
      (entry.metadata as any)?.is_takeover === true;

    if (isTakeover) return "pill warning";
    if (isDomino || isOkey || type === "burn") return "pill warning";
    if (type === "distribution") return "pill success";
    if (type === "return_to_admin" || type === "return") return "pill info";
    if (type === "initialization") return "pill neutral";
    return "pill neutral";
  };

  const getDisplayType = (entry: TreasuryLedgerEntry) => {
    const isDomino =
      entry.id.startsWith("domino:") || (entry.metadata as any)?.source === "domino_commission_burn";
    const isOkey =
      entry.id.startsWith("okey:") || (entry.metadata as any)?.source === "okey_house_commission";
    const isTakeover =
      (entry.metadata as any)?.event === "takeover_prize_burn" ||
      (entry.metadata as any)?.is_takeover === true;

    if (isTakeover) {
      if (isDomino) return "domino_takeover_burn";
      if (isOkey) return "okey_takeover_burn";
      return "takeover_burn";
    }
    if (isDomino) return "domino_burn";
    if (isOkey) return "okey_burn";
    if (entry.entry_type === "burn") return "bet_burn";
    return entry.entry_type;
  };

  return (
    <>
      <header className="header">
        <div>
          <h2>Aznif Treasury</h2>
          <p className="muted">Track supply, distribution, returns, burn, and ledger activity for Aznif.</p>
        </div>
        <button className="dark-button" type="button" onClick={() => void loadTreasury()}>Refresh</button>
      </header>

      <div className={status.includes("Unable") ? "status error" : "status ok"}>{status}</div>

      {treasury ? (
        <>
          {/* Top Row: Supply, Treasury & Player Balances (5 cards) */}
          <section className="stats-grid treasury-stats">
            <div className="stat-card blue">
              <span>Initial Supply</span>
              <strong>{formatAmount(treasury.initialSupply)}</strong>
              <small>baseline</small>
            </div>
            <div className="stat-card green">
              <span>Current Treasury</span>
              <strong>{formatAmount(treasury.currentBalance)}</strong>
              <small>available balance</small>
            </div>
            <div className="stat-card teal">
              <span>Gross Distributed</span>
              <strong>{formatAmount(treasury.grossDistributedTotal ?? treasury.distributedTotal)}</strong>
              <small>total issued to players</small>
            </div>
            <div className="stat-card peach">
              <span>Returned to Treasury</span>
              <strong>{formatAmount(treasury.returnedTotal ?? 0)}</strong>
              <small>returned via transfers</small>
            </div>
            <div className="stat-card teal">
              <span>Active in Player Wallets</span>
              <strong>{formatAmount(treasury.netDistributedTotal ?? treasury.distributedTotal)}</strong>
              <small>held by non-admin users</small>
            </div>
          </section>

          {/* Bottom Row: Burn Breakdown (4 cards: Domino | Okey | Bet Burns | Total Burned) */}
          <section className="stats-grid burn-breakdown-stats">
            {(() => {
              const dominoTotal = Number(treasury.dominoCommissionBurn ?? 0);
              const dominoTakeover = Number(treasury.dominoTakeoverBurn ?? 0);
              const dominoRegular = Math.max(0, dominoTotal - dominoTakeover);

              const okeyTotal = Number(treasury.okeyCommissionBurn ?? 0);
              const okeyTakeover = Number(treasury.okeyTakeoverBurn ?? 0);
              const okeyRegular = Math.max(0, okeyTotal - okeyTakeover);

              return (
                <>
                  <div className="stat-card rose">
                    <span>Domino Commission Burn</span>
                    <strong>{formatAmount(dominoTotal)}</strong>
                    <div style={{ marginTop: "6px", fontSize: "0.78rem", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span>• Regular Burn: <b>{formatAmount(dominoRegular)}</b></span>
                      <span>• Takeover Burn: <b>{formatAmount(dominoTakeover)}</b></span>
                    </div>
                  </div>

                  <div className="stat-card rose">
                    <span>Okey Commission Burn</span>
                    <strong>{formatAmount(okeyTotal)}</strong>
                    <div style={{ marginTop: "6px", fontSize: "0.78rem", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span>• Regular Burn: <b>{formatAmount(okeyRegular)}</b></span>
                      <span>• Takeover Burn: <b>{formatAmount(okeyTakeover)}</b></span>
                    </div>
                  </div>
                </>
              );
            })()}

            <div className="stat-card rose">
              <span>Bet Burns</span>
              <strong>{formatAmount(treasury.betBurnTotal ?? 0)}</strong>
              <small>PvP bet burn</small>
            </div>

            <div className="stat-card rose">
              <span>Total Burned</span>
              <strong>{formatAmount(treasury.burnedTotal)}</strong>
              <small>removed permanently</small>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <h3>Treasury Ledger</h3>
              <span>Updated {formatDate(treasury.updatedAt)}</span>
            </div>

            {/* Treasury Ledger Filter Buttons */}
            <div className="category-tabs-bar" style={{ marginBottom: "16px" }}>
              {TREASURY_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`category-tab-btn ${activeCategory === cat.id ? "active" : ""}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
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
                  {filteredLedger.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "var(--muted)" }}>
                        No ledger entries found for this category.
                      </td>
                    </tr>
                  ) : (
                    filteredLedger.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <span className={getBadgeClass(entry)}>
                            {getDisplayType(entry)}
                          </span>
                        </td>
                        <td>{formatAmount(entry.amount)}</td>
                        <td>{Number(entry.treasury_delta ?? 0).toLocaleString()}</td>
                        <td>{entry.username ? `${entry.username} (${entry.player_id})` : "-"}</td>
                        <td>{entry.wallet_transaction_id ? entry.wallet_transaction_id.slice(0, 8) : "-"}</td>
                        <td>{formatDate(entry.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
