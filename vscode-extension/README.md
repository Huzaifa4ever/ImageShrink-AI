# ImageShrink - Docker Image Optimizer for VS Code

Build smaller, faster, safer Docker images without leaving your editor.

ImageShrink checks your Dockerfile as you type, explains what each problem costs you in
megabytes, and fixes most of them with one click.

**No account. No sign-in. No servers.** Everything runs on your machine.

---

## What it does

### Checks your Dockerfile as you type

Open a Dockerfile and findings appear immediately - no command to run, no refresh. The rule
engine is bundled into the extension, so it works offline and adds no latency to typing.

24 rules covering:

| | |
|---|---|
| **Size** | oversized base images, missing multi-stage builds, `devDependencies` in production, apt/pip/apk caches left in layers, `COPY . .` with no `.dockerignore` |
| **Security** | unpinned and floating tags, containers running as root, hardcoded credentials, `curl \| sh`, `sudo` in images |
| **Performance** | source copied before dependency installs (the biggest build-time mistake), `apt-get update` stranded in its own layer, avoidable layer count |

### Fixes them with one click

Every finding that can be fixed exactly offers a light-bulb fix, like ESLint. Nothing is
guessed: if the engine cannot produce a correct replacement, it offers no fix rather than a
plausible-looking one.

- `FROM node` → `FROM node:22.11-alpine`, with the size difference and a compatibility estimate
- `RUN npm install` → `RUN npm ci --omit=dev`
- `apt-get install …` → adds `--no-install-recommends` and cleans up `/var/lib/apt/lists`
- Missing `USER` → inserts a correct non-root block for *your* base image (`USER node` on Node
  images, busybox `adduser` on Alpine, `USER 65534:65534` on distroless and scratch)
- No `.dockerignore` → generates one
- **Fix all** applies every safe fix at once, skipping any that would overlap

### Explains itself

Hover any flagged instruction for the problem, why it matters, the estimated image cost, what
fixing it saves, the security and performance consequences, and a link to the relevant Docker
documentation.

### Suggests better base images

Type `FROM no` and get `node:22.11-alpine` **before** `node:22`, annotated with its size, the
saving, and how likely the swap is to be drop-in - so the smaller option is the obvious one
rather than the one you have to already know about.

### Estimates image size

Shows the size before and after applying every fix, broken down into the base image and what
each `RUN` and `COPY` adds.

If you have Docker installed and the base image already pulled, the base size is **measured**
from your local daemon. Otherwise it uses a published figure. Either way the report says which,
because a guess presented as a measurement is worse than no number at all. Images are never
pulled - that is a large download you did not ask for.

### Scans for vulnerabilities

