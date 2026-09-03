"use client";

import { useEffect, useState } from "react";

type LocalWithdrawal = {
  id: string;
  amount: number;
  notes: string;
  created_at: string;
};

const STORAGE_KEY = "aznif_admin_commission_withdrawals";
const PIN_STORAGE_KEY = "aznif_commission_security_pin";

function formatAmount(value: number | string | null | undefined) {
  const num = Number(value ?? 0);
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export default function CommissionIncomePanel() {
  const [totalEarned, setTotalEarned] = useState<number | null>(null);
  const [withdrawals, setWithdrawals] = useState<LocalWithdrawal[]>([]);
  const [status, setStatus] = useState("Loading commission income...");

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawNotes, setWithdrawNotes] = useState("");
  const [formError, setFormError] = useState("");

  // Delete Flow States
  const [targetWithdrawal, setTargetWithdrawal] = useState<LocalWithdrawal | null>(null);
  const [pinStepOpen, setPinStepOpen] = useState(false);
  const [inputPin, setInputPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [confirmStepOpen, setConfirmStepOpen] = useState(false);

  // Load withdrawals from browser localStorage
  function loadLocalWithdrawals() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setWithdrawals(parsed);
          return;
        }
      }
    } catch (e) {
      console.warn("Could not read withdrawals from localStorage:", e);
    }
    setWithdrawals([]);
  }

  // Load Total Burned directly from the Treasury API
  async function loadTotalEarned() {
    setStatus("Loading commission income...");
    try {
      const res = await fetch("/api/admin/treasury", { cache: "no-store" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(result.error ?? "Unable to load treasury data.");
        return;
      }
      setTotalEarned(Number(result?.treasury?.burnedTotal ?? 0));
      setStatus("Commission income loaded.");
    } catch (err) {
      setStatus("Error loading treasury burn data.");
    }
  }

  useEffect(() => {
    loadLocalWithdrawals();
    void loadTotalEarned();
  }, []);

  const totalWithdrawn = withdrawals.reduce((sum, w) => sum + Number(w.amount || 0), 0);
  const earned = totalEarned ?? 0;
  const availableToWithdraw = Math.max(0, earned - totalWithdrawn);

  function handleRecordWithdrawal(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    const amount = Number(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      setFormError("Please enter a valid positive amount.");
      return;
    }

    if (amount > availableToWithdraw) {
      setFormError(`Amount exceeds available balance (${formatAmount(availableToWithdraw)} Aznif).`);
      return;
    }

    const newRecord: LocalWithdrawal = {
      id: `wd_${Date.now()}`,
      amount,
      notes: withdrawNotes.trim() || "Admin Withdrawal",
      created_at: new Date().toISOString(),
    };

    const updated = [newRecord, ...withdrawals];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.warn("Error saving to localStorage:", err);
    }

    setWithdrawals(updated);
    setWithdrawAmount("");
    setWithdrawNotes("");
    setShowAddModal(false);
  }

  // Initiate Delete Flow
  function startDeleteFlow(w: LocalWithdrawal) {
    setTargetWithdrawal(w);
    setInputPin("");
    setPinError("");

    const savedPin = localStorage.getItem(PIN_STORAGE_KEY);
    if (!savedPin || savedPin.length !== 4) {
      // If no PIN is configured, direct directly to confirmation
      setConfirmStepOpen(true);
    } else {
      setPinStepOpen(true);
    }
  }

  // Verify PIN
  function handleVerifyPin(e: React.FormEvent) {
    e.preventDefault();
    setPinError("");

    const savedPin = localStorage.getItem(PIN_STORAGE_KEY);
    if (inputPin !== savedPin) {
      setPinError("Incorrect 4-digit PIN. Authorization denied.");
      return;
    }

    setPinStepOpen(false);
    setConfirmStepOpen(true);
  }

  // Final Confirmation Execution
  function handleExecuteDelete() {
    if (!targetWithdrawal) return;

    const updated = withdrawals.filter((w) => w.id !== targetWithdrawal.id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.warn("Error updating localStorage:", err);
    }

    setWithdrawals(updated);
    setConfirmStepOpen(false);
    setTargetWithdrawal(null);
  }

  return (
    <>
      <header className="header">
        <div>
          <h2>Commission Income</h2>
          <p className="muted">
            Track total platform burn revenue and record offline administrator withdrawals.
          </p>
        </div>
        <div className="header-actions">
          <button className="ghost-button" type="button" onClick={() => void loadTotalEarned()}>
            Refresh
          </button>
          <button className="dark-button" type="button" onClick={() => { setFormError(""); setShowAddModal(true); }}>
            + Record Withdrawal
          </button>
        </div>
      </header>

      <div className={status.includes("Unable") || status.includes("Error") ? "status error" : "status ok"}>
        {status}
      </div>

      {totalEarned !== null ? (
        <>
          {/* Main 3 Stats */}
          <section className="stats-grid economy-main-stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div className="stat-card green">
              <span>Total Earned</span>
              <strong>{formatAmount(earned)}</strong>
              <small>from Treasury Total Burned</small>
            </div>
            <div className="stat-card peach">
              <span>Total Withdrawn</span>
              <strong>{formatAmount(totalWithdrawn)}</strong>
              <small>stored in browser storage</small>
            </div>
            <div className="stat-card blue">
              <span>Available to Withdraw</span>
              <strong>{formatAmount(availableToWithdraw)}</strong>
              <small>Total Earned minus Total Withdrawn</small>
            </div>
          </section>

          {/* Add Withdrawal Modal */}
          {showAddModal ? (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                backdropFilter: "blur(2px)",
              }}
            >
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "12px",
                  padding: "24px",
                  width: "100%",
                  maxWidth: "460px",
                  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Record Withdrawal</h3>
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--muted)" }}
                  >
                    ✕
                  </button>
                </div>

                <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "16px" }}>
                  Available to withdraw: <strong style={{ color: "var(--primary)" }}>{formatAmount(availableToWithdraw)} Aznif</strong>
                </p>

                {formError ? (
                  <div style={{ padding: "10px", borderRadius: "6px", background: "#fee2e2", color: "#b91c1c", fontSize: "0.85rem", marginBottom: "16px" }}>
                    {formError}
                  </div>
                ) : null}

                <form onSubmit={handleRecordWithdrawal}>
                  <div style={{ marginBottom: "16px" }}>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "6px" }}>
                      Withdrawal Amount (Aznif)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      max={availableToWithdraw}
                      placeholder="e.g. 50"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      required
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--line)",
                        fontSize: "0.95rem",
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: "20px" }}>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "6px" }}>
                      Notes / Reference (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Personal payout #1"
                      value={withdrawNotes}
                      onChange={(e) => setWithdrawNotes(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--line)",
                        fontSize: "0.95rem",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setShowAddModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="dark-button"
                      disabled={Number(withdrawAmount) <= 0 || Number(withdrawAmount) > availableToWithdraw}
                    >
                      Save to History
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {/* STEP 1: PIN Verification Modal */}
          {pinStepOpen && targetWithdrawal ? (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                backdropFilter: "blur(2px)",
              }}
            >
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "12px",
                  padding: "24px",
                  width: "100%",
                  maxWidth: "400px",
                  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>🔒</span> Security Authorization
                  </h3>
                  <button
                    type="button"
                    onClick={() => { setPinStepOpen(false); setTargetWithdrawal(null); }}
                    style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--muted)" }}
                  >
                    ✕
                  </button>
                </div>

                <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "16px", lineHeight: 1.4 }}>
                  Enter your 4-digit Commission Security PIN to authorize deleting this withdrawal record of <strong>{formatAmount(targetWithdrawal.amount)} Aznif</strong>.
                </p>

                {pinError ? (
                  <div style={{ padding: "10px", borderRadius: "6px", background: "#fee2e2", color: "#b91c1c", fontSize: "0.85rem", marginBottom: "16px" }}>
                    {pinError}
                  </div>
                ) : null}

                <form onSubmit={handleVerifyPin}>
                  <div style={{ marginBottom: "20px" }}>
                    <input
                      type="password"
                      maxLength={4}
                      pattern="\d{4}"
                      placeholder="••••"
                      value={inputPin}
                      onChange={(e) => setInputPin(e.target.value.replace(/\D/g, ""))}
                      autoFocus
                      required
                      style={{
                        width: "100%",
                        textAlign: "center",
                        padding: "12px",
                        borderRadius: "8px",
                        border: "1px solid var(--line)",
                        fontSize: "1.4rem",
                        letterSpacing: "6px",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => { setPinStepOpen(false); setTargetWithdrawal(null); }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="dark-button"
                      disabled={inputPin.length !== 4}
                    >
                      Authorize
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {/* STEP 2: Final Confirmation Modal */}
          {confirmStepOpen && targetWithdrawal ? (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                backdropFilter: "blur(2px)",
              }}
            >
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "12px",
                  padding: "24px",
                  width: "100%",
                  maxWidth: "440px",
                  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "#dc2626", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>⚠️</span> Confirm Deletion
                  </h3>
                  <button
                    type="button"
                    onClick={() => { setConfirmStepOpen(false); setTargetWithdrawal(null); }}
                    style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--muted)" }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid var(--line)", marginBottom: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "0.9rem" }}>
                    <span style={{ color: "var(--muted)" }}>Withdrawal Amount:</span>
                    <strong style={{ color: "#d97706", fontSize: "1.05rem" }}>-{formatAmount(targetWithdrawal.amount)} Aznif</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "0.85rem" }}>
                    <span style={{ color: "var(--muted)" }}>Note:</span>
                    <span>{targetWithdrawal.notes}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "var(--muted)" }}>
                    <span>Recorded:</span>
                    <span>{formatDate(targetWithdrawal.created_at)}</span>
                  </div>
                </div>

                <div style={{ padding: "12px 14px", borderRadius: "8px", background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", fontSize: "0.88rem", marginBottom: "20px", lineHeight: 1.5 }}>
                  💡 <strong>Effect on Balance:</strong> Deleting this record will increase your <strong>Available to Withdraw</strong> by <strong>+{formatAmount(targetWithdrawal.amount)} Aznif</strong>.
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => { setConfirmStepOpen(false); setTargetWithdrawal(null); }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteDelete}
                    style={{
                      background: "#dc2626",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      padding: "8px 16px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Confirm Delete
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Withdrawal History */}
          <section className="panel">
            <div className="panel-title">
              <h3>Withdrawal History</h3>
              <span>{withdrawals.length} local record(s)</span>
            </div>

            <div className="table-wrap flat-table-wrap">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Notes / Reference</th>
                    <th>Date / Time</th>
                    <th style={{ width: "80px", textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", padding: "28px", color: "var(--muted)" }}>
                        No withdrawals recorded yet.
                      </td>
                    </tr>
                  ) : (
                    withdrawals.map((w) => (
                      <tr key={w.id}>
                        <td>
                          <strong style={{ color: "#d97706" }}>-{formatAmount(w.amount)}</strong> Aznif
                        </td>
                        <td>{w.notes}</td>
                        <td>{formatDate(w.created_at)}</td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => startDeleteFlow(w)}
                            style={{
                              background: "#fee2e2",
                              border: "1px solid #fecaca",
                              borderRadius: "6px",
                              padding: "4px 10px",
                              cursor: "pointer",
                              fontSize: "0.82rem",
                              fontWeight: 600,
                              color: "#dc2626",
                            }}
                          >
                            Delete
                          </button>
                        </td>
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
