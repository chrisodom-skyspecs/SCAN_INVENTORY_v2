/**
 * Public library exports for SCAN_INVENTORY
 */

// Map URL parameter utilities
export * from "./map-url-params";

// QR code generation utility
export * from "./qr-code";

// FedEx tracking client (server-side only)
export * from "./fedex";

// Shared telemetry instrumentation library
export * from "./telemetry.lib";

// Typed client for GET /api/cases/map (URL builder + response serializers)
export * from "./cases-map-api";

// Environment variable schema and validation
export * from "./env";

// Case-status filter selector (layer toggles → visible cases)
export * from "./case-status-filter";

// Marker style configuration — per-status and per-layer visual properties
export * from "./marker-style-config";

// Map mode registry — M1-M5 metadata, groups, and feature flag access rules
export * from "./map-mode-registry";

// Layout preference storage — per-userId localStorage helpers for map mode (M1-M5)
// and case detail layout (T1-T5); usable from both INVENTORY and SCAN apps
export * from "./layout-storage";

// State-to-layout mapping — canonical mapping from CaseStatus to recommended
// INVENTORY map mode (M1–M5) and case detail layout (T1–T5)
export * from "./state-layout-map";

// Shared Kinde token helpers consumed by both INVENTORY and SCAN apps
// (server-only: getKindeToken, requireKindeToken, verifyKindeJwt,
//  extractUserFromToken, buildDisplayName, parseTokenClaims)
export {
  getKindeToken,
  requireKindeToken,
  verifyKindeJwt,
  extractUserFromToken,
  buildDisplayName,
  parseTokenClaims,
} from "./auth-token";
export type { KindeTokenClaims, ExtractedUser } from "./auth-token";

// T5 Audit Ledger hash-chain verification utility (FF_AUDIT_HASH_CHAIN)
export { verifyHashChain, buildCanonicalContent, sha256Hex } from "./audit-hash-chain";
export type {
  AuditEntry,
  HashChainValid,
  HashChainBroken,
  HashChainVerificationResult,
} from "./audit-hash-chain";

// Centralized feature flag configuration (FF_AUDIT_HASH_CHAIN, FF_MAP_MISSION, FF_INV_REDESIGN)
export { featureFlags, FEATURE_FLAG_KEYS } from "./feature-flags";
export type { FeatureFlags, FeatureFlagKey } from "./feature-flags";
