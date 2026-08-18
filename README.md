# ImageShrink-AI

> Multi-Stage Docker Image Shrinker & Layer Auditor - web app, REST API and VS Code extension.
> Deterministic Dockerfile linting plus AI-powered rewrites via Groq.

## Project Structure

```
ImageShrink-AI/
├── shared/                       # Single source of truth, read by backend AND extension
│   ├── rule-catalog.json         # Every rule's user-facing text, severity, impact estimates
│   └── base-images.json          # Image sizes + compatibility scores behind suggestions
│
├── client/                       # React + Vite + TypeScript + MUI frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── analysis/         # AnalysisDetail report renderer
│   │   │   ├── landing/          # VS Code hero, feature cards, animated editor mockup
│   │   │   ├── layout/           # Navbar
│   │   │   ├── auth/            # AuthLayout, GoogleSignInButton
│   │   │   ├── settings/         # Devices, API keys, avatar, account deletion
│   │   │   └── RouteGuards.tsx
│   │   ├── context/AuthContext.tsx
│   │   ├── pages/                # Landing, Extension, Docs, Activate, Workbench, Analysis,
│   │   │                         # History, Settings, Login, Signup, ForgotPassword,
│   │   │                         # ResetPassword, VerifyEmail
│   │   ├── services/             # api (auto-refresh), auth, docker, account, extension
│   │   └── types/
│   ├── public/
│   │   └── staticwebapp.config.json   # SPA fallback routing for static hosting
│   └── .env.example
│
├── server/                       # FastAPI + MongoDB backend
│   ├── app/
│   │   ├── api/
│   │   │   ├── deps.py           # Auth dependencies (access token OR API key)
│   │   │   ├── errors.py         # Provider failures → status codes, shared by endpoints
│   │   │   └── v1/               # auth, device, account, analyze, models, rules
│   │   ├── core/                 # config, database, security (JWT + token hashing),
│   │   │                         # observability (logging + Application Insights)
│   │   ├── models/               # analysis, user, session documents
│   │   └── services/
│   │       ├── provider.py           # Shared AI client + error classification
│   │       ├── rate_limiter.py       # Per-model sliding-window quota, shared via MongoDB
│   │       ├── model_scheduler.py    # Retry + fallback policy
│   │       ├── model_registry.py     # Live catalog + quota-aware health probes
│   │       ├── ai_optimizer.py       # Prompts + hard normalization of model output
│   │       ├── dockerfile_lexer.py   # Instruction parsing with source positions
│   │       ├── rule_engine.py        # 24 deterministic rules + scoring
│   │       ├── trivy_scanner.py      # CVE + misconfig scanning
│   │       ├── google_auth.py        # Verifies Google Sign-In ID tokens
│   │       ├── email_service.py       # Azure Communication Services sender + templates
│   │       ├── email_token_service.py # Single-use verify / reset links
│   │       └── auth_service.py, session_service.py, device_flow.py, api_key_service.py
│   ├── scripts/                  # check_auth_flow.py, check_analysis_flow.py
│   ├── tests/                    # 133 unit tests
│   ├── Dockerfile                # Multi-stage; build from the REPO ROOT, not server/
│   ├── .env.example
│   └── run.py
│
└── vscode-extension/             # Standalone VS Code extension - no backend, no account
    ├── src/
    │   ├── rules/                # TS port of the lexer + engine (runs on every keystroke)
    │   ├── analysis/             # Local size estimate, Trivy scan, Dockerfile rewriter
    │   ├── providers/            # diagnostics, code actions, hovers, completion
    │   ├── views/                # Activity Bar sidebar + report webview
    │   └── workspace/context.ts  # .dockerignore / manifest / bloat detection
    ├── scripts/
    │   ├── sync-shared.mjs       # Copies shared/*.json in at build time
    │   ├── check-parity.mjs      # Fails if the TS and Python engines disagree
    │   └── check-standalone.mjs  # Runs the analyzer outside VS Code, end to end
    └── esbuild.mjs
```

