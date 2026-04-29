#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-vercel-preview-secrets.sh
#
# Adds the sensitive Kinde/FedEx/Mapbox secrets to the Vercel Preview
# environment so PR preview deployments have working auth, FedEx tracking,
# and map tiles.
#
# These vars cannot be read from Vercel's encrypted store — you must obtain
# the actual values from each service's dashboard.
#
# Prerequisites:
#   • Vercel CLI authenticated: vercel whoami
#   • jq installed: brew install jq  (used to build JSON payload)
#   • Working directory must be this repo root (where .vercel/project.json lives).
#
# Usage:
#   # Interactive (prompts for each secret):
#   bash scripts/setup-vercel-preview-secrets.sh
#
#   # Non-interactive (set all vars in environment first):
#   export KINDE_CLIENT_ID=xxx
#   export KINDE_CLIENT_SECRET=xxx
#   export KINDE_ISSUER_URL=https://skyspecs.kinde.com
#   export KINDE_MANAGEMENT_CLIENT_ID=xxx     # optional
#   export KINDE_MANAGEMENT_CLIENT_SECRET=xxx # optional
#   export FEDEX_CLIENT_ID=xxx
#   export FEDEX_CLIENT_SECRET=xxx
#   export FEDEX_ACCOUNT_NUMBER=xxx           # optional
#   export NEXT_PUBLIC_MAPBOX_TOKEN=pk.xxx
#   bash scripts/setup-vercel-preview-secrets.sh
#
# Sources for each secret:
#   Kinde   → https://app.kinde.com → Applications → [skyspecs] → App keys
#   FedEx   → https://developer.fedex.com → Dashboard → Credentials
#   Mapbox  → https://account.mapbox.com/access-tokens/
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

info()  { echo "  [info]  $*"; }
ok()    { echo "  [ok]    $*"; }
warn()  { echo "  [warn]  $*"; }
fatal() { echo "  [fatal] $*"; exit 1; }

# ── Project configuration ────────────────────────────────────────────────────
TEAM_ID="team_n4NbdiHU7qyqch0bcJ9cg87d"
PROJECT_ID="prj_Vy3jdhT7G3ltYsXmDsuhMskfaaYH"

# ── Vercel token ─────────────────────────────────────────────────────────────
AUTH_FILE="${HOME}/Library/Application Support/com.vercel.cli/auth.json"
if [[ -f "$AUTH_FILE" ]]; then
  VERCEL_TOKEN=$(python3 -c "import json; print(json.load(open('${AUTH_FILE}'))['token'])" 2>/dev/null || true)
fi

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  # Try from env or CLI
  VERCEL_TOKEN="${VERCEL_TOKEN:-$(vercel whoami --token "$VERCEL_TOKEN" 2>/dev/null | grep -o 'Bearer .*' | cut -d' ' -f2 || true)}"
fi

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  fatal "Cannot find Vercel auth token. Run 'vercel login' first."
fi

# ── API helpers ───────────────────────────────────────────────────────────────

# Add or overwrite a Vercel environment variable for a given target and env id
# Usage: vercel_patch_env ENV_ID "value"
# Returns the updated key name
vercel_patch_env() {
  local env_id="$1"
  local value="$2"

  python3 << PYEOF
import json, urllib.request, urllib.error

token = "${VERCEL_TOKEN}"
team_id = "${TEAM_ID}"
project_id = "${PROJECT_ID}"
env_id = "${env_id}"
value = """${value}"""

url = f"https://api.vercel.com/v9/projects/{project_id}/env/{env_id}?teamId={team_id}"
data = json.dumps({"value": value, "type": "sensitive"}).encode()
req = urllib.request.Request(url, data=data, method="PATCH", headers={
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
})
try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        print("ok:" + result.get("key", ""))
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print("error:" + str(e.code) + " " + body[:200])
PYEOF
}

