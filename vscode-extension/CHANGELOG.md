# Changelog

## 1.0.1

- Converted ImageShrink into a fully standalone, offline VS Code extension.
- No account, backend, or API connection required.
- Added local Docker and Trivy integration.
- Updated documentation and Marketplace presentation.

### Analysis

- 24 Dockerfile rules across size, security, performance and maintainability, checked as you type
- Quick fixes wherever an exact replacement can be derived, plus a "fix all" action that skips
  overlapping edits rather than corrupting a line
- Hover cards with the problem, why it matters, estimated image cost, estimated saving, and the
  security and performance consequences
- Base-image IntelliSense ranking smaller images first, annotated with the saving and a
  compatibility estimate

### Size

- Estimates the image size before and after applying every fix, broken down into the base image
  and what each `RUN` and `COPY` adds
- Uses the local Docker daemon to **measure** base images you have already pulled; falls back to
  a published figure otherwise. The report always says which. Images are never pulled.

### Security

- Scans base images for known CVEs with [Trivy](https://trivy.dev) if it is installed, grouped by
  severity with fixed versions where they exist
- Runs Trivy's Dockerfile checks alongside the built-in rules
- Reports plainly when Trivy is missing rather than showing an unscanned image as clean

### Optimized Dockerfile

- Generates a rewrite from the rules alone - deterministic, with every change listed
- Reorders `COPY` and dependency installs so editing a source file no longer reinstalls every
  dependency
- Applies fixes over several passes, so rules competing for the same instruction all land
  (`npm install` reaches `npm ci --omit=dev`, not just one of the two)
- Side-by-side diff before you apply anything
- Leaves a commented skeleton rather than guessing at a multi-stage conversion, and flags the
  result for review

### Interface

- Activity Bar sidebar with scores, size, suggestions and vulnerabilities
- Status bar showing the optimization score
- Full report in a webview, with all external text escaped
