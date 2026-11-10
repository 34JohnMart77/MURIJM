# MURI — Learn. Play. Grow.

Muri is a friendly AI learning companion: Gemini chat with streaming,
courses, quizzes, notes, streaks, badges, and certificates.

## Stack

- Backend: FastAPI (`muri/backend/`), served locally on `:8000`
- Frontend: React + Vite PWA (`frontend/`)
- DB: MySQL locally, SQLite file on Render (`render.yaml`)
- AI: Google Gemini (`GEMINI_API_KEY`)

## Run locally

```powershell
# backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy muri\backend\.env.example muri\backend\.env
# edit GEMINI_API_KEY + MURI_SECRET_KEY, then:
uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers --app-dir muri/backend

# frontend (new terminal)
cd frontend; npm ci; npm run dev
```

The backend loads `muri/backend/.env` directly, regardless of the current
working directory. For local MySQL, make sure the Windows MySQL service is
running and listening on port 3306. A `127.0.0.1` or `localhost` database URL
is only for local development; Vercel needs a hosted MySQL URL configured in
its project environment variables.

## Deploy

- Render/Docker: `render.yaml` + `Dockerfile` (set `GEMINI_API_KEY`; configure
  optional social sign-in credentials in the service's Environment tab).
- Vercel (Services: FastAPI + Vite, one domain):
  1. `vercel.json` already declares both services (`app`, `frontend`)
     with `/api/*` routed to the backend. Import the repo from its root
     and pick the **Services** framework preset.
  2. **Environment variables** — Vercel project → Settings → Environment
     Variables, scope **Production + Preview**, then Redeploy.
     `muri/backend/.env` is git-ignored (and `.vercelignore`d), so it never
     reaches Vercel: the dashboard is the only place these exist.
     - `DATABASE_URL` — hosted MySQL reachable from the internet. For
       [Railway](https://docs.railway.com/databases/mysql), enable **Public
       Networking** on the MySQL service and copy its
       `MYSQL_PUBLIC_URL` into this variable.
       `mysql+pymysql://user:pass@host:3306/muri?charset=utf8mb4`
       - Railway's `MYSQL_PUBLIC_URL` uses `mysql://...`; the app
         auto-corrects it to `mysql+pymysql://` on boot
       - percent-encode password specials (`@` → `%40`, `#` → `%23`);
         a raw `@` in the password is also repaired automatically
       - if the URL includes a `charset` query parameter, use
         `charset=utf8mb4`; unsupported values are reported as a configuration
         error instead of failing during sign-in
       - `127.0.0.1`/`localhost` can never work on Vercel
       - For Aiven, set `MYSQL_SSL_CA` to its downloaded CA certificate only
         if your connection requires it; PyMySQL negotiates TLS on its own
         with most hosted MySQL providers.
     - `GEMINI_API_KEY`
     - `MURI_SECRET_KEY` — long random string; without it every cold start
       mints a new key and logins break between instances
     - `MURI_ADMIN_EMAIL` — the exact Google account email for the Murillon
       administrator
     - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — required for Google
       sign-in (and admin sign-in); set `FACEBOOK_APP_ID` and
       `FACEBOOK_APP_SECRET` to enable Facebook sign-in for users
     - `MURI_BASE_URL` — your `https://<project>.vercel.app`
     - `MURI_COOKIE_SECURE=true` (Vercel/HTTPS deployments also enable Secure
       cookies automatically)
  3. Verify: open `https://<project>.vercel.app/api/health` and check
     `"db_ready": true` with an empty `db_error`. Every function log starts
     with `[Muri] Database target: ... [source]`, showing whether Vercel
     actually provided `DATABASE_URL` (it must say *environment variable*,
     not *localhost fallback*).
  4. Check `python tests/test_smoke.py` passes before pushing.
- Note: without a reachable `DATABASE_URL` the API boots but auth/chat
  return a "database unreachable" message (by design, fail-open boot).

## Env

See `muri/backend/.env.example`. Never commit `muri/backend/.env`.

## Social sign-in

Google and Facebook OAuth are implemented but stay hidden on the sign-in page
until that provider's ID and secret are configured on the backend. Create OAuth
credentials in the provider's developer console and register these exact
authorized redirect URIs, replacing `<your-host>` with the public HTTPS host:

- Google: `https://<your-host>/api/auth/oauth/google/callback`
- Facebook: `https://<your-host>/api/auth/oauth/facebook/callback`

Set the matching backend variables:

- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Facebook: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`

Configure these in `muri/backend/.env` for local development, or in your
hosting provider's environment settings for deployment. On Render, the app
uses Render's `RENDER_EXTERNAL_URL` automatically; on other hosts, set
`MURI_BASE_URL` to the public site URL. Redeploy/restart after changing the
environment. Verify the result at `/api/auth/providers`; each configured
provider should report `true`.

After approving access at Google/Facebook, users must enter a one-time code
sent to their account email. Configure SMTP (`SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`) so users can receive that code.
Without SMTP, the code is only written to the backend logs and users cannot
complete sign-in themselves.

## Admin access

Set `MURI_ADMIN_EMAIL` to the administrator's email and `MURI_ADMIN_PASSWORD`
to a unique random password of at least 16 characters in the backend
environment. The admin sign-in form is available at `/admin/login`; the same
configured email can also sign in with Google when Google OAuth is configured.
The admin account is shown as **Murillon**. Admin email/password sign-in is
rate-limited and uses the existing secure session cookie.
User accounts can continue using Google or Facebook. The admin dashboard
reports account names, sign-in provider, activity totals, selected models, and
successfully used models. The dashboard refreshes automatically every minute
and can also be refreshed manually. It does not expose users' private chat
messages.
Existing databases are updated automatically with the account-role column on
startup.
