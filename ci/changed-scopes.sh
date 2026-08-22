#!/bin/sh

set -eu

BASE="${1:-}"

emit_all_true() {
  cat <<'EOF'
REASON=full
BACKEND=true
FRONTEND=true
PARITY=true
DEPLOY_API=true
DEPLOY_WEB=true
EOF
}

if [ -z "$BASE" ]; then
  echo "# no base commit supplied - running the full pipeline" >&2
  emit_all_true
  exit 0
fi

if ! git cat-file -e "${BASE}^{commit}" 2>/dev/null; then
  echo "# base commit $BASE is not in this repository (force push?) - running the full pipeline" >&2
  emit_all_true
  exit 0
fi

CHANGED=$(git diff --name-only "$BASE" HEAD)

if [ -z "$CHANGED" ]; then
  echo "# no file changes against $BASE - nothing to build" >&2
  cat <<'EOF'
REASON=nothing
BACKEND=false
FRONTEND=false
PARITY=false
DEPLOY_API=false
DEPLOY_WEB=false
EOF
  exit 0
fi

echo "# changed files against $BASE:" >&2
printf '%s\n' "$CHANGED" | sed 's/^/#   /' >&2

CODE=$(printf '%s\n' "$CHANGED" | grep -vE '(\.md$|^LICENSE$|^docs/|^\.gitignore$|^\.github/)' || true)

if [ -z "$CODE" ]; then
  echo "# documentation and repo metadata only - no build, test or deploy needed" >&2
  cat <<'EOF'
REASON=docs-only
BACKEND=false
FRONTEND=false
PARITY=false
DEPLOY_API=false
DEPLOY_WEB=false
EOF
  exit 0
fi

matches() {
  printf '%s\n' "$CODE" | grep -qE "$1"
}

if matches '^(Jenkinsfile|\.dockerignore$|ci/)'; then
  echo "# the pipeline itself changed - running the full pipeline" >&2
  emit_all_true
  exit 0
fi

BACKEND=false
FRONTEND=false
PARITY=false

if matches '^(server/|shared/)'; then BACKEND=true; fi
if matches '^client/'; then FRONTEND=true; fi
if matches '^(vscode-extension/|server/|shared/)'; then PARITY=true; fi

cat <<EOF
REASON=scoped
BACKEND=$BACKEND
FRONTEND=$FRONTEND
PARITY=$PARITY
DEPLOY_API=$BACKEND
DEPLOY_WEB=$FRONTEND
EOF
