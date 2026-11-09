# ai-assisted-planning-poker

An animal-themed planning poker app. A facilitator opens a room and shares the join link. Each teammate then joins with a name and a cartoon animal avatar. The facilitator joins as a spectator by default and can switch to voting at any time.

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
| `JIRA_OAUTH_CLIENT_ID` | unset | Optional shared Planning Poker Atlassian 3LO app client ID |
| `JIRA_OAUTH_CLIENT_SECRET` | unset | Backend-only app secret; never a frontend build variable |
| `JIRA_OAUTH_REDIRECT_URI` | unset | Exact registered backend callback URL ending in `/jira/oauth/callback` |

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

## Optional Jira Cloud integration

### App setup

Use one shared, Planning Poker-owned Atlassian OAuth 2.0 (3LO) app, not an app registered separately by each facilitator. In the Atlassian developer console, configure its access/distribution policy for the intended users and classic Jira scopes `read:jira-work` and `write:jira-work`. Do not request `offline_access`. Facilitators consent with their own accounts and choose among their authorised Jira sites; there is no global `JIRA_SITE_URL` setting.

Register each environment's exact backend callback explicitly: the production backend's real HTTPS origin plus `/jira/oauth/callback`, and, for local development, `http://localhost:3000/jira/oauth/callback`. Do not use the frontend/Pages URL as the callback. Configure the three backend variables above through your environment or hosting secret settings. Never commit the secret or place it in `VITE_*` variables. This repo does not supply a production callback host: use the actual deployed backend origin and register it before enabling Jira.

All three nonblank values are required. Invalid or partial configuration fails closed for Jira only; manual planning rooms still work. The redirect must be HTTPS, except explicit HTTP loopback callbacks on `localhost`, `127.0.0.1` or `[::1]`; its path must be exactly `/jira/oauth/callback`, with no credentials, query or fragment. Render declarations are unset `sync: false` placeholders, not credentials or a working OAuth setup.

### Room workflow and privacy

The current facilitator connects Jira in a popup/new tab, keeping the room tab alive; use the explicit new-tab link if popups are blocked. The completion page tries to close automatically; if the browser refuses, it redirects to the originating room and offers a return link. The app origin must be in `ALLOWED_ORIGINS` and match the connecting browser; Pages paths are preserved, with no tokens/codes in the return URL. Same-tab navigation can mark the facilitator away and invalidate the connection. When several sites are authorised, select one before importing an issue key or a matching site's HTTPS issue URL. Jira actions and correlated replies use the room socket; private status and credentials are not broadcast. See the [API contract](docs/api-contract.md) for wire formats and errors.

Typing an issue-key prefix such as `AL-` requests up to 10 suggestions from the connected Jira site after a short debounce. Suggestions show readable existing keys and summaries, not invented sequential numbers; choosing one fills the field without importing. URL/key paste and the explicit Import action still work if suggestions are unavailable. Search does not require a custom Spike type; unsupported issue types remain rejected at import.

Import supports Story and Spike (case-insensitive names) and rejects duplicate issue identities within the room. Imported title, description and type are read-only in both UI and backend; the facilitator can still remove tickets and select them for voting. Manual ticket editing and its 100-character title/500-character description limits are unchanged; the room still holds at most 10 tickets.

Import intentionally shares issue title, full accepted description and public Jira identity with **everyone holding the room link**, including people without Jira access. Accepted descriptions retain complete ADF up to 256 KiB serialized UTF-8, nesting depth 64 and 20,000 nodes; imported titles allow 255 Unicode characters. Oversized/invalid imports fail without truncation. Rich text, lists, tables, panels, code, links and mentions render safely; private media and unsupported embeds use labelled Jira links. Rendering is bounded at depth 40 with an explicit linked fallback, not truncation of the stored ADF accepted up to depth 64.

After revealing a linked Story, the story-points dropdown defaults to the unique most-common numeric vote from `[1, 2, 3, 5, 8, 13, 20]`; ties and rounds with no numeric votes require a manual choice. An existing explicit agreement is retained, and the facilitator can override the default. Coffee and unknown values are excluded; no average is calculated. One **Update Jira** button saves the selected agreement and prepares the update. Field discovery may require selecting among multiple editable story-points fields and clicking Update Jira again. Review the site, issue, field, current points and replacement points, then explicitly confirm the single-use, two-minute preview; no Jira write occurs before confirmation. Write-back is Story-only. Spike votes remain days; Bug/Task support and Spike duration-field write-back are deferred to separate tickets, not implemented here.

Before writing, Jira's current value and field editability are checked again; a detected change requires a fresh preview/confirmation. This is best-effort conflict detection, not atomic compare-and-swap. A timeout or verification failure can leave an uncertain outcome: read/reconcile Jira before another explicitly confirmed write, with **no automatic write retry**. Disconnect cannot undo or reliably cancel a write already sent to Jira. There is no continuous/background sync.

Access tokens are backend-memory-only, scoped to the room and authorising facilitator, with no disk persistence, refresh token or background renewal. Going away, host promotion/restoration, seat takeover/token rotation, expiry, disconnect, room closure or server restart requires reauthorisation; a replacement facilitator must connect their own account. Disconnect/expiry leaves imported content, results and agreed estimates in the room until normal room closure/removal. Atlassian app consent may persist independently of this volatile room connection; local disconnect is not a promise to revoke provider consent or other rooms' connections.

The beta permits anyone with the room link to take over an away member without identity proof, potentially regaining the host role. Clearing Jira credentials on these transitions prevents inheritance of the previous token but does not remove that existing room-identity risk. Share room links and import confidential Jira content accordingly.

## Deployment

- **Backend on Render:** create a Blueprint from `render.yaml`. If the Pages origin is different, update `ALLOWED_ORIGINS` to match.
- **Frontend on GitHub Pages:**
  1. In repository settings, set Pages to deploy from **GitHub Actions**.
  2. Add the repository variables `VITE_API_URL` (e.g. `https://<service>.onrender.com`) and `VITE_WS_URL` (e.g. `wss://<service>.onrender.com`).
  3. Each push to `main` then runs `.github/workflows/pages.yml`.

Render's free tier sleeps when idle, so the first join after a quiet period can take up to a minute.