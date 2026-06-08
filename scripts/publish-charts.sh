#!/bin/bash
# Build benchmark charts and publish them to the `docs` branch under
# charts/v<version>/<NN>-<short HEAD sha>/. NN is a zero-padded, per-version
# sequence so folders sort lexically and the highest NN is the latest update for
# that version. The README's <img> tags are re-pinned to the published path, so a
# README revision references the charts built from its code. (Re-publishing the
# same commit overwrites its folder rather than allocating a new NN.)
#
# Adapted from json-as/scripts/publish-benchmarks.sh (worktree -> docs branch).
#
# Usage:
#   ./scripts/publish-charts.sh [--no-run] [--v8|--wavm|--wasmtime|--wazero ...]
#     --no-run   reuse existing build/logs instead of re-running benches
#     runtime    one or more; defaults to --wavm (matches the embedded charts)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REMOTE_NAME="${REMOTE_NAME:-origin}"
DOCS_BRANCH="${DOCS_BRANCH:-docs}"
SHA="$(git rev-parse --short HEAD)"
VERSION="$(node -p "require('./package.json').version")"
# DEST (charts/v<version>/<NN>-<commit>/) is computed after the docs worktree is
# ready, so the NN sequence can be derived from what's already published.
RUN_BENCHES=1
RT_ARGS=()
TMP_CHARTS_DIR="$(mktemp -d)"
TMP_DOCS_DIR="$(mktemp -d)"
WORKTREE_ADDED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-run) RUN_BENCHES=0; shift ;;
    --v8|--wavm|--llvm|--wasmtime|--wazero) RT_ARGS+=("$1"); shift ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ./scripts/publish-charts.sh [--no-run] [--v8|--wavm|--wasmtime|--wazero]"
      exit 1
      ;;
  esac
done
# Default runtime: WAVM (LLVM AOT; matches the embedded README charts).
[[ ${#RT_ARGS[@]} -eq 0 ]] && RT_ARGS=(--wavm)

cleanup() {
  rm -rf "$TMP_CHARTS_DIR"
  if [[ "$WORKTREE_ADDED" == "1" ]]; then
    git worktree remove --force "$TMP_DOCS_DIR" >/dev/null 2>&1 || true
  else
    rm -rf "$TMP_DOCS_DIR"
  fi
}
trap cleanup EXIT

# A dirty working tree is fine: charts are committed on a separate `docs`
# worktree, so the publish never touches the current branch's tracked files.

if [[ "$RUN_BENCHES" == "1" ]]; then
  for rt in "${RT_ARGS[@]}"; do
    echo "Running benchmarks ($rt)..."
    bash ./scripts/run-bench.sh "$rt"
  done
else
  echo "Skipping benchmark runs. Reusing existing logs."
fi

echo "Building charts (${RT_ARGS[*]})..."
for rt in "${RT_ARGS[@]}"; do
  bash ./scripts/build-charts.sh "$rt"
done
test -d ./charts
compgen -G "./charts/*.png" > /dev/null
cp -R ./charts/. "$TMP_CHARTS_DIR/"

echo "Preparing ${DOCS_BRANCH} worktree..."
git fetch "$REMOTE_NAME" "$DOCS_BRANCH" >/dev/null 2>&1 || true
if git show-ref --verify --quiet "refs/remotes/${REMOTE_NAME}/${DOCS_BRANCH}"; then
  git worktree add --detach "$TMP_DOCS_DIR" "refs/remotes/${REMOTE_NAME}/${DOCS_BRANCH}" >/dev/null
  WORKTREE_ADDED=1
  ( cd "$TMP_DOCS_DIR"; git checkout -B "$DOCS_BRANCH" >/dev/null )
else
  git worktree add --detach "$TMP_DOCS_DIR" >/dev/null
  WORKTREE_ADDED=1
  ( cd "$TMP_DOCS_DIR"; git checkout --orphan "$DOCS_BRANCH" >/dev/null; git rm -rf . >/dev/null 2>&1 || true )
fi

# Sequence within this version: charts/v<version>/<NN>-<sha>/, zero-padded so the
# folders sort lexically and the highest NN is the latest update for the version.
# Re-publishing the same commit reuses (overwrites) its existing folder.
VERDIR="$TMP_DOCS_DIR/charts/v${VERSION}"
mkdir -p "$VERDIR"
existing="$(ls -1d "$VERDIR"/*-"${SHA}" 2>/dev/null | head -1 || true)"
if [[ -n "$existing" ]]; then
  DEST="v${VERSION}/$(basename "$existing")"
else
  last="$(ls -1 "$VERDIR" 2>/dev/null | grep -oE '^[0-9]+' | sort -n | tail -1 || true)"
  SEQ="$(printf '%02d' "$(( 10#${last:-0} + 1 ))")"
  DEST="v${VERSION}/${SEQ}-${SHA}"
fi

echo "Updating charts/${DEST} on ${DOCS_BRANCH}..."
rm -rf "$TMP_DOCS_DIR/charts/${DEST}"
mkdir -p "$TMP_DOCS_DIR/charts/${DEST}"
cp -R "$TMP_CHARTS_DIR/." "$TMP_DOCS_DIR/charts/${DEST}/"

(
  cd "$TMP_DOCS_DIR"
  git add -A charts
  if git diff --cached --quiet; then
    echo "No chart changes to publish for ${DEST}."
    exit 0
  fi
  git config user.name "${GIT_AUTHOR_NAME:-$(git config --get user.name || echo xjb-as)}"
  git config user.email "${GIT_AUTHOR_EMAIL:-$(git config --get user.email || echo xjb-as@example.com)}"
  git commit -m "Update benchmark charts for ${DEST} [skip ci]" >/dev/null
  git push "$REMOTE_NAME" "$DOCS_BRANCH"
)

# Re-pin the README chart <img> URLs to the version/commit just published, so a
# README revision references the charts built from its own code. Left uncommitted.
echo "Pinning README chart URLs to ${DEST}..."
sed -i -E "s#(/docs/charts/)[^\"']*/([^/\"']+\.png)#\1${DEST}/\2#g" README.md

echo "Charts published to ${REMOTE_NAME}/${DOCS_BRANCH}:charts/${DEST}/ (old folders pruned)"
echo "README pinned to https://raw.githubusercontent.com/JairusSW/xjb-as/refs/heads/docs/charts/${DEST}/"