`ImageShrink: Analyze Dockerfile` scans your base images for known CVEs using
**[Trivy](https://trivy.dev)**, grouped by severity, with the fixed version where one exists.

Trivy is a single binary you install separately. If it is missing, the extension says so plainly
- it never reports an unscanned image as clean.

### Generates an optimized Dockerfile

Applies every available fix, reorders `COPY` and install steps for layer caching, and shows the
result as a side-by-side diff you can apply or copy.

This is a deterministic rewrite from the rules - the same input always produces the same output,
and every change is listed. It will not restructure a single-stage build into a multi-stage one,
because that needs knowledge of which build outputs matter. It leaves a commented skeleton and
flags the result for review instead of guessing.

---

## Installing

Requires **VS Code 1.95+**. Optional: **Trivy** for CVE scanning, **Docker** for measured base
image sizes.

### From the Marketplace

Search for **ImageShrink** in the Extensions view, or:

```
ext install imageshrink.imageshrink-ai
```

### From source

Requires Node.js 20+ and the `code` command on your PATH.

```bash
git clone https://github.com/Huzaifa4ever/ImageShrink-AI.git
cd ImageShrink-AI/vscode-extension
npm install
npm run install-local
```

Then run **Developer: Reload Window**.

### Enabling CVE scanning

Install Trivy - see the [installation guide](https://github.com/aquasecurity/trivy#installation).

On Ubuntu/Debian:

```bash
sudo apt-get install -y wget gnupg
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor | sudo tee /usr/share/keyrings/trivy.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" | sudo tee /etc/apt/sources.list.d/trivy.list
sudo apt-get update && sudo apt-get install -y trivy
```

On macOS: `brew install trivy`

Then run **ImageShrink: Check Security Scanner** to confirm it is detected.

---

## Commands

| Command | Keybinding |
|---|---|
| ImageShrink: Analyze Dockerfile | `Ctrl+Alt+D` / `Cmd+Alt+D` |
| ImageShrink: Preview Optimized Dockerfile | |
| ImageShrink: Apply Optimized Dockerfile | |
| ImageShrink: Create .dockerignore | |
| ImageShrink: Show Report | |
| ImageShrink: Check Security Scanner | |
| ImageShrink: Show Log | |

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| `imageshrink.enableAutoAnalysis` | `true` | Check Dockerfiles automatically |
| `imageshrink.analyzeWhileTyping` | `true` | Re-check after a pause in typing |
| `imageshrink.analyzeOnSave` | `true` | Re-check on save |
| `imageshrink.debounceMs` | `400` | Pause before re-checking |
| `imageshrink.minimumSeverity` | `info` | Hide findings below this severity |
| `imageshrink.diagnosticsSeverity` | `warning` | How findings appear in the Problems panel |
| `imageshrink.security.enabled` | `true` | Scan base images with Trivy |
| `imageshrink.security.trivyPath` | `trivy` | Path to the Trivy executable |
| `imageshrink.security.severities` | `CRITICAL,HIGH,MEDIUM,LOW` | Severities to report |
| `imageshrink.security.maxImages` | `4` | Most base images scanned per analysis |
| `imageshrink.security.maxFindings` | `100` | Most CVEs displayed |
| `imageshrink.security.timeoutSeconds` | `120` | Scan timeout |
| `imageshrink.security.cacheMinutes` | `60` | How long to reuse a scan result |
| `imageshrink.size.useDocker` | `true` | Measure base image sizes with local Docker |

---

## Privacy

**This extension sends nothing anywhere.** There is no account, no telemetry, no analytics, and
no backend. It has no network code of its own at all.

Two optional features run programs already on your machine:

- **Trivy** (`imageshrink.security.enabled`) reads your base image names and queries its
  vulnerability database. Trivy contacts image registries to fetch image metadata - that is
  Trivy's own network access, under its own configuration, not the extension's.
- **Docker** (`imageshrink.size.useDocker`) is asked for the size of images you have already
  pulled. It never pulls anything.

Turn either off and the extension is completely offline.

Size figures are estimates derived from typical image sizes unless the report says *measured*.
Build both images to compare for certain.

---

## Limitations

Worth knowing before you rely on it:

- **Size figures are estimates.** Layer sizes are heuristics based on typical projects, not a
  simulation of your build. They are useful for ranking problems, not for capacity planning.
- **Multi-stage conversion is not automatic.** The optimizer leaves a commented skeleton because
  choosing which build outputs to copy forward needs knowledge of your project.
- **CVE scanning covers base images, not your application dependencies.** Trivy scans the
  packages inside the image you build *from*.
- **`.dockerignore` matching is approximate** when deciding which workspace folders to mention
  as bloat. It uses exact and simple wildcard matches, not full `filepath.Match` semantics.

---

## Contributing

The rule catalog lives in
[`shared/rule-catalog.json`](https://github.com/Huzaifa4ever/ImageShrink-AI/blob/main/shared/rule-catalog.json)
- adding a rule means adding an entry there plus detection logic in `src/rules/engine.ts`.

Absolute URL on purpose: `vsce` rewrites relative links against the extension folder, and a
`../` path escapes it into a broken `/blob/HEAD/../` URL on the Marketplace page.

```bash
npm install
npm run watch      # rebuild on save; press F5 for an Extension Development Host
npm test           # typecheck + rule engine parity
```

## License

MIT
