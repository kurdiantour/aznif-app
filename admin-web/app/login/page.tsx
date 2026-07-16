"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("Signing in...");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const result = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setStatus(result.error ?? "Login failed.");
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="login-page">
      <section className="panel login-card">
        <div>
          <div className="brand login-brand">
            <div className="brand-mark">A</div>
            <div>
              <h1>Aznif</h1>
              <p>Admin Console</p>
            </div>
          </div>
          <h2>Admin Login</h2>
          <p className="muted">Sign in with an admin account to manage real player data.</p>
        </div>

        <form className="form" onSubmit={submit}>
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" autoComplete="current-password" required />
          </label>
          <button className="dark-button" type="submit" disabled={loading}>{loading ? "Signing In" : "Sign In"}</button>
        </form>

        {status ? <div className={status === "Signing in..." ? "status ok" : "status error"}>{status}</div> : null}
      </section>
    </main>
  );
}
