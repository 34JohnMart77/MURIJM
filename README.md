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

## Deploy

- Render/Docker: `render.yaml` + `Dockerfile` (set `GEMINI_API_KEY` only).
- Vercel (Services: FastAPI + Vite, one domain):
  1. `vercel.json` already declares both services (`app`, `frontend`)
     with `/api/*` routed to the backend. Import the repo from its root
     and pick the **Services** framework preset.
  2. Set env vars on the Vercel project (Production + Preview):
     `GEMINI_API_KEY`, `MURI_SECRET_KEY` (long random string),
     `DATABASE_URL` (hosted MySQL, e.g. `mysql+pymysql://user:pass@host:3306/muri?charset=utf8mb4`),
     `MURI_BASE_URL` (your `https://<project>.vercel.app`),
     `MURI_COOKIE_SECURE=true`.
  3. Check `python tests/test_smoke.py` passes before pushing.
- Note: without a reachable `DATABASE_URL` the API boots but auth/chat
  return a "database unreachable" message (by design, fail-open boot).

## Env

See `muri/backend/.env.example`. Never commit `muri/backend/.env`.
