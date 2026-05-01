#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/seed-database.sh
#
# Seed the Convex dev/test database with representative production-like data.
#
# Usage:
#   ./scripts/seed-database.sh               # additive seed (dev default)
#   ./scripts/seed-database.sh --reset       # clear existing data first, then seed
#   ./scripts/seed-database.sh --prod        # seed against the prod deployment (DANGER)
#
# Prerequisites:
#   • Node.js ≥ 18 and npm installed
#   • `npx convex` available (comes from the convex npm package in devDependencies)
#   • For --prod: CONVEX_DEPLOY_KEY environment variable must be set
#
# What this creates:
#   • 3 feature flags  (FF_AUDIT_HASH_CHAIN, FF_MAP_MISSION, FF_INV_REDESIGN)
#   • 8 case templates (ForeSight, GSC, battery, charger, SkyCrawler)
#   • 6 complete equipment datasets (FS-101/102/103, SC-201/202/203)
#   • 6 missions       (hangar staging, outbound, deployed, return, refurb)
#   • 20 turbines      (distributed across field mission sites)
#   • 28 cases         (GSC, aircraft/rover, charger/support, battery cases)
#   • ~600 manifest items with serialised aircraft, rover, Beakon, and battery rows
#   • inspections, shipments, shipping updates, events, custody handoffs,
#     scans, checklist history, damage reports, and notifications
#
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

# ── Parse arguments ───────────────────────────────────────────────────────────

CLEAR_EXISTING=false
PROD_MODE=false

for arg in "$@"; do
  case "$arg" in
    --reset)
      CLEAR_EXISTING=true
      ;;
    --prod)
      PROD_MODE=true
      ;;
    --help|-h)
      sed -n '2,30p' "$0"   # Print the header comment
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--reset] [--prod]"
      exit 1
      ;;
  esac
done

# ── Safety guard for production ───────────────────────────────────────────────

if [[ "${PROD_MODE}" == true ]]; then
  echo ""
  echo "⚠️  WARNING: You are about to seed the PRODUCTION Convex deployment."
  echo "   This will INSERT seed records (or DELETE ALL DATA if --reset is also set)."
  echo ""
  read -r -p "Type 'yes-seed-production' to confirm: " confirmation
  if [[ "${confirmation}" != "yes-seed-production" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── Build the mutation args ───────────────────────────────────────────────────

if [[ "${CLEAR_EXISTING}" == true ]]; then
  MUTATION_ARGS='{"clearExisting":true}'
  echo ""
  echo "Mode: RESET + SEED (existing data will be deleted)"
else
  MUTATION_ARGS='{}'
  echo ""
  echo "Mode: ADDITIVE SEED (existing data is preserved)"
fi

echo ""
echo "Seeding Convex database..."
echo "  Project: ${PROJECT_ROOT}"
echo "  Args:    ${MUTATION_ARGS}"
echo ""

# ── Run the seed mutation ─────────────────────────────────────────────────────

if [[ "${PROD_MODE}" == true ]]; then
  npx convex run --prod seed:seedDatabase "${MUTATION_ARGS}"
else
  npx convex run seed:seedDatabase "${MUTATION_ARGS}"
fi

echo ""
echo "Seed complete."