## Quick Start

### Prerequisites

Security scanning is powered by the [Trivy](https://trivy.dev) CLI, which must be on the
backend's `PATH`:

```bash
sudo apt-get install -y wget gnupg
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor | sudo tee /usr/share/keyrings/trivy.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" | sudo tee /etc/apt/sources.list.d/trivy.list
sudo apt-get update && sudo apt-get install -y trivy
```

Seed the vulnerability database once so the first scan does not pay for the download:

```bash
trivy image --download-db-only
```

Without Trivy the app still runs - analyses come back with `scanner.status: "unavailable"`
and the UI reports the Dockerfile as unscanned rather than clean.

### Backend
```bash
cd server
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Then edit .env - JWT_SECRET and GROQ_API_KEY are the two you must fill in.
# Generate a secret with:  python -c "import secrets; print(secrets.token_urlsafe(48))"

python run.py
# → http://localhost:8000
# Docs → http://localhost:8000/docs
```

MongoDB has to be running. In deployment that is MongoDB Atlas, set via `MONGO_URI`. For local
work a throwaway container is enough — `--rm` so it cleans itself up on stop:

```bash
docker run -d --rm --name imageshrink-test-mongo -p 27017:27017 mongo:7
```

### Frontend
```bash
cd client
npm install
cp .env.example .env
npm run dev
# → http://localhost:5173
```

### VS Code Extension

**Standalone.** No backend, no account, no HTTP client - rules, size estimates and the Dockerfile
rewrite all run in-process, and CVE scanning shells out to a local Trivy install. You do not need
the API or website running to use it.

Install from the Marketplace - search **ImageShrink** in the Extensions view, or:

```bash
code --install-extension imageshrink.imageshrink-ai
```

To build the latest source instead (Node.js 20+, VS Code 1.95+, `code` on your PATH):

```bash
cd vscode-extension
npm install
npm run install-local     # packages the .vsix and installs it with --force
```

Then run **Developer: Reload Window**. Verify with:

```bash
code --list-extensions --show-versions | grep imageshrink
# → imageshrink.imageshrink-ai@1.0.2
```

To develop it, open the `vscode-extension` folder in VS Code and press <kbd>F5</kbd> for an
Extension Development Host; `npm run watch` rebuilds on save.

The extension reads `shared/` for its rule data, copied in at build time by
`scripts/sync-shared.mjs` - so it must be built from inside a checkout, not standalone.

Optional external tools, both detected automatically:

| Tool | Enables | Without it |
|---|---|---|
| [Trivy](https://trivy.dev) | Base image CVE scanning | Reported as unavailable, never as clean |
| Docker | Measured base image sizes | Falls back to published estimates, labelled as such |

## Environment Variables

### `server/.env`
| Key | Description |
|-----|-------------|
| `MONGO_URI` | MongoDB connection string |
| `GROQ_API_KEY` | Groq Cloud API key - get one at console.groq.com/keys |
| `GROQ_MODEL` | Default model (default: `openai/gpt-oss-120b`) |
| `GROQ_BASE_URL` | OpenAI-compatible endpoint (default: `https://api.groq.com/openai/v1`) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
| `WEB_APP_URL` | Base address used to build links in emails |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID. Empty disables Google sign-in |
| `ACS_CONNECTION_STRING` | Azure Communication Services. Empty disables outbound email |
| `ACS_SENDER_ADDRESS` | Verified sender, e.g. `donotreply@x.azurecomm.net` |
| `EMAIL_VERIFICATION_REQUIRED` | Block sign-in until the address is confirmed (default: `false`) |
| `LOG_LEVEL` | `DEBUG`/`INFO`/`WARNING`/`ERROR` (default: `INFO`) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Enables tracing. Empty disables telemetry |
| `TRIVY_ENABLED` | Toggle security scanning (default: `true`) |
| `TRIVY_BINARY` | Path to the Trivy executable (default: `trivy`) |
| `TRIVY_TIMEOUT_SECONDS` | Per-scan timeout (default: `120`) |
| `TRIVY_TOTAL_TIMEOUT_SECONDS` | Budget for all scans in one analysis (default: `180`) |
| `TRIVY_MAX_CONCURRENT_SCANS` | Parallel Trivy processes - keep at `1` (default: `1`) |
| `TRIVY_SEVERITIES` | Severities to report (default: `CRITICAL,HIGH,MEDIUM,LOW`) |
| `TRIVY_CACHE_TTL_MINUTES` | In-memory result cache lifetime (default: `60`) |
| `TRIVY_MAX_IMAGES` | Max base images scanned per Dockerfile (default: `4`) |
| `TRIVY_MAX_FINDINGS` | Max CVEs kept, highest severity first (default: `100`) |
| `TRIVY_SKIP_DB_UPDATE` | Skip DB refresh during scans (default: `true`) |
| `JWT_SECRET` | **Required.** Signs access tokens. Changing it signs everyone out |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token lifetime (default: `60`) |
| `REFRESH_TOKEN_EXPIRE_DAYS` | How long a device stays signed in (default: `30`) |
| `WEB_APP_URL` | Where the extension sends users to approve a login |
| `MODEL_REQUESTS_PER_MINUTE` | Per-model quota, set from the provider's token cap (default: `3`) |
| `MODEL_MAX_QUEUE_WAIT_SECONDS` | Longest wait for a slot before returning 429 (default: `45`) |
| `MODEL_MAX_ATTEMPTS` | Models tried before giving up on one analysis (default: `4`) |
| `MODEL_COOLDOWN_SECONDS` | How long a throttled model is skipped (default: `30`) |
| `MODEL_FALLBACK_CHAIN` | Preferred fallback order. Empty = derive from the live catalog |
| `SHARED_DIR` | Path to `shared/`. Empty = the repo root. Set when deploying the server alone |
| `MAX_API_KEYS_PER_USER` | Active API keys per account (default: `10`) |

### `client/.env`
| Key | Description |
|-----|-------------|
| `VITE_API_URL` | Backend base URL |

## REST API

All paths are prefixed `/api/v1`. Responses are wrapped in `{ success, data, message? }`.
Everything except `/rules` and the auth entry points needs `Authorization: Bearer <token>` -
either an access token or an `isk_` API key.

### Auth & sessions
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/signup` | Create an account and sign in |
| `POST` | `/auth/login` | Sign in with username or email |
| `POST` | `/auth/refresh` | Exchange a refresh token for a new pair (rotates on use) |
| `POST` | `/auth/logout` | End this session server-side |
| `GET` / `PATCH` | `/auth/me` | Read or update the current user |
| `POST` | `/auth/change-password` | Change password, optionally evicting other devices |

### Extension login (device flow)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/device/start` | Issue a user code + device code |
| `POST` | `/auth/device/token` | Redeem an approved code (`202` while pending) |
| `GET`  | `/auth/device/pending` | What is asking for access, for the approval screen |
| `POST` | `/auth/device/approve` / `/deny` | Grant or refuse (browser session only) |

### Analysis
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/analyze` | Analyze an uploaded Dockerfile (multipart) |
| `POST` | `/analyze/extension` | Analyze with workspace context (JSON, from VS Code) |
| `POST` | `/analyze/rules` | Deterministic findings only - no AI, no quota, no write |
| `GET`  | `/analyze/history` | Paginated. `q`, `source`, `favorite`, `sort`, `page`, `pageSize` |
| `GET`  | `/analyze/stats` | Totals for the dashboard and extension sidebar |
| `GET`  | `/analyze/{id}` | Full report |
| `PATCH`| `/analyze/{id}/favorite` | Mark or unmark a favourite |
| `DELETE`| `/analyze/{id}` | Delete an analysis |

### Account
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/account/sessions` | Connected devices |
| `DELETE`| `/account/sessions/{id}` | Sign one device out |
| `POST` | `/account/sessions/revoke-others` | Sign out everywhere else |
| `GET` / `POST` | `/account/api-keys` | List or create keys |
| `DELETE`| `/account/api-keys/{id}` | Revoke a key |
| `PUT`  | `/account/avatar` | Set or clear the profile picture |
| `POST` | `/account/delete` | Delete the account and all its data |

### Reference
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/models` | Live model catalog; `?probe=true` health-checks each |
| `GET`  | `/rules` | The rule catalog. Public - the docs page renders from it |
| `GET`  | `/health` | Health check (unprefixed) |

## Security Scanning

Every analysis runs two Trivy scans concurrently with the AI optimization, so scanning adds
no wall-clock time to the request:

| Scan | Command | Reports |
|------|---------|---------|
| Base image CVEs | `trivy image --scanners vuln <base>` | Real CVEs per package with installed → fixed versions |
| Dockerfile checks | `trivy config <Dockerfile>` | Misconfigurations (root user, missing `HEALTHCHECK`, …) |

Each unique `FROM` image is scanned once and cached for `TRIVY_CACHE_TTL_MINUTES`.

Trivy's filesystem cache is **single-writer** - two concurrent `trivy` processes sharing a
cache directory fail with `cache may be in use by another process`. Scans are therefore
serialized in-process (`TRIVY_MAX_CONCURRENT_SCANS=1`) and retried when an outside process
holds the lock. If you run multiple uvicorn workers, give each its own `TRIVY_CACHE_DIR`.

Base images that cannot be scanned are reported rather than silently dropped:

* `scratch` and references to earlier build stages are skipped as expected (`benign`)
* unresolved `ARG` interpolation, invalid refs, and `TRIVY_MAX_IMAGES` overflow mark the
  scan `partial` and are listed in `scanner.skippedImages`

The response carries `scanner.status` - `ok`, `partial`, `unavailable`, or `disabled` - and
the UI keys off it so a failed scan is never rendered as a clean result.

## Rule Engine

24 deterministic rules across size, security, performance and maintainability. No model
involved: the engine parses the Dockerfile, applies the rules, and returns the same answer
every time - which is what lets the extension lint on every keystroke, offline and free.

The engine exists **twice**: Python in `server/app/services/rule_engine.py`, TypeScript in
`vscode-extension/src/rules/engine.ts`. That duplication is deliberate (the editor cannot
afford a network round trip per character) and it is contained two ways:

* **User-facing text is never duplicated.** Both read `shared/rule-catalog.json`, so a hover in
  VS Code and a finding on the website cannot describe the same rule differently.
* **Detection is held to parity by a test.** `vscode-extension/scripts/check-parity.mjs` runs
  both engines over a corpus of Dockerfiles and fails on any disagreement about which rules
  fired, on which line, with which replacement, or what the scores were.

Findings carry a diagnostic range *and* a separate fix range, because the squiggle belongs under
the image name while the edit has to rewrite the whole instruction.

Scores come from this engine rather than the model: they are reproducible, every point lost
traces to a listed finding, and they do not move when the AI is unavailable.

## Rate Limiting & Fallback

The AI provider's quota is per model and small. Three mechanisms, all in
`services/rate_limiter.py` (mechanism) and `services/model_scheduler.py` (policy):

* **Metering** - each model has a sliding-window counter. A request that would exceed it waits
  for a slot rather than being sent and rejected. The slot is claimed *before* the call, so
  concurrent analyses cannot over-admit.
* **Fallback** - a model that is cooling down, throttled, or simply further from a free slot than
  a sibling is skipped. A preferred model within one second of the best is still preferred, so
  nobody is bumped off their choice for a trivial gain.
* **Retry** - transient failures are retried with the offending model put in cooldown, so the
  retry lands elsewhere. A rejected API key is treated as fatal, since it dooms every model.

When everything is exhausted the API returns `429` with `Retry-After`. When a fallback model
answered, the response says so in `scheduling` - a substitution is never silent.

Health probes are quota-aware: a probe *is* a real completion, so probing three models would
otherwise consume three of the five requests a minute allows. The registry reports
"quota used, free in Ns" without spending a request.

## Testing

```bash
# Backend unit tests (133)
cd server && PYTHONPATH=. ./venv/bin/python -m pytest

# 48 of these need a real MongoDB: the shared quota counter and the single-use email tokens
# are both guarded by atomic database operations, and an in-memory fake would reproduce the
# happy path and none of the protections. Without one they skip loudly rather than passing
# on a fake, so run this first:
docker run -d --rm --name imageshrink-test-mongo -p 27017:27017 mongo:7

# ...then stop it when you are done. Nothing else needs it — the app itself talks to Atlas.
docker stop imageshrink-test-mongo

# Or point at any instance you already have:
#   export MONGO_TEST_URI=mongodb://host:27017

# Integration against a real MongoDB. Each creates and deletes a throwaway account.
PYTHONPATH=. ./venv/bin/python scripts/check_auth_flow.py       # 50 checks
PYTHONPATH=. ./venv/bin/python scripts/check_analysis_flow.py   # 41 checks, 1 real AI call

# The TS and Python rule engines must agree exactly, and the extension must work offline
cd vscode-extension && npm test
```

## Deployment

| Piece | Runs on |
|---|---|
| Website | Any static host - it is a plain Vite build |
| API | Any container host |
| Database | MongoDB, or any MongoDB-compatible service |

Build the API image from the **repository root**, not `server/` - the backend reads `shared/` at
runtime and Docker cannot copy from outside the build context:

```bash
docker build -f server/Dockerfile -t imageshrink-api .
docker run -p 8000:8000 -e JWT_SECRET=dev \
  -e MONGO_URI="mongodb://host.docker.internal:27017/imageshrink_ai" imageshrink-api
```

The image runs as an unprivileged user and carries a `HEALTHCHECK` that hits `/health`. Sizes,
measured:

| Build | Size | Trade |
|---|---|---|
| default | ~650 MB | first scan after each restart downloads the CVE database |
| `--build-arg BAKE_TRIVY_DB=true` | ~1.86 GB | scans work immediately, slower image pull |

Container storage is wiped on restart, so a database downloaded at runtime is downloaded again
every time. On a host that restarts often, baking it in is usually the better trade.

Pair it with `--build-arg TRIVY_DB_DATE=$(date +%Y-%m-%d)`. The download step never changes, so
Docker otherwise reuses that layer indefinitely and the baked database silently goes stale - a
scanner that reports nothing because it knows nothing.

Two settings are easy to miss and break things quietly:

- The container listens on **8000**. Hosts that inject their own port expect to be told this.
- **`ALLOWED_ORIGINS`** must match the browser's address exactly - scheme, host, no trailing slash.

`VITE_API_URL` is inlined into the frontend bundle at **build** time, so changing the API address
means rebuilding and redeploying the website, not just editing a setting.

## Distribution

Published on the Visual Studio Marketplace as **`imageshrink.imageshrink-ai`**. Search
"ImageShrink" in the Extensions view, or:

```bash
code --install-extension imageshrink.imageshrink-ai
```

To publish an update:

```bash
cd vscode-extension
npm version patch          # or minor / major
npm test                   # typecheck + engine parity + offline analysis
npx vsce publish
```

Nothing needs reconfiguring first - the extension is standalone and has no backend URLs baked in.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, MUI v9, React Router v6 |
| Backend | FastAPI, Python 3.12, Uvicorn |
| Database | MongoDB (async via Motor) |
| AI | Groq Cloud (`openai/gpt-oss-120b`) |
| Security | Trivy CLI (image CVEs + Dockerfile misconfig) |
| Extension | TypeScript, VS Code API ^1.95, esbuild |
| Styling | MUI dark theme + custom CSS |
