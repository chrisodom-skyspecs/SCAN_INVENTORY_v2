/**
 * src/lib/fedex-tracking-errors.ts
 *
 * Pure utility functions and constants for FedEx tracking error handling.
 *
 * Extracted from `src/hooks/use-fedex-tracking.ts` to enable unit testing
 * without React or Convex runtime dependencies.
 *
 * These utilities are also imported by the SCAN app's shipment form to show
 * contextual error messages based on the machine-readable error code embedded
 * in Convex action error messages.
 *
 * Error format:
 * All FedEx tracking Convex actions throw errors with a bracketed prefix:
 *   "[INVALID_TRACKING_NUMBER] ..."
 *   "[NOT_FOUND] ..."
 *   "[RATE_LIMITED] ..."
 *   "[AUTH_ERROR] ..."
 *   etc.
 *
 * Use `parseFedExErrorCode(message)` to extract the code, then look up a
 * user-friendly message from `FEDEX_ERROR_MESSAGES`.
 */

// ─── Error code type ──────────────────────────────────────────────────────────

/**
 * Machine-readable error codes returned by the FedEx tracking Convex actions.
 *
 * These codes are embedded in error messages using a bracketed prefix format:
 *   "[INVALID_TRACKING_NUMBER] the number is not valid"
 *   "[NOT_FOUND] tracking number was not found in the FedEx system"
 *
 * They match the error code prefixes thrown by:
 *   • `api.fedex.trackShipment` (convex/fedex/trackShipment.ts)
 *   • `api.shipping.trackShipment` (convex/shipping.ts)
 *   • `api.shipping.getCaseTrackingStatus` (convex/shipping.ts)
 */
export type FedExTrackingErrorCode =
  | "INVALID_TRACKING_NUMBER" // input failed format validation (empty, too short, non-numeric)
  | "NOT_FOUND"               // tracking number not found in the FedEx system
  | "AUTH_ERROR"              // FedEx credentials rejected (401 Unauthorized)
  | "RATE_LIMITED"            // FedEx API rate limit exceeded (429)
  | "SERVER_ERROR"            // FedEx API 5xx server error
  | "NETWORK_ERROR"           // fetch() threw (DNS failure, timeout, etc.)
  | "PARSE_ERROR"             // FedEx API response was not valid JSON or unexpected shape
  | "CONFIGURATION_ERROR"     // FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET not set
  | "UNKNOWN_ERROR";          // catch-all for unrecognised failure modes

/**
 * The ordered set of all known FedEx tracking error codes.
 * Used by `parseFedExErrorCode` to validate parsed codes.
 */
export const FEDEX_TRACKING_ERROR_CODES: FedExTrackingErrorCode[] = [
  "INVALID_TRACKING_NUMBER",
  "NOT_FOUND",
  "AUTH_ERROR",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "NETWORK_ERROR",
  "PARSE_ERROR",
  "CONFIGURATION_ERROR",
  "UNKNOWN_ERROR",
];

// ─── User-friendly messages ───────────────────────────────────────────────────

/**
 * User-friendly error messages keyed by `FedExTrackingErrorCode`.
 *
 * Safe to display directly in the UI.  Messages are concise and actionable
 * without exposing internal implementation details.
 *
 * Usage:
 *   const code = parseFedExErrorCode(err.message);
 *   const msg  = code ? FEDEX_ERROR_MESSAGES[code] : FEDEX_ERROR_MESSAGES.UNKNOWN_ERROR;
 *   // Show `msg` in the UI
 */
export const FEDEX_ERROR_MESSAGES: Record<FedExTrackingErrorCode, string> = {
  INVALID_TRACKING_NUMBER:
    "That doesn't look like a valid FedEx tracking number. " +
    "FedEx numbers are at least 10 digits long.",
  NOT_FOUND:
    "Tracking number not found in the FedEx system. " +
    "Check the number and try again.",
  AUTH_ERROR:
    "Unable to connect to FedEx right now. Contact support if this persists.",
  RATE_LIMITED:
    "Too many tracking requests. Please wait a moment and try again.",
  SERVER_ERROR:
    "FedEx is temporarily unavailable. Please try again in a few minutes.",
  NETWORK_ERROR:
    "Network error — check your connection and try again.",
  PARSE_ERROR:
    "Received an unexpected response from FedEx. Try again.",
  CONFIGURATION_ERROR:
    "FedEx tracking is not configured. Contact your administrator.",
  UNKNOWN_ERROR:
    "An unexpected error occurred. Please try again.",
};

