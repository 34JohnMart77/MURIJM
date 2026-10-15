# ---- Build the PWA frontend ----
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Run the Muri backend (serves API + frontend from one link) ----
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY muri/backend/*.py ./
COPY --from=web /web/dist/ /srv/static/
ENV FRONTEND_DIST=/srv/static
# Hosts inject $PORT (Render/Railway). Falls back to 8000 locally.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
