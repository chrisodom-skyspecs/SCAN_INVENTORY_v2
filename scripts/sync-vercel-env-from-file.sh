#!/usr/bin/env bash
# Push environment variables FROM a local dotenv FILE to Vercel (non-interactive).
#
# Uses stdin piping for values so secrets are not copied into shell argv (`ps`).
#
# Prerequisites:
#   npm i -g vercel   OR   use `npx vercel@latest` (default below)
#   From repo root (linked project):  npx vercel@latest link
#
# Usage:
#   ./scripts/sync-vercel-env-from-file.sh .env.vercel.production.local production
#   ./scripts/sync-vercel-env-from-file.sh .env.vercel.preview.local preview
#
# Targets: production | preview | development (third arg overrides default)
#
# Skips empty values, blank lines, comments (#...), VERCEL_/NX_/TURBO_/NODE_ENV_* noise.
#
# Sensitive handling:
#   --no-sensitive only for NEXT_PUBLIC_* (readable in dashboard / client bundle anyway).
#   Everything else relies on Vercel defaults for production/preview classification.

set -euo pipefail

ENV_FILE="${1:?Usage: $0 <path-to-dotenv> [production|preview|development>]}"
ENV_TARGET="${2:-production}"
# shellcheck disable=SC2209
declare -a VERCEL_CMD
VERCEL_CMD=(npx --yes vercel@latest)
if [[ "${VERCEL_CLI:-}" == "global" ]] && command -v vercel >/dev/null 2>&1; then
  VERCEL_CMD=(vercel)
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "File not found: $ENV_FILE" >&2
  exit 1
fi

trim() {
  sed 's/^ *//;s/ *$//'
}

while IFS= read -r raw || [[ -n "$raw" ]]; do
  line="$(printf '%s' "$raw" | tr -d '\r')"
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  kv="${line#export }"
  [[ "$kv" != *=* ]] && continue
  key="${kv%%=*}"
  key="$(printf '%s' "$key" | trim)"
  val="${kv#*=}"
  val="$(printf '%s' "$val" | trim)"
  # Strip one layer of wrapping quotes if present
  if [[ "$val" =~ ^\'(.*)\'$ ]]; then
    val="${BASH_REMATCH[1]}"
  elif [[ "$val" =~ ^\"(.*)\"$ ]]; then
    val="${BASH_REMATCH[1]}"
  fi

  [[ -z "$key" ]] && continue

  if [[ "$key" =~ ^(VERCEL_|NX_|TURBO_) ]] || [[ "$key" == "NODE_ENV" ]]; then
    echo "[skip-meta] $key" >&2
    continue
  fi

  if [[ -z "$val" ]]; then
    echo "[skip-empty] $key" >&2
    continue
  fi

  extras=()
  if [[ "$key" == NEXT_PUBLIC_* ]]; then
    extras+=(--no-sensitive)
  fi

  if [[ ${#extras[@]} -gt 0 ]]; then
    printf '%s' "$val" | "${VERCEL_CMD[@]}" env add "$key" "$ENV_TARGET" "${extras[@]}" --yes --force
  else
    printf '%s' "$val" | "${VERCEL_CMD[@]}" env add "$key" "$ENV_TARGET" --yes --force
  fi


  echo "[ok] $key → $ENV_TARGET" >&2
done <"$ENV_FILE"

echo "Done. Redeploy the project so build/runtime picks up env changes."