// ─── Error parsing utilities ──────────────────────────────────────────────────

/**
 * Parse the machine-readable error code from a FedEx tracking action error
 * message.
 *
 * All FedEx tracking Convex actions throw errors in the form:
 *   "[CODE] Human-readable description..."
 *
 * This function extracts `CODE` from the bracketed prefix and validates it
 * against the known `FedExTrackingErrorCode` union.
 *
 * Returns `null` when:
 *   • The message does not start with a bracketed prefix.
 *   • The extracted code is not a recognised `FedExTrackingErrorCode`.
 *
 * @example
 * parseFedExErrorCode("[NOT_FOUND] Tracking number cannot be found.")
 * // → "NOT_FOUND"
 *
 * parseFedExErrorCode("Something went wrong")
 * // → null
 *
 * parseFedExErrorCode("[BOGUS_CODE] ...")
 * // → null  (not a known FedExTrackingErrorCode)
 */
export function parseFedExErrorCode(
  message: string
): FedExTrackingErrorCode | null {
  const match = message.match(/^\[([A-Z_]+)\]/);
  if (!match) return null;

  const candidate = match[1] as string;
  return (FEDEX_TRACKING_ERROR_CODES as string[]).includes(candidate)
    ? (candidate as FedExTrackingErrorCode)
    : null;
}

/**
 * Get a user-friendly error message from a caught FedEx tracking error.
 *
 * Resolution order:
 *   1. Parse the bracketed error code from the error message.
 *   2. Look up the user-friendly message in `FEDEX_ERROR_MESSAGES`.
 *   3. If no code is recognised, strip the bracketed prefix (if present) and
 *      return the remaining message text.
 *   4. Ultimate fallback: `FEDEX_ERROR_MESSAGES.UNKNOWN_ERROR`.
 *
 * @param err  The caught error (Error instance or unknown).
 * @returns    A human-readable string safe to display directly in the UI.
 *
 * @example
 * try {
 *   await convex.action(api.fedex.trackShipment, { trackingNumber });
 * } catch (err) {
 *   const msg = getFedExUserErrorMessage(err);
 *   setErrorMessage(msg); // Show `msg` in the form
 * }
 */
export function getFedExUserErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : "";

  if (!raw) return FEDEX_ERROR_MESSAGES.UNKNOWN_ERROR;

  const code = parseFedExErrorCode(raw);
  if (code) return FEDEX_ERROR_MESSAGES[code];

  // Strip the bracketed prefix (if any) from the raw message.
  const stripped = raw.replace(/^\[[A-Z_]+\]\s*/, "").trim();
  return stripped || FEDEX_ERROR_MESSAGES.UNKNOWN_ERROR;
}

/**
 * Determine whether a FedEx tracking error is transient (safe to retry) or
 * permanent (user input error, configuration issue, etc.).
 *
 * Transient errors: RATE_LIMITED, SERVER_ERROR, NETWORK_ERROR, PARSE_ERROR
 * Permanent errors: INVALID_TRACKING_NUMBER, NOT_FOUND, AUTH_ERROR,
 *                   CONFIGURATION_ERROR, UNKNOWN_ERROR
 *
 * Use this to decide whether to show a "Try Again" button or a "Check the
 * number and try again" message.
 *
 * @param code  A parsed `FedExTrackingErrorCode`.
 * @returns `true` when the error is likely transient and worth retrying.
 */
export function isFedExTransientError(code: FedExTrackingErrorCode): boolean {
  const transient: FedExTrackingErrorCode[] = [
    "RATE_LIMITED",
    "SERVER_ERROR",
    "NETWORK_ERROR",
    "PARSE_ERROR",
  ];
  return transient.includes(code);
}
