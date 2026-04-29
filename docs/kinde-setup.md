# Kinde Authentication Setup

## Overview

Both the **INVENTORY dashboard** (`/inventory`) and the **SCAN mobile app** (`/scan`)
run within a single Next.js deployment and share **one Kinde "Back-end web" application**.
There is no separate Kinde app for SCAN — the same OAuth flow handles both apps, with
the post-login redirect URL determining where users land after authentication.

An optional second **Machine-to-Machine (M2M)** Kinde application is used for
server-side management API calls (user listing, role assignment, etc.).

---

## Step 1 — Create the "Back-end web" Application

1. Go to [https://app.kinde.com](https://app.kinde.com) and sign in.
2. Navigate to **Applications** → **Add application**.
3. Name: `SkySpecs INVENTORY + SCAN`
4. Application type: **Back-end web**
5. Click **Save**.

After saving, Kinde shows the **App keys** tab. Copy:

| Field | Where to paste |
|-------|---------------|
| **Client ID** | `KINDE_CLIENT_ID` in `.env.local` and Vercel env |
| **Client Secret** | `KINDE_CLIENT_SECRET` in `.env.local` and Vercel env |
| **Domain** (e.g. `https://skyspecs.kinde.com`) | `KINDE_ISSUER_URL` in `.env.local` and Vercel env |

---

## Step 2 — Configure Callback and Logout URLs

In the Kinde dashboard, go to your app → **Authentication** tab.

### Allowed callback URLs (OAuth redirect URIs)

These are the URLs Kinde will redirect to after successful authentication.
Add all of the following:

```
http://localhost:3000/api/auth/kinde_callback
https://inventory.skyspecsops.com/api/auth/kinde_callback
https://skyspecs-inventory.vercel.app/api/auth/kinde_callback
```

> **Vercel Preview deployments**: Also add the wildcard pattern for preview branch
> URLs if Kinde supports it:
> `https://*-chrisodomskyspecscoms-projects.vercel.app/api/auth/kinde_callback`
> (Add the specific preview deployment URL when it is first generated, e.g.
> `https://scan-inventory-v2-abc123-chrisodomskyspecscoms-projects.vercel.app/api/auth/kinde_callback`)

### Allowed logout redirect URLs

These are the URLs Kinde will allow as `post_logout_redirect_url` values.
Add all of the following:

```
http://localhost:3000
http://localhost:3000/scan
http://localhost:3000/scan/login
https://inventory.skyspecsops.com
https://inventory.skyspecsops.com/scan
https://inventory.skyspecsops.com/scan/login
https://skyspecs-inventory.vercel.app
https://skyspecs-inventory.vercel.app/scan
https://skyspecs-inventory.vercel.app/scan/login
```

### Allowed origins (CORS)

```
http://localhost:3000
https://inventory.skyspecsops.com
```

---

## Step 3 — Create Permissions and Roles

In the Kinde dashboard, go to **Permissions** → **Add permission** for each:

| Permission key | Description |
|----------------|-------------|
| `inventory:read` | View INVENTORY dashboard map and case details |
| `inventory:write` | Create / update / delete cases and missions |
| `scan:read` | View SCAN mobile app (case details, checklists) |
| `scan:write` | Perform SCAN actions (check-in, inspect, ship, handoff) |
| `admin:manage` | Access admin settings and case template management |

Then go to **Roles** → **Add role** and assign permissions:

| Role | Permissions |
|------|-------------|
| **Operator** | `inventory:read`, `inventory:write`, `scan:read`, `scan:write` |
| **Technician** | `scan:read`, `scan:write` |
| **Pilot** | `scan:read`, `scan:write` |
| **Admin** | All permissions |
| **Viewer** | `inventory:read`, `scan:read` |

---

## Step 4 — Create the Machine-to-Machine Application (Optional)

Used for server-side Kinde Management API calls (e.g., listing users, managing roles).

1. In Kinde → **Applications** → **Add application**.
2. Name: `SkySpecs INVENTORY Management API`
3. Application type: **Machine to Machine**
4. Under **APIs**, enable access to the **Kinde Management API**.
5. Copy the resulting credentials:

| Field | Where to paste |
|-------|---------------|
| **Client ID** | `KINDE_MANAGEMENT_CLIENT_ID` |
| **Client Secret** | `KINDE_MANAGEMENT_CLIENT_SECRET` |

---

## Step 5 — Configure Environment Variables

### Development (`.env.local`)

```bash
# Kinde Back-end web application
KINDE_CLIENT_ID=<paste Client ID from Step 1>
KINDE_CLIENT_SECRET=<paste Client Secret from Step 1>
KINDE_ISSUER_URL=https://<your-subdomain>.kinde.com

# Application URLs (development)
KINDE_SITE_URL=http://localhost:3000
KINDE_POST_LOGOUT_REDIRECT_URL=http://localhost:3000
KINDE_POST_LOGIN_REDIRECT_URL=http://localhost:3000/inventory
KINDE_POST_LOGIN_ALLOWED_URL_REGEX=^(http://localhost:3000|https://inventory\.skyspecsops\.com)/(inventory|scan)(/.*)?$
KINDE_SCAN_POST_LOGIN_REDIRECT_URL=http://localhost:3000/scan

# Kinde Machine-to-Machine application (Step 4 — optional)
KINDE_MANAGEMENT_CLIENT_ID=<paste M2M Client ID from Step 4>
KINDE_MANAGEMENT_CLIENT_SECRET=<paste M2M Client Secret from Step 4>
```

### Production (Vercel environment variables)

Set the following in the Vercel project dashboard under **Settings → Environment Variables**
(or via the CLI: `vercel env add <KEY> production`):

| Variable | Production value |
|----------|-----------------|
| `KINDE_CLIENT_ID` | `<Client ID from Step 1>` |
| `KINDE_CLIENT_SECRET` | `<Client Secret from Step 1>` |
| `KINDE_ISSUER_URL` | `https://<your-subdomain>.kinde.com` |
| `KINDE_SITE_URL` | `https://inventory.skyspecsops.com` |
| `KINDE_POST_LOGOUT_REDIRECT_URL` | `https://inventory.skyspecsops.com` |
| `KINDE_POST_LOGIN_REDIRECT_URL` | `https://inventory.skyspecsops.com/inventory` |
| `KINDE_POST_LOGIN_ALLOWED_URL_REGEX` | `^(http://localhost:3000\|https://inventory\.skyspecsops\.com)/(inventory\|scan)(/.*)?$` |
| `KINDE_SCAN_POST_LOGIN_REDIRECT_URL` | `https://inventory.skyspecsops.com/scan` |
| `KINDE_MANAGEMENT_CLIENT_ID` | `<M2M Client ID from Step 4>` *(optional)* |
| `KINDE_MANAGEMENT_CLIENT_SECRET` | `<M2M Client Secret from Step 4>` *(optional)* |

---

## Auth Flow Summary

### INVENTORY Dashboard
1. User navigates to `/inventory` (no session)
2. Middleware → redirects to `/scan/login?post_login_redirect_url=/inventory`
3. SCAN login page → links to `/api/auth/login` with redirect param
4. Kinde hosted login → OAuth callback → `/api/auth/kinde_callback`
5. SDK establishes session → user redirected to `/inventory`

### SCAN Mobile App (direct / QR deep-link)
1. Field tech scans QR → opens `/scan/<caseId>` (or `/case/<caseId>` → redirected to `/scan/<caseId>`)
2. Middleware → redirects to `/scan/login?post_login_redirect_url=/scan/<caseId>`
3. SCAN login page → links to `/api/auth/login` with redirect param
4. Kinde hosted login → OAuth callback → `/api/auth/kinde_callback`
5. SDK establishes session → user redirected to `/scan/<caseId>`

### SCAN Mobile App (direct / no QR)
1. Field tech opens `/scan` (no caseId, no session)
2. SCAN landing page links to `/api/auth/scan-login`
3. `scan-login` route builds login URL with `post_login_redirect_url=/scan`
4. Kinde hosted login → OAuth callback → `/api/auth/kinde_callback`
5. SDK establishes session → user redirected to `/scan`

---

## Route Summary

| Route | Description |
|-------|-------------|
| `GET /api/auth/login` | Redirect to Kinde hosted login (INVENTORY default) |
| `GET /api/auth/logout` | Clear session and redirect post-logout |
| `GET /api/auth/register` | Redirect to Kinde hosted registration |
| `GET /api/auth/kinde_callback` | Handle OAuth callback from Kinde |
| `GET /api/auth/scan-login` | SCAN-specific login (redirects to `/scan` after auth) |

---

## Vercel Preview Deployments

When a PR preview URL is generated (e.g. `https://scan-inventory-v2-abc123.vercel.app`),
add it to Kinde's **Allowed callback URLs**:

```
https://<preview-slug>.vercel.app/api/auth/kinde_callback
```

And to **Allowed logout redirect URLs**:

```
https://<preview-slug>.vercel.app
https://<preview-slug>.vercel.app/scan
https://<preview-slug>.vercel.app/scan/login
```

Use `scripts/setup-vercel-preview-secrets.sh` to push Kinde credentials to the
Vercel Preview environment.

---

## Quick Reference — All Callback URLs

### Allowed callback URLs
```
http://localhost:3000/api/auth/kinde_callback
https://inventory.skyspecsops.com/api/auth/kinde_callback
https://skyspecs-inventory.vercel.app/api/auth/kinde_callback
```

### Allowed logout redirect URLs
```
http://localhost:3000
http://localhost:3000/scan
http://localhost:3000/scan/login
https://inventory.skyspecsops.com
https://inventory.skyspecsops.com/scan
https://inventory.skyspecsops.com/scan/login
https://skyspecs-inventory.vercel.app
https://skyspecs-inventory.vercel.app/scan
https://skyspecs-inventory.vercel.app/scan/login
```

### Allowed origins (CORS)
```
http://localhost:3000
https://inventory.skyspecsops.com
```
