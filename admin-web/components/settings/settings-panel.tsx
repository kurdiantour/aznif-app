"use client";

import { useEffect, useState } from "react";

const PIN_STORAGE_KEY = "aznif_commission_security_pin";

export default function SettingsPanel() {
  const [hasPin, setHasPin] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);

  useEffect(() => {
    const savedPin = localStorage.getItem(PIN_STORAGE_KEY);
    setHasPin(Boolean(savedPin && savedPin.length === 4));
  }, []);

  function handleSavePin(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const savedPin = localStorage.getItem(PIN_STORAGE_KEY);

    if (savedPin && savedPin.length === 4) {
      if (currentPin !== savedPin) {
        setMessage({ text: "Current PIN is incorrect.", type: "error" });
        return;
      }
    }

    if (!/^\d{4}$/.test(newPin)) {
      setMessage({ text: "New PIN must be exactly 4 numeric digits (0-9).", type: "error" });
      return;
    }

    if (newPin !== confirmPin) {
      setMessage({ text: "New PIN and Confirm PIN do not match.", type: "error" });
      return;
    }

    try {
      localStorage.setItem(PIN_STORAGE_KEY, newPin);
      setHasPin(true);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setMessage({ text: "Commission Security PIN successfully saved!", type: "ok" });
    } catch (err) {
      setMessage({ text: "Failed to save PIN to localStorage.", type: "error" });
    }
  }

  function handleRemovePin() {
    const savedPin = localStorage.getItem(PIN_STORAGE_KEY);
    if (!savedPin) return;

    const entered = prompt("Enter your current 4-digit PIN to disable Commission Security PIN:");
    if (entered === null) return;

    if (entered !== savedPin) {
      alert("Incorrect PIN.");
      return;
    }

    localStorage.removeItem(PIN_STORAGE_KEY);
    setHasPin(false);
    setMessage({ text: "Commission Security PIN has been removed.", type: "ok" });
  }

  return (
    <>
      <header className="header">
        <div>
          <h2>System & Admin Settings</h2>
          <p className="muted">Manage local administrative security, preferences, and controls.</p>
        </div>
      </header>

      {message ? (
        <div className={`status ${message.type === "error" ? "error" : "ok"}`}>
          {message.text}
        </div>
      ) : null}

      <div style={{ maxWidth: "640px", display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Commission Security Section */}
        <section className="panel" style={{ padding: "24px" }}>
          <div className="panel-title" style={{ marginBottom: "16px" }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span>🔒</span> Commission Security
            </h3>
            <span className={hasPin ? "pill success" : "pill neutral"}>
              {hasPin ? "PIN Enabled" : "No PIN Set"}
            </span>
          </div>

          <p style={{ fontSize: "0.88rem", color: "var(--muted)", marginBottom: "20px", lineHeight: 1.5 }}>
            Set a secure 4-digit PIN required to authorize the deletion of recorded withdrawals in the <strong>Commission Income</strong> ledger.
          </p>

          <form onSubmit={handleSavePin} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {hasPin ? (
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "6px" }}>
                  Current 4-Digit PIN
                </label>
                <input
                  type="password"
                  maxLength={4}
                  pattern="\d{4}"
                  placeholder="••••"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
                  required
                  style={{
                    width: "100%",
                    maxWidth: "240px",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--line)",
                    fontSize: "1.1rem",
                    letterSpacing: "4px",
                  }}
                />
              </div>
            ) : null}

            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "6px" }}>
                {hasPin ? "New 4-Digit PIN" : "Create 4-Digit PIN"}
              </label>
              <input
                type="password"
                maxLength={4}
                pattern="\d{4}"
                placeholder="••••"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                required
                style={{
                  width: "100%",
                  maxWidth: "240px",
                  padding: "10px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--line)",
                  fontSize: "1.1rem",
                  letterSpacing: "4px",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "6px" }}>
                Confirm 4-Digit PIN
              </label>
              <input
                type="password"
                maxLength={4}
                pattern="\d{4}"
                placeholder="••••"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                required
                style={{
                  width: "100%",
                  maxWidth: "240px",
                  padding: "10px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--line)",
                  fontSize: "1.1rem",
                  letterSpacing: "4px",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
              <button type="submit" className="dark-button">
                {hasPin ? "Update PIN" : "Set Security PIN"}
              </button>

              {hasPin ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleRemovePin}
                  style={{ color: "#ef4444" }}
                >
                  Remove PIN
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
