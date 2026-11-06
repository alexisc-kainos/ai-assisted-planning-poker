# ai-assisted-planning-poker

An animal-themed planning poker app. A facilitator opens a room and shares the join link. Each teammate then joins with a name and a cartoon animal avatar.

- `backend/`: Node.js + [`ws`](https://github.com/websockets/ws) server that implements [docs/api-contract.md](docs/api-contract.md). All state is held in memory.
- `frontend/`: Vite + React single-page app.

The UI uses supplied animal portraits and a riverside illustration, preserving
the room sidebar and existing responsive layout. See
[artwork provenance and extraction](frontend/src/assets/README.md).

## Local development

Requires Node 22 (see `.nvmrc`).

```sh
npm install
npm run dev:backend    # http://localhost:3000
npm run dev:frontend   # http://localhost:5173
```

Open http://localhost:5173 and select **Create a room**. To join as someone else, open the room link in a second browser or a private window.

```sh
npm test               # backend + frontend tests
npm run typecheck
npm run build
```

## Configuration

### Backend (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket port |
| `MAX_ROOM_USERS` | `50` | Room capacity |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call `GET /rooms/:id` |
| `HEARTBEAT_INTERVAL_MS` | `30000` | Ping interval |
| `HEARTBEAT_TIMEOUT_MS` | `10000` | Pong timeout before a socket is closed |
| `SHUTDOWN_GRACE_MS` | `20000` | Maximum wait for sockets to close on `SIGTERM` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `20` / `10000` | Inbound messages allowed per socket per window |
| `ROOM_KEEP_AWAKE_DURATION_MS` | `5400000` | How long each open room keeps the Render service active after room creation |

On Render, the backend uses the platform-provided `RENDER_EXTERNAL_URL` to request
its own `/health` endpoint every 10 minutes while any room is inside its
keep-awake window. When no room is active or the public URL is unavailable, no
keep-awake request is made. Local development does not need this variable.

### Frontend (build-time variables)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Backend HTTP base URL |
| `VITE_WS_URL` | derived from `VITE_API_URL` | Backend WebSocket base URL |
| `VITE_BASE` | `/` | Public path (the repo name on GitHub Pages) |

## Deployment

- **Backend on Render:** create a Blueprint from `render.yaml`. If the Pages origin is different, update `ALLOWED_ORIGINS` to match.
- **Frontend on GitHub Pages:**
  1. In repository settings, set Pages to deploy from **GitHub Actions**.
  2. Add the repository variables `VITE_API_URL` (e.g. `https://<service>.onrender.com`) and `VITE_WS_URL` (e.g. `wss://<service>.onrender.com`).
  3. Each push to `main` then runs `.github/workflows/pages.yml`.

Render's free tier sleeps when idle, so the first join after a quiet period can take up to a minute.