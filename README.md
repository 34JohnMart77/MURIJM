# Muri — Learn. Play. Grow.

Muri is a friendly AI learning companion. It chats with you about any topic,
explains ideas step by step, quizzes you, tracks streaks and badges, and keeps
a history of everything you learn — in the browser or as an Android app.

## 🌐 Live website

> **Website URL:** _add your deployed link here_ (e.g. `https://muri-xxxx.onrender.com`)

Open the link above in any browser (phone or PC) to use Muri.

## ✨ Features

- **AI chat** — ask anything and learn step by step, with streaming replies.
- **Voice messages** — tap the mic and talk to Muri; it understands audio.
- **Attachments** — send images, photos, PDFs and text files.
- **Courses & lessons** — structured learning with progress tracking.
- **Games & quizzes** — practice what you learn and earn points.
- **Notes** — save answers and key ideas.
- **Streaks, badges & certificates** — stay motivated as you grow.
- **Accounts** — email/password plus Google and Facebook sign-in.
- **PWA + Android app** — installable, works great on mobile.

## 🧱 Tech stack

- **Frontend:** React + TypeScript + Vite (PWA, Capacitor for Android)
- **Backend:** FastAPI (Python 3.12)
- **AI:** Google Gemini (`google-genai`)
- **Database:** MySQL (SQLite supported for quick/one-click hosting)
- **Hosting:** Docker (see `Dockerfile` / `render.yaml`)

## 🚀 Run locally

Requirements: Python 3.12+, Node 20+, and (optionally) MySQL.

1. Install frontend dependencies and build:

   ```powershell
   cd frontend
   npm install
   npm run build
   ```

2. Configure the backend — copy your keys into `muri/backend/.env`
   (at minimum `GEMINI_API_KEY`).

3. Install the backend dependencies:

   ```powershell
   pip install -r requirements.txt
   ```

4. Start Muri (serves the API **and** the built frontend on one link):

   ```powershell
   ./start.ps1
   ```

   Then open <http://localhost:8000>.

## ☁️ Deploy

The included `render.yaml` deploys Muri to [Render](https://render.com) as a
single Docker service (API + frontend on one public HTTPS link):

1. Push this repo to GitHub.
2. On Render, create a **Blueprint** and select this repository.
3. Set the secret environment variables when prompted
   (`GEMINI_API_KEY`, `MURI_SECRET_KEY`, and any OAuth keys you use).
4. After the first deploy, copy the public URL, set `MURI_BASE_URL` to it,
   and put that same URL in the **Live website** section above.

## 📱 Android app

```powershell
cd frontend
npm run build:android
```

This builds the web assets and syncs them into the Capacitor Android project.

---

Made with ❤️ for learners — **Learn. Play. Grow.**
