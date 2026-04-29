# Environment Variables Reference

Complete reference for all environment variables used by SkySpecs INVENTORY + SCAN.

---

## Overview

The application uses three configuration layers, applied in precedence order (highest first):

| Layer | File / Source | Committed | Contains secrets |
|-------|--------------|-----------|-----------------|
| **Vercel environment variables** | Vercel dashboard / CLI | No | Yes |
| **Local overrides** | `.env.local` | No | Yes |
| **Production defaults** | `.env.production` | **Yes** | **No** |
| **Example template** | `.env.local.example` | Yes | No |

**Rule**: Never put real secret values in any committed file. Secrets go in
Vercel's encrypted environment variable store (production/preview) or in your
local `.env.local` (never committed).

The Convex runtime is a separate execution environment — it does **not** read
`.env.production` or Vercel env vars automatically. Convex-specific variables
must be set independently in the Convex dashboard (see
[Convex Dashboard Secrets](#convex-dashboard-secrets) below).

---

## Quick Setup

### Development

```bash
cp .env.local.example .env.local
# Fill in real values in .env.local
npm run dev
```

### Production (Vercel)

```bash
# Kinde (required)
vercel env add KINDE_CLIENT_ID production
vercel env add KINDE_CLIENT_SECRET production
vercel env add KINDE_ISSUER_URL production

# FedEx (required for tracking)
vercel env add FEDEX_CLIENT_ID production
vercel env add FEDEX_CLIENT_SECRET production

# Mapbox (required for maps)
vercel env add NEXT_PUBLIC_MAPBOX_TOKEN production

# Convex CI/CD (required for auto-deploy)
vercel env add CONVEX_DEPLOY_KEY production

# Optional
vercel env add KINDE_MANAGEMENT_CLIENT_ID production
vercel env add KINDE_MANAGEMENT_CLIENT_SECRET production
vercel env add FEDEX_ACCOUNT_NUMBER production
```

Then set the same secrets in the Convex dashboard — see
[Convex Dashboard Secrets](#convex-dashboard-secrets).

---

## Variable Reference

### Kinde Authentication

Both the INVENTORY dashboard (`/inventory`) and the SCAN mobile app (`/scan`)
share one Kinde "Back-end web" application. See `docs/kinde-setup.md` for the
full Kinde configuration walkthrough.

All Kinde variables are **server-side only** — no `NEXT_PUBLIC_` prefix. They
are never sent to the browser.

| Variable | Required | Secret | Description |
|----------|----------|--------|-------------|
| `KINDE_CLIENT_ID` | Yes | Yes | OAuth2 Client ID from Kinde app keys |
| `KINDE_CLIENT_SECRET` | Yes | Yes | OAuth2 Client Secret from Kinde app keys |
| `KINDE_ISSUER_URL` | Yes | Yes | Kinde domain URL, e.g. `https://skyspecs.kinde.com` |
| `KINDE_SITE_URL` | Yes | No | Base URL of this application (no trailing slash) |
| `KINDE_POST_LOGOUT_REDIRECT_URL` | Yes | No | Redirect target after logout |
| `KINDE_POST_LOGIN_REDIRECT_URL` | Yes | No | Default post-login redirect for INVENTORY users |
| `KINDE_POST_LOGIN_ALLOWED_URL_REGEX` | No | No | Regex guard against open-redirect on post-login URL |
| `KINDE_SCAN_POST_LOGIN_REDIRECT_URL` | No | No | Fallback post-login redirect for SCAN app users |
| `KINDE_MANAGEMENT_CLIENT_ID` | No | Yes | M2M app Client ID for Kinde Management API |
| `KINDE_MANAGEMENT_CLIENT_SECRET` | No | Yes | M2M app Client Secret for Kinde Management API |

#### Where to obtain Kinde credentials

- `KINDE_CLIENT_ID` / `KINDE_CLIENT_SECRET`: Kinde dashboard → Applications →
  [your app] → App keys
- `KINDE_ISSUER_URL`: Kinde dashboard → Settings → Domain
- `KINDE_MANAGEMENT_CLIENT_ID` / `KINDE_MANAGEMENT_CLIENT_SECRET`: Kinde
  dashboard → Applications → [M2M app] → App keys

#### Production values

| Variable | Production value |
|----------|-----------------|
| `KINDE_SITE_URL` | `https://inventory.skyspecsops.com` |
| `KINDE_POST_LOGOUT_REDIRECT_URL` | `https://inventory.skyspecsops.com` |
| `KINDE_POST_LOGIN_REDIRECT_URL` | `https://inventory.skyspecsops.com/inventory` |
| `KINDE_POST_LOGIN_ALLOWED_URL_REGEX` | `^https://inventory\.skyspecsops\.com/(inventory\|scan)(/.*)?$` |
| `KINDE_SCAN_POST_LOGIN_REDIRECT_URL` | `https://inventory.skyspecsops.com/scan` |

#### Development values

| Variable | Development value |
|----------|------------------|
| `KINDE_SITE_URL` | `http://localhost:3000` |
| `KINDE_POST_LOGOUT_REDIRECT_URL` | `http://localhost:3000` |
| `KINDE_POST_LOGIN_REDIRECT_URL` | `http://localhost:3000/inventory` |
| `KINDE_POST_LOGIN_ALLOWED_URL_REGEX` | `^(http://localhost:3000\|https://inventory\.skyspecsops\.com)/(inventory\|scan)(/.*)?$` |
| `KINDE_SCAN_POST_LOGIN_REDIRECT_URL` | `http://localhost:3000/scan` |

---

### FedEx Tracking API

Used for tracking shipments in the SCAN app and INVENTORY dashboard.
FedEx credentials are needed in **two places**:

1. **Next.js / Vercel** — for any server-side FedEx calls made from API routes.
2. **Convex dashboard** — for FedEx calls made from Convex actions
   (`convex/lib/fedexAuth.ts`). The Convex runtime does not inherit Vercel env vars.

See [Convex Dashboard Secrets](#convex-dashboard-secrets) for the Convex side.

Obtain credentials from [developer.fedex.com](https://developer.fedex.com/api/en-us/home.html) →
Dashboard → Credentials.

All FedEx variables are **server-side only** — no `NEXT_PUBLIC_` prefix.

| Variable | Required | Secret | Description |
|----------|----------|--------|-------------|
| `FEDEX_CLIENT_ID` | Yes | Yes | OAuth2 Client ID from FedEx Developer Portal |
| `FEDEX_CLIENT_SECRET` | Yes | Yes | OAuth2 Client Secret from FedEx Developer Portal |
| `FEDEX_ACCOUNT_NUMBER` | No | Yes | FedEx account number for enhanced tracking detail |
| `FEDEX_API_BASE_URL` | No | No | Override API base URL (default: `https://apis.fedex.com`) |

#### FedEx sandbox (development / testing)

To use the FedEx sandbox instead of live production tracking:

```bash
# In .env.local:
FEDEX_API_BASE_URL=https://apis-sandbox.fedex.com
```

The sandbox requires separate sandbox credentials from the FedEx Developer Portal.

---

### Convex

| Variable | Required | Secret | Scope | Description |
|----------|----------|--------|-------|-------------|
| `NEXT_PUBLIC_CONVEX_URL` | Yes | No | Browser + Server | Convex deployment WebSocket/HTTP URL |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | No | No | Browser + Server | Convex HTTP Actions base URL |
| `CONVEX_DEPLOYMENT` | Dev only | No | Local | Deployment identifier for `npx convex dev` |
| `CONVEX_DEPLOY_KEY` | CI/CD | Yes | Server | Production deploy key for Vercel build step |

#### Deployment URLs

| Environment | `NEXT_PUBLIC_CONVEX_URL` | `NEXT_PUBLIC_CONVEX_SITE_URL` |
|-------------|--------------------------|-------------------------------|
| Production | `https://adjoining-kudu-515.convex.cloud` | `https://adjoining-kudu-515.convex.site` |
| Development | `https://judicious-dove-740.convex.cloud` | `https://judicious-dove-740.convex.site` |

#### `CONVEX_DEPLOY_KEY`

Required for the `vercel.json` build command to automatically deploy Convex
functions on each Vercel deploy. The build command is:

```json
"buildCommand": "if [ -n \"$CONVEX_DEPLOY_KEY\" ]; then npx convex deploy --cmd 'npm run build'; else npm run build; fi"
```

To obtain and configure:
1. Convex dashboard → `fireflymediagroup/scan-inventory-v2` → Settings → Deploy Keys
2. Click **Create Deploy Key** → type: **Production**
3. Copy the key
4. Run:
   ```bash
   vercel env add CONVEX_DEPLOY_KEY production --value <key>
   vercel env add CONVEX_DEPLOY_KEY preview --value <key>
   ```

---

### Mapbox

Used by all five map modes (M1–M5) in the INVENTORY dashboard.

| Variable | Required | Secret | Description |
|----------|----------|--------|-------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | No* | Mapbox public access token (starts with `pk.`) |

*The token is technically public (visible in browser JS), but should be
**URL-restricted** in the Mapbox dashboard to your production origin
(`https://inventory.skyspecsops.com`) to prevent unauthorized use.

Obtain from [account.mapbox.com/access-tokens](https://account.mapbox.com/access-tokens/).

---

### SCAN App

| Variable | Required | Secret | Description |
|----------|----------|--------|-------------|
| `NEXT_PUBLIC_SCAN_APP_URL` | Yes | No | Base URL for SCAN QR codes and deep links |

| Environment | Value |
|-------------|-------|
| Production | `https://inventory.skyspecsops.com/scan` |
| Development | `http://localhost:3000/scan` |

---

### Feature Flags

All feature flags are client-accessible (`NEXT_PUBLIC_` prefix). Set to `"1"`
or `"true"` to enable; leave unset or `"0"` to disable.

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_FF_MAP_MISSION` | `0` | Enables Mission Control map mode (M5) |
| `NEXT_PUBLIC_FF_AUDIT_HASH_CHAIN` | `0` | Enables hash-chain audit trail (T5 case detail) |
| `NEXT_PUBLIC_FF_INV_REDESIGN` | `0` | Enables INVENTORY master redesign |

All flags are disabled by default in production (`.env.production`). Enable
them per-environment via Vercel environment variables when ready for GA.

---

### Telemetry

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_TELEMETRY_ENDPOINT` | No | `/api/telemetry` | Telemetry collection endpoint |

---

## Convex Dashboard Secrets

The Convex runtime is a separate serverless environment and does **not** read
Vercel environment variables. Variables used inside Convex actions, queries, or
mutations must be configured in the **Convex dashboard** under
**Settings → Environment Variables**.

**Navigate to**: [dashboard.convex.dev](https://dashboard.convex.dev) →
`fireflymediagroup/scan-inventory-v2` → Settings → Environment Variables

### Required Convex secrets

| Variable | Secret | Used by | Description |
|----------|--------|---------|-------------|
| `KINDE_ISSUER_URL` | No | `convex/auth.config.ts` | Kinde domain URL for JWT issuer validation |
| `KINDE_CLIENT_ID` | No | `convex/auth.config.ts` | Kinde Client ID (used to build JWKS URL) |
| `FEDEX_CLIENT_ID` | **Yes** | `convex/lib/fedexAuth.ts` | FedEx OAuth2 Client ID |
| `FEDEX_CLIENT_SECRET` | **Yes** | `convex/lib/fedexAuth.ts` | FedEx OAuth2 Client Secret |

### Optional Convex secrets

| Variable | Default | Used by | Description |
|----------|---------|---------|-------------|
| `FEDEX_ACCOUNT_NUMBER` | — | FedEx API calls | Account number for enhanced tracking detail |
| `FEDEX_API_BASE_URL` | `https://apis.fedex.com` | `convex/lib/fedexAuth.ts` | Override to use FedEx sandbox |

### How Convex uses these variables

**`KINDE_ISSUER_URL` and `KINDE_CLIENT_ID`** are read by `convex/auth.config.ts`
to configure Kinde as a trusted JWT issuer. Convex uses the issuer URL to build
the JWKS endpoint (`${KINDE_ISSUER_URL}/.well-known/jwks.json`) and verify the
RS256 signature on every authenticated request. Without these, all authenticated
Convex queries and mutations will fail.

**`FEDEX_CLIENT_ID` and `FEDEX_CLIENT_SECRET`** are read by
`convex/lib/fedexAuth.ts` inside Convex actions. The module implements a
two-layer OAuth token cache (process-level + Convex DB) to avoid redundant
FedEx OAuth calls. Without these, all shipment tracking features will fail.

### Setting Convex environment variables

In the Convex dashboard:
1. Go to **Settings → Environment Variables**
2. Click **Add variable**
3. For secrets, toggle **Secret** on — the value will be masked after saving

Or via the Convex CLI (if available):
```bash
npx convex env set KINDE_ISSUER_URL https://skyspecs.kinde.com
npx convex env set KINDE_CLIENT_ID <your-client-id>
npx convex env set FEDEX_CLIENT_ID <your-fedex-client-id>
npx convex env set FEDEX_CLIENT_SECRET <your-fedex-client-secret>
```

---

## Variable × Environment Matrix

The table below shows which variables must be set in which environment.
**Bold** = must be set (app will not function without it).
*Italic* = recommended but optional.

| Variable | Local (`.env.local`) | Vercel Production | Vercel Preview | Convex Production |
|----------|---------------------|-------------------|----------------|-------------------|
| `KINDE_CLIENT_ID` | **Yes** | **Yes** | **Yes** | **Yes** |
| `KINDE_CLIENT_SECRET` | **Yes** | **Yes** | **Yes** | — |
| `KINDE_ISSUER_URL` | **Yes** | **Yes** | **Yes** | **Yes** |
| `KINDE_SITE_URL` | **Yes** | *(in `.env.production`)* | **Yes** | — |
| `KINDE_POST_LOGOUT_REDIRECT_URL` | **Yes** | *(in `.env.production`)* | **Yes** | — |
| `KINDE_POST_LOGIN_REDIRECT_URL` | **Yes** | *(in `.env.production`)* | **Yes** | — |
| `KINDE_POST_LOGIN_ALLOWED_URL_REGEX` | *Yes* | *(in `.env.production`)* | *Yes* | — |
| `KINDE_SCAN_POST_LOGIN_REDIRECT_URL` | *Yes* | *(in `.env.production`)* | *Yes* | — |
| `KINDE_MANAGEMENT_CLIENT_ID` | *Yes* | *Yes* | *Yes* | — |
| `KINDE_MANAGEMENT_CLIENT_SECRET` | *Yes* | *Yes* | *Yes* | — |
| `FEDEX_CLIENT_ID` | **Yes** | **Yes** | **Yes** | **Yes** |
| `FEDEX_CLIENT_SECRET` | **Yes** | **Yes** | **Yes** | **Yes** |
| `FEDEX_ACCOUNT_NUMBER` | *Yes* | *Yes* | *Yes* | *Yes* |
| `FEDEX_API_BASE_URL` | *Yes* | *(in `.env.production`)* | *Yes* | *Yes* |
| `NEXT_PUBLIC_CONVEX_URL` | **Yes** | **Yes** | **Yes** | — |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | *Yes* | *(in `.env.production`)* | *Yes* | — |
| `CONVEX_DEPLOY_KEY` | — | **Yes** | **Yes** | — |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | **Yes** | **Yes** | **Yes** | — |
| `NEXT_PUBLIC_SCAN_APP_URL` | **Yes** | *(in `.env.production`)* | **Yes** | — |
| `NEXT_PUBLIC_FF_MAP_MISSION` | *Yes* | *(in `.env.production`)* | *Yes* | — |
| `NEXT_PUBLIC_FF_AUDIT_HASH_CHAIN` | *Yes* | *(in `.env.production`)* | *Yes* | — |
| `NEXT_PUBLIC_FF_INV_REDESIGN` | *Yes* | *(in `.env.production`)* | *Yes* | — |

*(in `.env.production`)* = committed default value; override in Vercel if needed.

---

## Security Notes

1. **Server-side secrets** (`KINDE_CLIENT_SECRET`, `FEDEX_CLIENT_SECRET`, etc.)
   must never have a `NEXT_PUBLIC_` prefix. Next.js only exposes `NEXT_PUBLIC_`
   variables to the browser bundle — all others remain server-side only.

2. **Convex secrets** (`FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`) are stored
   encrypted in the Convex dashboard and are only accessible within Convex
   action/query/mutation handlers — never returned to the client.

3. **Mapbox token** (`NEXT_PUBLIC_MAPBOX_TOKEN`) is intentionally public but
   should be restricted in the Mapbox dashboard to the production origin to
   prevent quota abuse.

4. **Open-redirect guard** — `KINDE_POST_LOGIN_ALLOWED_URL_REGEX` prevents
   an attacker from using the OAuth callback to redirect users to an arbitrary
   external URL. Ensure the regex is restrictive (anchored with `^` and `$`).

5. **`.env.local`** is listed in `.gitignore` and must never be committed.

6. **`.env.production`** is committed and contains no secrets — only safe URL
   defaults and feature flag defaults.

---

## `.gitignore` Verification

Ensure these patterns are present in `.gitignore`:

```
.env.local
.env.*.local
```

The `.env.production` file (no `.local` suffix) **is** committed intentionally.
