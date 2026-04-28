/**
 * env.ts — Environment variable schema and validation.
 *
 * Centralises all environment variable access behind a single validated
 * object so that:
 *   • Missing required variables throw at startup (not at runtime in a hot path).
 *   • Optional variables have explicit defaults.
 *   • Server-only variables are never bundled into the client build.
 *
 * Usage
 * ─────
 *   import { serverEnv } from "@/lib/env";
 *   const token = serverEnv.FEDEX_CLIENT_ID;
 *
 *   import { clientEnv } from "@/lib/env";
 *   const url = clientEnv.NEXT_PUBLIC_CONVEX_URL;
 *
 * Architecture notes
 * ──────────────────
 *   • `serverEnv` is validated only on the server (Node.js / Edge runtime).
 *     Never import it in a "use client" module — the build will fail.
 *   • `clientEnv` is safe to import anywhere; it only contains NEXT_PUBLIC_
 *     variables that are inlined by Next.js at build time.
 *   • Validation is performed eagerly (module-level) so a bad deploy fails
 *     immediately rather than silently returning undefined later.
 *
 * Adding new variables
 * ────────────────────
 *   1. Add the variable to the appropriate Zod schema below.
 *   2. Add the variable to .env.local (or .env for shared non-secret defaults).
 *   3. Add the variable to your Vercel project settings for production.
 */

import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Transform a string "1" | "true" → true, anything else → false.
 * Used for feature-flag env vars.
 */
const boolFlag = z
  .string()
  .optional()
  .transform((val) => val === "1" || val === "true");

/** Strip trailing slash from a URL string. */
const trimmedUrl = z.string().url().transform((val) => val.replace(/\/$/, ""));

/**
 * URL that may be an absolute URL or a root-relative path starting with `/`.
 * Used for optional endpoint overrides that don't need to be full URLs.
 */
const urlOrPath = z
  .string()
  .refine((val) => val.startsWith("/") || val.startsWith("http"), {
    message: "Must be an absolute URL or a root-relative path starting with /",
  })
  .transform((val) => val.replace(/\/$/, ""));

// ─── Server-side schema ───────────────────────────────────────────────────────
//
// These variables are NEVER sent to the browser.  Validate them in server
// code only (Route Handlers, Server Actions, Convex actions, middleware).

