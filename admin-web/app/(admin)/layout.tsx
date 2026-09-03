import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <h1>Aznif</h1>
            <p>Admin Console</p>
          </div>
        </div>

        <p className="nav-label">General</p>
        <nav className="nav">
          <Link href="/dashboard"><span className="nav-icon">□</span> Dashboard</Link>
          <Link href="/users"><span className="nav-icon">◎</span> Players</Link>
          <Link href="/aznif"><span className="nav-icon">+</span> Add Aznif</Link>
        </nav>

        <p className="nav-label section-label">Aznif Economy</p>
        <nav className="nav">
          <Link href="/economy/overview"><span className="nav-icon">📊</span> Overview</Link>
          <Link href="/economy/transactions"><span className="nav-icon">⇄</span> Transactions</Link>
          <Link href="/economy/treasury"><span className="nav-icon">$</span> Treasury</Link>
          <Link href="/economy/commission-income"><span className="nav-icon">💰</span> Commission Income</Link>
        </nav>

        <p className="nav-label account-label">Account</p>
        <nav className="nav">
          <Link href="/settings"><span className="nav-icon">⚙</span> Settings</Link>
          <Link href="/dashboard"><span className="nav-icon">?</span> Help</Link>
        </nav>

        <form action="/api/auth/logout" method="post" className="logout-form">
          <button className="logout" type="submit"><span className="nav-icon">↪</span> Logout</button>
        </form>
      </aside>
      <section className="main">{children}</section>
    </main>
  );
}
