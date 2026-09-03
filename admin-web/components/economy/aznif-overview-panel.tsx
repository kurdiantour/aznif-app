"use client";

import type { AznifEconomyOverview } from "@/lib/aznif-economy";
import Link from "next/link";
import { useEffect, useState } from "react";

function formatAmount(value: number | string | null | undefined) {
  const num = Number(value ?? 0);
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function AznifOverviewPanel() {
  const [data, setData] = useState<AznifEconomyOverview | null>(null);
  const [status, setStatus] = useState("Loading Aznif economy statistics...");

  async function loadOverview() {
    setStatus("Loading Aznif economy statistics...");
    const response = await fetch("/api/admin/economy/overview", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(result.error ?? "Unable to load economy overview.");
      return;
    }

    setData(result.overview as AznifEconomyOverview);
    setStatus("Economy overview loaded.");
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  const totalKnown = data
    ? data.currentTreasuryAznif + data.totalPlayerAznif + data.totalBurnedAznif
    : 0;

  const playerShare = totalKnown > 0 && data
    ? Math.round((data.totalPlayerAznif / totalKnown) * 100)
    : 0;
  const treasuryShare = totalKnown > 0 && data
    ? Math.round((data.currentTreasuryAznif / totalKnown) * 100)
    : 0;
  const burnShare = totalKnown > 0 && data
    ? Math.round((data.totalBurnedAznif / totalKnown) * 100)
    : 0;

  return (
    <>
      <header className="header">
        <div>
          <h2>Aznif Economy Overview</h2>
          <p className="muted">
            Real-time aggregate health and supply metrics for Aznif currency across the entire database.
          </p>
        </div>
        <div className="header-actions">
          <button className="ghost-button" type="button" onClick={() => void loadOverview()}>
            Refresh
          </button>
          <Link className="dark-button" href="/economy/transactions">
            View Transactions
          </Link>
        </div>
      </header>

      <div className={status.includes("Unable") ? "status error" : "status ok"}>{status}</div>

      {data ? (
        <section className="dashboard-grid">
          <div className="panel">
            <div className="panel-title">
              <h3>Aznif Supply Allocation</h3>
              <span>Initial Baseline: {formatAmount(data.initialSupply)}</span>
            </div>
            <div className="economy-progress-wrap">
              <div className="economy-progress-bar">
                <div className="bar-segment bar-treasury" style={{ width: `${Math.max(treasuryShare, 2)}%` }} title={`Treasury: ${treasuryShare}%`} />
                <div className="bar-segment bar-players" style={{ width: `${Math.max(playerShare, 2)}%` }} title={`Players: ${playerShare}%`} />
                <div className="bar-segment bar-burned" style={{ width: `${Math.max(burnShare, 2)}%` }} title={`Burned: ${burnShare}%`} />
              </div>
              <div className="economy-legend">
                <div><span className="legend-dot dot-treasury" /> Treasury ({treasuryShare}%)</div>
                <div><span className="legend-dot dot-players" /> Players ({playerShare}%)</div>
                <div><span className="legend-dot dot-burned" /> Burned ({burnShare}%)</div>
              </div>
            </div>

            <div className="economy-metric-rows">
              <div className="compact-metric-row">
                <div>
                  <strong>Initial Total Supply</strong>
                  <span className="muted">Minted at initialization</span>
                </div>
                <b>{formatAmount(data.initialSupply)}</b>
              </div>
              <div className="compact-metric-row">
                <div>
                  <strong>Net Distributed Supply</strong>
                  <span className="muted">Gross Distributed minus Returns</span>
                </div>
                <b>{formatAmount(data.totalPlayerAznif)}</b>
              </div>
              <div className="compact-metric-row">
                <div>
                  <strong>Total Ledger Audit Entries</strong>
                  <span className="muted">All historical records tracked</span>
                </div>
                <b>{formatAmount(data.totalLedgerEntries)}</b>
              </div>
            </div>
          </div>

          <div className="panel side-panel">
            <div className="panel-title">
              <h3>Burn Breakdown</h3>
              <Link href="/economy/treasury">View Treasury</Link>
            </div>

            <div className="burn-detail-list">
              {(() => {
                const dominoTotal = Number(data.dominoCommissionBurn ?? 0);
                const dominoTakeover = Number(data.dominoTakeoverBurn ?? 0);
                const dominoRegular = Math.max(0, dominoTotal - dominoTakeover);

                const okeyTotal = Number(data.okeyCommissionBurn ?? 0);
                const okeyTakeover = Number(data.okeyTakeoverBurn ?? 0);
                const okeyRegular = Math.max(0, okeyTotal - okeyTakeover);

                return (
                  <>
                    <div className="burn-card-mini">
                      <span className="burn-card-icon">🁡</span>
                      <div style={{ flex: 1 }}>
                        <strong>Domino Commission Burn</strong>
                        <span>Total: {formatAmount(dominoTotal)} (Regular: {formatAmount(dominoRegular)} | Takeover: {formatAmount(dominoTakeover)})</span>
                      </div>
                      <b>{formatAmount(dominoTotal)}</b>
                    </div>

                    <div className="burn-card-mini">
                      <span className="burn-card-icon">🂠</span>
                      <div style={{ flex: 1 }}>
                        <strong>Okey Commission Burn</strong>
                        <span>Total: {formatAmount(okeyTotal)} (Regular: {formatAmount(okeyRegular)} | Takeover: {formatAmount(okeyTakeover)})</span>
                      </div>
                      <b>{formatAmount(okeyTotal)}</b>
                    </div>
                  </>
                );
              })()}

              <div className="burn-card-mini">
                <span className="burn-card-icon">🔥</span>
                <div>
                  <strong>PvP Bet Burns</strong>
                  <span>Direct wager and match burns</span>
                </div>
                <b>{formatAmount(data.betBurnTotal)}</b>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
