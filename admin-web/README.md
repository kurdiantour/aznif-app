# Aznif Admin Web

Standalone Next.js admin panel for the Domino app.

## Local no-login mode

Create `admin-web/.env.local`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
ADMIN_DEV_BYPASS=true
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Then run:

```bash
cd admin-web
npm install
npm run dev
```

Open `http://localhost:3001/dashboard`. With `ADMIN_DEV_BYPASS=true`, `/login` redirects straight to `/dashboard` while running `npm run dev`.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in client code or commit `.env.local`.
