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
- Vercel: `vercel.json` (FastAPI service + Vite frontend).

## Env

See `muri/backend/.env.example`. Never commit `muri/backend/.env`.
