/**
 * feature-flags.ts — Centralized feature flag configuration.
 *
 * All NEXT_PUBLIC_FF_* environment variables are parsed here so that:
 *   • Flag keys are defined in one place (no duplicated process.env reads).
 *   • Flag values are typed as booleans (not raw strings).
 *   • Components import named constants from this module rather than
 *     reading process.env directly.
 *
 * Available flags
 * ───────────────
 *   FF_AUDIT_HASH_CHAIN — enables SHA-256 hash-chain audit trail in the
 *                         T5 Audit Ledger layout, including the hash-chain
 *                         verification footer section.
 *                         Set NEXT_PUBLIC_FF_AUDIT_HASH_CHAIN=1 to activate.
 *
 *   FF_MAP_MISSION      — enables Mission Control map mode (M5) in the
 *                         INVENTORY dashboard map view.
 *                         Set NEXT_PUBLIC_FF_MAP_MISSION=1 to activate.
 *
 *   FF_INV_REDESIGN     — enables the INVENTORY redesign (spec sections 0–25),
 *                         switching the dashboard to the T4 Dossier layout.
 *                         Set NEXT_PUBLIC_FF_INV_REDESIGN=1 to activate.
 *
 * Usage
 * ─────
 *   import { featureFlags, FEATURE_FLAG_KEYS } from "@/lib/feature-flags";
 *
 *   // Boolean check
 *   if (featureFlags.FF_AUDIT_HASH_CHAIN) { ... }
 *
 *   // Pass to component
 *   <T5Audit ffEnabled={featureFlags.FF_AUDIT_HASH_CHAIN} />
 *
 *   // Use the key constant (avoids string literals in component code)
 *   const key: FeatureFlagKey = FEATURE_FLAG_KEYS.FF_AUDIT_HASH_CHAIN;
 *
 * Architecture notes
 * ──────────────────
 *   • `featureFlags` is a module-level singleton — values are fixed at
 *     build time because Next.js inlines NEXT_PUBLIC_ vars at compile time.
 *     There is no runtime re-evaluation or subscription mechanism; this is
 *     intentional for simplicity and build-time optimisation.
 *   • For server-side feature-flag access use `getClientEnv()` from
 *     `@/lib/env` which validates the full clientEnvSchema.
 *   • The `parseBoolFlag` helper mirrors the Zod `boolFlag` transform in
 *     `env.ts`: "1" or "true" → true, anything else → false.
 */

// ─── Flag keys ────────────────────────────────────────────────────────────────

/**
 * Canonical map of all feature flag identifiers.
 *
 * Use these constants in component code instead of raw string literals so that
 * references can be found by grep / IDE symbol search.
 */
export const FEATURE_FLAG_KEYS = {
  /** SHA-256 hash-chain audit trail in T5 Audit Ledger. */
  FF_AUDIT_HASH_CHAIN: "FF_AUDIT_HASH_CHAIN",
  /** Mission Control map mode (M5). */
  FF_MAP_MISSION: "FF_MAP_MISSION",
  /** INVENTORY redesign (spec sections 0–25). */
  FF_INV_REDESIGN: "FF_INV_REDESIGN",
} as const;

/** Union of all flag key strings. */
export type FeatureFlagKey = keyof typeof FEATURE_FLAG_KEYS;

// ─── Flag values interface ────────────────────────────────────────────────────

/**
 * Runtime-resolved boolean values for all feature flags.
 */
export interface FeatureFlags {
  /** Whether the SHA-256 hash-chain audit trail is enabled (T5 footer, hash columns). */
  FF_AUDIT_HASH_CHAIN: boolean;
  /** Whether Mission Control map mode (M5) is enabled. */
  FF_MAP_MISSION: boolean;
  /** Whether the INVENTORY redesign is enabled. */
  FF_INV_REDESIGN: boolean;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Parse a raw environment variable string as a boolean flag.
 * Returns `true` only for the strings "1" and "true" (case-sensitive).
 * Returns `false` for undefined, empty string, "0", "false", etc.
 */
function parseBoolFlag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Module-level feature flag singleton.
 *
 * Values are resolved once at module load time from NEXT_PUBLIC_ environment
 * variables, which Next.js inlines at build time.  In production the values
 * are fixed; in development they reflect whatever is in `.env.local`.
 *
 * @example
 * import { featureFlags } from "@/lib/feature-flags";
 *
 * // In a server component / route handler / layout:
 * const ffAuditHashChain = featureFlags.FF_AUDIT_HASH_CHAIN;
 *
 * // In a client component (same import, same values):
 * const ffMission = featureFlags.FF_MAP_MISSION;
 */
export const featureFlags: FeatureFlags = {
  FF_AUDIT_HASH_CHAIN: parseBoolFlag(
    process.env.NEXT_PUBLIC_FF_AUDIT_HASH_CHAIN,
  ),
  FF_MAP_MISSION: parseBoolFlag(process.env.NEXT_PUBLIC_FF_MAP_MISSION),
  FF_INV_REDESIGN: parseBoolFlag(process.env.NEXT_PUBLIC_FF_INV_REDESIGN),
};
