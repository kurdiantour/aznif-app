"use client";

import type { AznifTransaction } from "@/lib/aznif-economy";
import { useCallback, useEffect, useState } from "react";

function formatAmount(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

type CategoryType = "all" | "domino" | "okey" | "transfers" | "treasury" | "burns";

const CATEGORIES: { id: CategoryType; label: string; icon?: string }[] = [
  { id: "all", label: "All" },
  { id: "domino", label: "Domino" },
  { id: "okey", label: "Okey" },
  { id: "transfers", label: "Transfers" },
  { id: "treasury", label: "Treasury/Admin" },
  { id: "burns", label: "Burns" },
];

export default function AznifTransactionsPanel() {
  const [transactions, setTransactions] = useState<AznifTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [activeCategory, setActiveCategory] = useState<CategoryType>("all");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("Loading Aznif transactions...");
  const [loading, setLoading] = useState(false);

  const loadTransactions = useCallback(async (cat = activeCategory) => {
    setLoading(true);
    setStatus("Loading Aznif transactions...");

    const params = new URLSearchParams();
    if (cat && cat !== "all") params.set("category", cat);
    if (search.trim()) params.set("search", search.trim());
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    params.set("page", String(page));
    params.set("limit", String(limit));

    const response = await fetch(`/api/admin/economy/transactions?${params.toString()}`, {
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setStatus(result.error ?? "Unable to load transactions.");
      return;
    }

    setTransactions(result.transactions ?? []);
    setTotal(result.total ?? 0);
    setStatus(`Found ${result.total ?? 0} transactions.`);
  }, [activeCategory, search, fromDate, toDate, page, limit]);

  useEffect(() => {
    void loadTransactions(activeCategory);
  }, [activeCategory, loadTransactions]);

  const handleCategoryChange = (cat: CategoryType) => {
    setActiveCategory(cat);
    setPage(1);
  };

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    void loadTransactions(activeCategory);
  };

  const handleReset = () => {
    setSearch("");
    setActiveCategory("all");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const totalPages = Math.ceil(total / limit) || 1;

  const renderBadge = (tx: AznifTransaction) => {
    const t = tx.display_type.toLowerCase();
    if (t.includes("burn")) return <span className="pill warning">{tx.display_type}</span>;
    if (t.includes("prize") || t.includes("distribution") || t.includes("refund"))
      return <span className="pill success">{tx.display_type}</span>;
    if (t.includes("return")) return <span className="pill info">{tx.display_type}</span>;
    return <span className="pill neutral">{tx.display_type}</span>;
  };

  const renderGameBadge = (game: string) => {
    switch (game) {
      case "Domino":
        return <span className="game-badge domino-badge">Domino</span>;
      case "Okey":
        return <span className="game-badge okey-badge">Okey</span>;
      case "Treasury":
        return <span className="game-badge treasury-badge">Treasury</span>;
      default:
        return <span className="game-badge platform-badge">{game}</span>;
    }
  };

  return (
    <>
      <header className="header">
        <div>
          <h2>Aznif Transactions</h2>
          <p className="muted">
            Complete transaction ledger across all game modes, treasury credits, and player transfers.
          </p>
        </div>
        <button className="dark-button" type="button" onClick={() => void loadTransactions(activeCategory)} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <div className={status.includes("Unable") ? "status error" : "status ok"}>{status}</div>

      {/* Category Navigation Tabs */}
      <div className="category-tabs-bar">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`category-tab-btn ${activeCategory === cat.id ? "active" : ""}`}
            onClick={() => handleCategoryChange(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Search & Date Filter Toolbar */}
      <section className="panel filter-panel">
        <form className="economy-filter-form simplified-filter-form" onSubmit={handleFilterSubmit}>
          <div className="filter-group flex-2">
            <label>
              Search Player or Match ID
              <input
                type="text"
                placeholder="Username, Player ID, Match ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>

          <div className="filter-group">
            <label>
              From Date
              <input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              />
            </label>
          </div>

          <div className="filter-group">
            <label>
              To Date
              <input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              />
            </label>
          </div>

          <div className="filter-actions">
            <button type="submit" className="dark-button">Search & Filter</button>
            <button type="button" className="ghost-button" onClick={handleReset}>Reset</button>
          </div>
        </form>
      </section>

      {/* Transactions Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Amount</th>
              <th>Type / Reason</th>
              <th>Game Type</th>
              <th>Match ID</th>
              <th>Date / Time</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: "36px", color: "var(--muted)" }}>
                  No Aznif transactions found for category &ldquo;{CATEGORIES.find((c) => c.id === activeCategory)?.label}&rdquo;.
                </td>
              </tr>
            ) : (
              transactions.map((tx) => {
                const isPositive = tx.signed_amount > 0;
                const isNegative = tx.signed_amount < 0;
                return (
                  <tr key={`${tx.source}-${tx.id}`}>
                    <td>
                      <div className="player-cell">
                        <div className="mini-avatar">
                          {(tx.username || "A").slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <strong>{tx.username}</strong>
                          <span>ID: {tx.player_id}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`amount-cell ${isPositive ? "amount-positive" : isNegative ? "amount-negative" : ""}`}>
                        {isPositive ? `+${formatAmount(tx.amount)}` : isNegative ? `-${formatAmount(tx.amount)}` : formatAmount(tx.amount)}
                        <span className="currency-tag"> Aznif</span>
                      </span>
                    </td>
                    <td>
                      <div>
                        {renderBadge(tx)}
                        <small className="raw-type-label">{tx.transaction_type}</small>
                      </div>
                    </td>
                    <td>{renderGameBadge(tx.game_type)}</td>
                    <td>
                      {tx.match_id ? (
                        <code className="match-id-badge" title={tx.match_id}>
                          {tx.match_id.length > 14 ? `${tx.match_id.slice(0, 14)}…` : tx.match_id}
                        </code>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      <span className="date-cell">{formatDate(tx.created_at)}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 ? (
        <div className="pagination-bar">
          <button
            type="button"
            className="ghost-button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            Page <strong>{page}</strong> of <strong>{totalPages}</strong> ({total} total transactions)
          </span>
          <button
            type="button"
            className="ghost-button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}