const serverEnvSchema = z.object({
  // ── FedEx Tracking API ──────────────────────────────────────────────────
  /** OAuth 2.0 client ID from the FedEx Developer Portal. Required. */
  FEDEX_CLIENT_ID: z
    .string()
    .min(1, "FEDEX_CLIENT_ID must be a non-empty string"),

  /** OAuth 2.0 client secret from the FedEx Developer Portal. Required. */
  FEDEX_CLIENT_SECRET: z
    .string()
    .min(1, "FEDEX_CLIENT_SECRET must be a non-empty string"),

  /**
   * FedEx account number for enhanced tracking detail. Optional.
   * When absent, standard public tracking is used.
   */
  FEDEX_ACCOUNT_NUMBER: z.string().optional(),

  /**
   * FedEx API base URL. Optional.
   * Defaults to the production API (https://apis.fedex.com).
   * Override with https://apis-sandbox.fedex.com for sandbox/testing.
   */
  FEDEX_API_BASE_URL: z
    .string()
    .url()
    .transform((val) => val.replace(/\/$/, ""))
    .optional()
    .default("https://apis.fedex.com"),

  // ── Convex HTTP Actions (server-side) ───────────────────────────────────
  /**
   * Convex HTTP Actions base URL. Optional.
   * Derived automatically from NEXT_PUBLIC_CONVEX_URL when not set.
   */
  CONVEX_SITE_URL: trimmedUrl.optional(),

  // ── Node.js environment ─────────────────────────────────────────────────
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

// ─── Client-side schema ───────────────────────────────────────────────────────
//
// NEXT_PUBLIC_ variables are inlined by the Next.js compiler and safe to
// use in both server and client code.  Keep secrets out of this schema.

const clientEnvSchema = z.object({
  // ── Convex ──────────────────────────────────────────────────────────────
  /**
   * Convex deployment URL (reactive WebSocket + HTTP).
   * Obtain from the Convex dashboard. Required.
   */
  NEXT_PUBLIC_CONVEX_URL: trimmedUrl,

  // ── Mapbox ──────────────────────────────────────────────────────────────
  /**
   * Mapbox public access token for GL JS map rendering. Required.
   * Obtain from https://account.mapbox.com/access-tokens/
   */
  NEXT_PUBLIC_MAPBOX_TOKEN: z
    .string()
    .min(1, "NEXT_PUBLIC_MAPBOX_TOKEN must be a non-empty string"),

  // ── SCAN app ────────────────────────────────────────────────────────────
  /**
   * Base URL of the SCAN mobile app, used when generating QR codes.
   * Defaults to /scan (root-relative) when not set.
   */
  NEXT_PUBLIC_SCAN_APP_URL: urlOrPath.optional().default("/scan"),

  // ── Telemetry ───────────────────────────────────────────────────────────
  /**
   * Custom telemetry endpoint. Optional.
   * Defaults to /api/telemetry when not set.
   */
  NEXT_PUBLIC_TELEMETRY_ENDPOINT: urlOrPath.optional().default("/api/telemetry"),

  // ── Feature flags ───────────────────────────────────────────────────────
  /**
   * Enable Mission Control map mode (M5).
   * Set NEXT_PUBLIC_FF_MAP_MISSION=1 to activate.
   */
  NEXT_PUBLIC_FF_MAP_MISSION: boolFlag,

  /**
   * Enable SHA-256 hash-chain audit trail in the T5 case detail panel.
   * Set NEXT_PUBLIC_FF_AUDIT_HASH_CHAIN=1 to activate.
   */
  NEXT_PUBLIC_FF_AUDIT_HASH_CHAIN: boolFlag,

  /**
   * Enable the INVENTORY redesign (spec sections 0–25).
   * Set NEXT_PUBLIC_FF_INV_REDESIGN=1 to activate.
   */
  NEXT_PUBLIC_FF_INV_REDESIGN: boolFlag,
});

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate and parse a schema against `process.env`.
 * Throws a descriptive error listing all validation failures.
 */
function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  envSource: NodeJS.ProcessEnv = process.env
): z.output<T> {
  const result = schema.safeParse(envSource);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Environment variable validation failed:\n${issues}\n\n` +
        "Check .env.local (development) or your Vercel project settings (production)."
    );
  }

  return result.data;
}

// ─── Parsed exports ───────────────────────────────────────────────────────────

/**
 * Validated server-side environment variables.
 *
 * **Server-side only** — never import this in a "use client" module.
 *
 * Validation is deferred until first import so that:
 *   • `next build` does not fail when server vars aren't set at build time.
 *   • Tests can set `process.env` values before importing server modules.
 *
 * In production, server env is validated on every cold start; misconfigured
 * deployments will fail fast with a clear error in Vercel function logs.
 */
export function getServerEnv(): z.output<typeof serverEnvSchema> {
  return parseEnv(serverEnvSchema);
}

/**
 * Validated client-side environment variables.
 *
 * Safe to import in both server and client code.  NEXT_PUBLIC_ variables are
 * inlined by the Next.js compiler — their values are fixed at build time.
 *
 * Call this function once at the top of your module to avoid re-parsing on
 * every render.
 */
export function getClientEnv(): z.output<typeof clientEnvSchema> {
  return parseEnv(clientEnvSchema);
}

// ─── Type exports ─────────────────────────────────────────────────────────────

/** Inferred type of the validated server-side environment object. */
export type ServerEnv = z.output<typeof serverEnvSchema>;

/** Inferred type of the validated client-side environment object. */
export type ClientEnv = z.output<typeof clientEnvSchema>;

// ─── Convenience re-exports for FedEx configuration ─────────────────────────
//
// The FedEx module reads directly from process.env for simplicity and
// test-friendliness (tests set process.env directly).  These helpers allow
// other modules to get type-safe FedEx config without importing fedex.ts.

/**
 * Return whether FedEx credentials are present in the environment.
 * This is a lightweight check — it does NOT call the FedEx API.
 */
export function areFedExEnvVarsPresent(): boolean {
  return Boolean(
    process.env.FEDEX_CLIENT_ID?.trim() &&
      process.env.FEDEX_CLIENT_SECRET?.trim()
  );
}

/**
 * Return the FedEx API base URL from the environment.
 * Defaults to the production endpoint when FEDEX_API_BASE_URL is not set.
 */
export function getFedExApiBaseUrl(): string {
  return (
    process.env.FEDEX_API_BASE_URL?.trim().replace(/\/$/, "") ??
    "https://apis.fedex.com"
  );
}
