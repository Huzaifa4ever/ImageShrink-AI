# ImageShrink AI - Docker Image Optimizer for VS Code

Build smaller, faster, safer Docker images without leaving your editor.

ImageShrink analyses your Dockerfile as you type, explains what each problem costs you in
megabytes, and fixes most of them with one click.

---

## What it does

### Linting as you type

Open a Dockerfile and findings appear immediately - no command to run, no refresh. The
built-in rule engine runs entirely on your machine, so it works offline, costs nothing, and
adds no latency to typing.

24 rules covering:

| | |
|---|---|
| **Size** | oversized base images, missing multi-stage builds, `devDependencies` in production, apt/pip/apk caches left in layers, `COPY . .` with no `.dockerignore` |
| **Security** | unpinned and floating tags, containers running as root, hardcoded credentials, `curl \| sh`, `sudo` in images |
| **Performance** | source copied before dependency installs (the single biggest build-time mistake), `apt-get update` stranded in its own layer, avoidable layer count |

### Quick fixes

Every finding that can be fixed exactly offers a light-bulb fix, like ESLint. Nothing is
guessed: if the engine cannot produce a correct replacement, it offers no fix rather than a
plausible-looking one.

- `FROM node` → `FROM node:22-alpine`, with the size difference and a compatibility estimate
- `RUN npm install` → `RUN npm ci --omit=dev`
- `apt-get install …` → adds `--no-install-recommends` and cleans up `/var/lib/apt/lists`
- Missing `USER` → inserts a correct non-root block for *your* base image (`USER node` for
  Node images, busybox `adduser` on Alpine, `USER 65534:65534` on distroless and scratch)
- No `.dockerignore` → generates one
- **Fix all** applies every safe fix at once, skipping any that would overlap

### Hovers that explain

Hover any flagged instruction to see the problem, why it matters, the estimated image cost,
what fixing it saves, the security and performance consequences, and a link to the relevant
Docker documentation.

### IntelliSense for base images

Type `FROM no` and get `node:22-alpine` **before** `node:22`, annotated with its size, the
saving, and how likely the swap is to be drop-in - so the smaller option is the obvious one
rather than the one you have to already know about.

### Full AI analysis

`ImageShrink: Analyze Dockerfile` (`Ctrl+Alt+D`) sends your Dockerfile, plus your
`.dockerignore` and dependency manifest for context, and returns:

- a production-ready multi-stage rewrite you can apply or open side by side
- estimated size before and after, with the model's stated confidence
- a Trivy CVE scan of your base images, grouped by severity
- a layer-by-layer breakdown of what changed and why

Results are saved to your account and appear in both the sidebar and the web dashboard.

### Sidebar

An Activity Bar panel with your optimization, security and performance scores, the image size
estimate, every current suggestion (click to jump to the line), and your recent analyses from
both VS Code and the web.

---

## Installing

This extension is **not on the Visual Studio Marketplace** - searching the Extensions view will
not find it. It is built and installed from the
[ImageShrink-AI repository](https://github.com/Huzaifa4ever/ImageShrink-AI).

Requires Node.js 20+, VS Code 1.95+, and the `code` command on your PATH.

```bash
git clone https://github.com/Huzaifa4ever/ImageShrink-AI.git
cd ImageShrink-AI/vscode-extension
npm install
npm run install-local
```

Then run **Developer: Reload Window** from the command palette.

`install-local` packages the extension and installs it with `--force`, so re-running it after a
`git pull` upgrades in place.

### Without the `code` command

Build the package and install it through the UI - Extensions view → `…` menu →
**Install from VSIX…**:

```bash
npm run vsix        # → imageshrink-ai.vsix
```

### Developing

Open the `vscode-extension` folder in VS Code and press <kbd>F5</kbd> to launch an Extension
Development Host with the extension loaded. `npm run watch` rebuilds as you edit.

The extension reads its rule data from `shared/` at the repository root, copied in at build time
by `scripts/sync-shared.mjs`, so it must be built from inside a checkout.

## Getting started

1. Install as above and reload the window.
2. Open a Dockerfile - linting starts straight away, no account needed.
3. For AI analysis, run **ImageShrink: Sign In**. A code appears; approve it in your browser.

Sign-in uses the OAuth device flow, so it works the same over SSH, in Dev Containers and in
Codespaces. Your token is stored in the OS keychain via VS Code's `SecretStorage` - never in a
settings file and never on disk in clear.

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| `imageshrink.useLocalRulesOnly` | `false` | Never contact the backend. Nothing leaves your machine. Overrides every setting below. |
| `imageshrink.enableAiSuggestions` | `true` | Include AI suggestions |
| `imageshrink.useAiBackend` | `true` | Allow full AI analysis on demand |
| `imageshrink.enableAutoAnalysis` | `true` | Analyse automatically |
| `imageshrink.analyzeWhileTyping` | `true` | Re-lint after a pause in typing |
| `imageshrink.analyzeOnSave` | `true` | Re-lint on save |
| `imageshrink.sendWorkspaceContext` | `true` | Include `.dockerignore` and `package.json` with AI analysis |
| `imageshrink.minimumSeverity` | `info` | Hide findings below this severity |
| `imageshrink.diagnosticsSeverity` | `warning` | How findings appear in the Problems panel |
| `imageshrink.debounceMs` | `400` | Pause before re-linting |
| `imageshrink.model` | *(server default)* | Preferred AI model |
| `imageshrink.apiUrl` | `http://localhost:8000/api/v1` | Backend URL |
| `imageshrink.webUrl` | `http://localhost:5173` | Website URL |
| `imageshrink.telemetry` | `false` | Anonymous usage data. Off by default. |

## What gets sent, and when

- **Linting** - nothing. It runs locally.
- **`Analyze Dockerfile`** - your Dockerfile, and (if `sendWorkspaceContext` is on) your
  `.dockerignore` and dependency manifest. Only when you invoke the command.
- **`useLocalRulesOnly`** - a hard switch. With it on, the extension makes no network requests
  at all, including sign-in.

Size figures are estimates derived from typical image sizes, not measurements of your build.
They are labelled as estimates everywhere they appear. Build both images to compare for
certain.

---

## Commands

| Command | Keybinding |
|---|---|
| ImageShrink: Analyze Dockerfile | `Ctrl+Alt+D` / `Cmd+Alt+D` |
| ImageShrink: Optimize Dockerfile (rewrite with AI) | |
| ImageShrink: Apply Optimized Dockerfile | |
| ImageShrink: Create .dockerignore | |
| ImageShrink: Show Last Report | |
| ImageShrink: Sign In / Sign Out | |
| ImageShrink: Show Log | |

## Requirements

The AI features need an ImageShrink backend. Set `imageshrink.apiUrl` to your instance. The
rule engine, quick fixes, hovers and IntelliSense need nothing - no account, no network.

## License

MIT
