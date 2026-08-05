# Changelog

## 1.0.0

First release.

- Local rule engine with 24 Dockerfile rules across size, security, performance and
  maintainability, running as you type with no network access
- Quick fixes for every rule where an exact replacement can be derived, plus a "fix all"
  action that skips overlapping edits rather than corrupting a line
- Hover cards giving the problem, explanation, estimated image cost, estimated saving, and the
  security and performance consequences of each finding
- Base-image IntelliSense that ranks smaller images first, annotated with size savings and a
  compatibility estimate
- Full AI analysis: multi-stage rewrite, size estimates, Trivy CVE scan and layer breakdown,
  shown in a report panel and saved to your account
- Activity Bar sidebar with optimization, security and performance scores, current suggestions
  and combined VS Code + web history
- Device-flow sign-in with tokens held in the OS keychain, working over SSH, in Dev Containers
  and in Codespaces
- `useLocalRulesOnly` as a hard offline switch