# Add a NEW Vercel env var (for keys that don't exist yet in the target env)
# Usage: vercel_add_env "KEY" "value" "preview|production"
vercel_add_env() {
  local key="$1"
  local value="$2"
  local target="$3"

  python3 << PYEOF
import json, urllib.request, urllib.error

token = "${VERCEL_TOKEN}"
team_id = "${TEAM_ID}"
project_id = "${PROJECT_ID}"

url = f"https://api.vercel.com/v10/projects/{project_id}/env?teamId={team_id}"
payload = {
    "key": "${key}",
    "value": """${value}""",
    "type": "sensitive",
    "target": ["${target}"],
    "gitBranch": None
}
data = json.dumps(payload).encode()
req = urllib.request.Request(url, data=data, method="POST", headers={
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
})
try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        print("ok:" + result.get("key", ""))
except urllib.error.HTTPError as e:
    body = e.read().decode()
    d = {}
    try:
        d = json.loads(body)
    except: pass
    # If already exists, that's fine
    if e.code == 400 and "already exists" in body.lower():
        print("exists:${key}")
    else:
        print("error:" + str(e.code) + " " + body[:200])
PYEOF
}

# ── Prompt helper ────────────────────────────────────────────────────────────
prompt_secret() {
  local var_name="$1"
  local description="$2"
  local existing="${!var_name:-}"

  if [[ -n "$existing" ]]; then
    echo "     ${var_name}: (pre-set from environment, length ${#existing})"
    return
  fi

  read -rsp "     ${var_name} [${description}]: " "$var_name"
  echo ""
  export "${var_name}"
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SkySpecs INVENTORY+SCAN — Vercel Preview environment secret setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
info "Project: chrisodomskyspecscoms-projects / skyspecs-inventory"
info "Target:  Preview (all branches)"
echo ""

# ── Verify Vercel CLI access ─────────────────────────────────────────────────
if ! vercel whoami &>/dev/null; then
  fatal "Vercel CLI not authenticated. Run: vercel login"
fi

# ── 1. Kinde credentials ─────────────────────────────────────────────────────
echo "1/3  KINDE authentication credentials"
echo "     Source: https://app.kinde.com → Applications → [skyspecs] → App keys"
echo ""

prompt_secret "KINDE_CLIENT_ID"     "Client ID from Kinde app keys"
prompt_secret "KINDE_CLIENT_SECRET" "Client Secret from Kinde app keys"
prompt_secret "KINDE_ISSUER_URL"    "Domain URL, e.g. https://skyspecs.kinde.com"

echo ""
echo "     (Optional — Kinde Management API M2M application)"
prompt_secret "KINDE_MANAGEMENT_CLIENT_ID"     "M2M Client ID (press Enter to skip)"
prompt_secret "KINDE_MANAGEMENT_CLIENT_SECRET" "M2M Client Secret (press Enter to skip)"

if [[ -z "${KINDE_CLIENT_ID:-}" ]]; then
  warn "KINDE_CLIENT_ID is empty — skipping all Kinde vars."
else
  info "Adding Kinde vars to Preview..."

  result=$(vercel_add_env "KINDE_CLIENT_ID"    "$KINDE_CLIENT_ID"    "preview")
  [[ "$result" == ok:* ]] && ok "KINDE_CLIENT_ID" || warn "KINDE_CLIENT_ID: $result"

  result=$(vercel_add_env "KINDE_CLIENT_SECRET" "$KINDE_CLIENT_SECRET" "preview")
  [[ "$result" == ok:* || "$result" == exists:* ]] && ok "KINDE_CLIENT_SECRET" || warn "KINDE_CLIENT_SECRET: $result"

  result=$(vercel_add_env "KINDE_ISSUER_URL" "$KINDE_ISSUER_URL" "preview")
  [[ "$result" == ok:* || "$result" == exists:* ]] && ok "KINDE_ISSUER_URL" || warn "KINDE_ISSUER_URL: $result"

  if [[ -n "${KINDE_MANAGEMENT_CLIENT_ID:-}" ]]; then
    result=$(vercel_add_env "KINDE_MANAGEMENT_CLIENT_ID" "$KINDE_MANAGEMENT_CLIENT_ID" "preview")
    [[ "$result" == ok:* || "$result" == exists:* ]] && ok "KINDE_MANAGEMENT_CLIENT_ID" || warn "KINDE_MANAGEMENT_CLIENT_ID: $result"

    result=$(vercel_add_env "KINDE_MANAGEMENT_CLIENT_SECRET" "$KINDE_MANAGEMENT_CLIENT_SECRET" "preview")
    [[ "$result" == ok:* || "$result" == exists:* ]] && ok "KINDE_MANAGEMENT_CLIENT_SECRET" || warn "KINDE_MANAGEMENT_CLIENT_SECRET: $result"
  fi

  ok "Kinde vars complete."
fi

echo ""

# ── 2. FedEx credentials ─────────────────────────────────────────────────────
echo "2/3  FEDEX tracking API credentials"
echo "     Source: https://developer.fedex.com → Dashboard → Credentials"
echo ""

prompt_secret "FEDEX_CLIENT_ID"     "OAuth2 Client ID"
prompt_secret "FEDEX_CLIENT_SECRET" "OAuth2 Client Secret"

echo ""
echo "     (Optional — FedEx account number for enhanced tracking)"
if [[ -z "${FEDEX_ACCOUNT_NUMBER:-}" ]]; then
  read -rsp "     FEDEX_ACCOUNT_NUMBER (press Enter to skip): " FEDEX_ACCOUNT_NUMBER
  echo ""
  export FEDEX_ACCOUNT_NUMBER
fi

if [[ -z "${FEDEX_CLIENT_ID:-}" ]]; then
  warn "FEDEX_CLIENT_ID is empty — skipping FedEx vars."
else
  info "Adding FedEx vars to Preview..."

  result=$(vercel_add_env "FEDEX_CLIENT_ID"     "$FEDEX_CLIENT_ID"     "preview")
  [[ "$result" == ok:* || "$result" == exists:* ]] && ok "FEDEX_CLIENT_ID" || warn "FEDEX_CLIENT_ID: $result"

  result=$(vercel_add_env "FEDEX_CLIENT_SECRET" "$FEDEX_CLIENT_SECRET" "preview")
  [[ "$result" == ok:* || "$result" == exists:* ]] && ok "FEDEX_CLIENT_SECRET" || warn "FEDEX_CLIENT_SECRET: $result"

  if [[ -n "${FEDEX_ACCOUNT_NUMBER:-}" ]]; then
    result=$(vercel_add_env "FEDEX_ACCOUNT_NUMBER" "$FEDEX_ACCOUNT_NUMBER" "preview")
    [[ "$result" == ok:* || "$result" == exists:* ]] && ok "FEDEX_ACCOUNT_NUMBER" || warn "FEDEX_ACCOUNT_NUMBER: $result"
  fi

  ok "FedEx vars complete."
fi

echo ""

# ── 3. Mapbox token ──────────────────────────────────────────────────────────
echo "3/3  MAPBOX public access token"
echo "     Source: https://account.mapbox.com/access-tokens/"
echo "     (Token must start with 'pk.')"
echo ""

prompt_secret "NEXT_PUBLIC_MAPBOX_TOKEN" "Mapbox public token (pk.xxx...)"

if [[ -z "${NEXT_PUBLIC_MAPBOX_TOKEN:-}" ]]; then
  warn "NEXT_PUBLIC_MAPBOX_TOKEN is empty — skipping."
elif [[ "${NEXT_PUBLIC_MAPBOX_TOKEN}" != pk.* ]]; then
  warn "NEXT_PUBLIC_MAPBOX_TOKEN doesn't start with 'pk.' — double-check the value."
else
  info "Adding Mapbox token to Preview..."
  result=$(vercel_add_env "NEXT_PUBLIC_MAPBOX_TOKEN" "$NEXT_PUBLIC_MAPBOX_TOKEN" "preview")
  [[ "$result" == ok:* || "$result" == exists:* ]] && ok "NEXT_PUBLIC_MAPBOX_TOKEN" || warn "NEXT_PUBLIC_MAPBOX_TOKEN: $result"
fi

# ── 4. Also add FEDEX_ACCOUNT_NUMBER to Production if provided ───────────────
if [[ -n "${FEDEX_ACCOUNT_NUMBER:-}" ]]; then
  echo ""
  read -rp "     Also add FEDEX_ACCOUNT_NUMBER to Production? [y/N] " ADD_PROD
  if [[ "${ADD_PROD:-n}" =~ ^[Yy]$ ]]; then
    result=$(vercel_add_env "FEDEX_ACCOUNT_NUMBER" "$FEDEX_ACCOUNT_NUMBER" "production")
    [[ "$result" == ok:* || "$result" == exists:* ]] && ok "FEDEX_ACCOUNT_NUMBER → Production" || warn "$result"
  fi
fi

# ── 5. Also replicate to .env.local for development ─────────────────────────
echo ""
read -rp "     Update .env.local with these credentials for local dev? [y/N] " UPDATE_LOCAL
if [[ "${UPDATE_LOCAL:-n}" =~ ^[Yy]$ ]]; then
  ENV_LOCAL=".env.local"

  update_env_local() {
    local key="$1"
    local val="$2"
    [[ -z "$val" ]] && return
    if grep -q "^${key}=" "$ENV_LOCAL" 2>/dev/null; then
      # Replace existing line
      sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_LOCAL" && rm -f "${ENV_LOCAL}.bak"
    else
      echo "${key}=${val}" >> "$ENV_LOCAL"
    fi
  }

  [[ -n "${KINDE_CLIENT_ID:-}" ]]     && update_env_local "KINDE_CLIENT_ID"             "$KINDE_CLIENT_ID"
  [[ -n "${KINDE_CLIENT_SECRET:-}" ]] && update_env_local "KINDE_CLIENT_SECRET"         "$KINDE_CLIENT_SECRET"
  [[ -n "${KINDE_ISSUER_URL:-}" ]]    && update_env_local "KINDE_ISSUER_URL"            "$KINDE_ISSUER_URL"
  [[ -n "${KINDE_MANAGEMENT_CLIENT_ID:-}" ]]     && update_env_local "KINDE_MANAGEMENT_CLIENT_ID"     "$KINDE_MANAGEMENT_CLIENT_ID"
  [[ -n "${KINDE_MANAGEMENT_CLIENT_SECRET:-}" ]] && update_env_local "KINDE_MANAGEMENT_CLIENT_SECRET" "$KINDE_MANAGEMENT_CLIENT_SECRET"
  [[ -n "${FEDEX_CLIENT_ID:-}" ]]     && update_env_local "FEDEX_CLIENT_ID"             "$FEDEX_CLIENT_ID"
  [[ -n "${FEDEX_CLIENT_SECRET:-}" ]] && update_env_local "FEDEX_CLIENT_SECRET"         "$FEDEX_CLIENT_SECRET"
  [[ -n "${FEDEX_ACCOUNT_NUMBER:-}" ]] && update_env_local "FEDEX_ACCOUNT_NUMBER"       "$FEDEX_ACCOUNT_NUMBER"
  [[ -n "${NEXT_PUBLIC_MAPBOX_TOKEN:-}" ]] && update_env_local "NEXT_PUBLIC_MAPBOX_TOKEN" "$NEXT_PUBLIC_MAPBOX_TOKEN"

  ok ".env.local updated."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup complete."
echo ""
echo "  Verify environment variables with:  vercel env ls"
echo ""
echo "  ── Remaining manual steps ─────────────────────────────────────────"
echo ""
echo "  Kinde Dashboard (https://app.kinde.com) — verify these URLs are set:"
echo "    Allowed callback URLs:"
echo "      https://skyspecs-inventory.vercel.app/api/auth/kinde_callback"
echo "      https://*-chrisodomskyspecscoms-projects.vercel.app/api/auth/kinde_callback"
echo "      https://inventory.skyspecsops.com/api/auth/kinde_callback"
echo "      http://localhost:3000/api/auth/kinde_callback"
echo ""
echo "    Allowed logout redirect URLs:"
echo "      https://skyspecs-inventory.vercel.app"
echo "      https://skyspecs-inventory.vercel.app/scan"
echo "      https://skyspecs-inventory.vercel.app/scan/login"
echo "      https://inventory.skyspecsops.com"
echo "      https://inventory.skyspecsops.com/scan"
echo "      https://inventory.skyspecsops.com/scan/login"
echo "      http://localhost:3000"
echo "      http://localhost:3000/scan"
echo "      http://localhost:3000/scan/login"
echo ""
echo "  ── Convex Deploy Key ──────────────────────────────────────────────"
echo "    To auto-deploy Convex on Vercel deploys:"
echo "    1. https://dashboard.convex.dev → scan-inventory-v2 → Settings → Deploy Keys"
echo "    2. Create a Production deploy key"
echo "    3. vercel env add CONVEX_DEPLOY_KEY production --value <key> --force --yes"
echo "       vercel env add CONVEX_DEPLOY_KEY preview --value <key> --force --yes"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
