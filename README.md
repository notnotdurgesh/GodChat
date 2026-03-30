# fschchat Ecosystem

This repository contains a `frontend` app and a unified `backend` service. The backend handles authentication, MongoDB-backed persistence, chat generation, imports, SSE streaming, and Mermaid tooling.

## Services

### 1. `frontend`
The React client application.
- Authenticated workspace shell
- Graph visualization and branching chat UX
- Server-backed chat persistence and SSE streaming

### 2. `backend`
The single backend service for the app runtime.
- Username/password signup and login
- MongoDB-backed per-user chat state
- Gemini chat generation
- Chat import endpoints for Gemini, Claude, and ChatGPT
- Mermaid tool endpoints: `/tools/get_syntax_docs`, `/tools/get_config_docs`, `/tools/render_diagram`
- Optional Redis pub/sub fanout for streaming

## Quick Start

1. Install dependencies from the repo root:
```bash
npm install
```

2. Make sure Docker Desktop is running if you want the repo-managed MongoDB container.

3. Add a backend Gemini key if you want live model responses:
```bash
GEMINI_API_KEY=...
```

4. Start the full stack from the repo root:
```bash
npm run dev
```

This starts MongoDB first, then launches:
- `backend` on `http://localhost:5001`
- `frontend` on `http://localhost:3000`

## Authentication

- Open the frontend and create an account with username/password.
- The backend stores the workspace per user in MongoDB.
- Login state is kept in an HTTP-only cookie so SSE chat streams stay authenticated.

## Security Audit and Hardening

The following protections are now applied in production and local deployments:
- `helmet` secure HTTP headers
- rate limiting for API throughput (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`)
- strict CORS origin allow-list via `CORS_ORIGIN` (avoid `*` in prod)
- request body size limits (`10mb`)
- `x-powered-by` disabled
- `trust proxy` set (for correct client IP behind reverse proxies)

## Verification

Run unified end-to-end check:
```bash
npm run check:e2e
```

Backend health:
```bash
http://localhost:5001/api/health
```

Auth/session check:
```bash
http://localhost:5001/api/auth/me
```

Backend Mermaid tools:
```bash
POST http://localhost:5001/tools/get_syntax_docs
POST http://localhost:5001/tools/get_config_docs
POST http://localhost:5001/tools/render_diagram
```

## Notes

- Set `BACKEND_PORT` if you want the backend on a different port.
- Set `VITE_BACKEND_URL` if the frontend should target a non-default backend URL.
- Redis is optional. Set `REDIS_URL` only if you want multi-instance stream fanout.
- Mermaid docs now live directly inside `backend/MermaidDocs`.

## Production (DigitalOcean droplet) deployment

1. Clone the repo on your VPS:
```bash
git clone <your-repo-url>.git /opt/fschchat
cd /opt/fschchat
```

2. Copy example env and set secrets:
```bash
cp .env.example .env
# Edit .env to set GEMINI_API_KEY and any secret values
```

3. Build and start containers:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

4. Verify container state and logs:
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 50 frontend
docker compose -f docker-compose.prod.yml logs --tail 50 backend
```

5. Health checks:
- `http://<droplet-ip>/` should load frontend
- `http://<droplet-ip>/api/health` should respond

> Optional: Use `ufw allow 80/tcp && ufw allow 443/tcp` and add HTTPS via certbot.

