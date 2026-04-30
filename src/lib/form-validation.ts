/**
 * src/lib/form-validation.ts
 *
 * Pure, framework-agnostic form field validation utilities for the SCAN mobile
 * app and INVENTORY dashboard forms.
 *
 * Design goals
 * ────────────
 * • Client-side validation rules run synchronously before any network request.
 * • Convex mutation errors are parsed and mapped to specific field names so the
 *   UI can display inline error messages next to the relevant field, not just
 *   a generic banner at the top of the form.
 * • All exported functions are pure (no side effects) and testable in isolation
 *   without React or Convex runtime dependencies.
 *
 * Validation rule conventions
 * ───────────────────────────
 * A validation rule is a `FieldValidator<T>` — a function that receives the
 * field value and returns a string (error message) or null (valid).
 *
 * Rules are composable: `composeValidators(required(), maxLength(500))` returns
 * a single validator that runs both rules in order and returns the first error.
 *
 * Convex error mapping
 * ────────────────────
 * Convex mutations throw errors whose `.message` strings can encode a field
 * name using the convention:
 *   "[FIELD:fieldName] Human-readable description"
 *
 * `parseConvexFieldError(err)` extracts the field name and message, allowing
 * callers to surface the error under the correct form field.
 *
 * When the Convex error does not encode a field name, `fieldName` is null and
 * the message should be shown in a banner.
 */

// ─── Validator type ────────────────────────────────────────────────────────────

/**
 * A validation function for a single field value.
 * Returns a user-friendly error string, or null when the value is valid.
 */
export type FieldValidator<T = string> = (value: T) => string | null;

// ─── Primitive validators ──────────────────────────────────────────────────────

/**
 * Validates that a string field is non-empty after trimming.
 *
 * @param message  Custom error message.  Default: "This field is required."
 *
 * @example
 * required()("  ")  // → "This field is required."
 * required()("hi")  // → null
 */
export function required(
  message = "This field is required."
): FieldValidator<string> {
  return (value) => (value.trim().length === 0 ? message : null);
}

/**
 * Validates that a string's trimmed length does not exceed `max`.
 *
 * @param max      Maximum character count (after trimming).
 * @param message  Custom error message.
 *
 * @example
 * maxLength(10)("hello world")  // → "Must be 10 characters or fewer."
 * maxLength(10)("hi")           // → null
 */
export function maxLength(
  max: number,
  message?: string
): FieldValidator<string> {
  return (value) => {
    const len = value.trim().length;
    return len > max
      ? (message ?? `Must be ${max} characters or fewer.`)
      : null;
  };
}

/**
 * Validates that a string's trimmed length is at least `min`.
 *
 * @param min      Minimum character count (after trimming).
 * @param message  Custom error message.
 *
 * @example
 * minLength(5)("hi")        // → "Must be at least 5 characters."
 * minLength(5)("hello!")    // → null
 */
export function minLength(
  min: number,
  message?: string
): FieldValidator<string> {
  return (value) => {
    const len = value.trim().length;
    return len > 0 && len < min
      ? (message ?? `Must be at least ${min} characters.`)
      : null;
  };
}

/**
 * Validates that a string matches a given regular expression.
 *
 * @param pattern  The regex pattern to test.
 * @param message  Error message shown when the pattern does not match.
 *
 * @example
 * pattern(/^\d+$/, "Digits only")("abc")   // → "Digits only"
 * pattern(/^\d+$/, "Digits only")("123")   // → null
 */
export function pattern(
  regex: RegExp,
  message: string
): FieldValidator<string> {
  return (value) => {
    const trimmed = value.trim();
    return trimmed.length > 0 && !regex.test(trimmed) ? message : null;
  };
}

// ─── Domain-specific validators ────────────────────────────────────────────────

/**
 * FedEx tracking number format validator.
 *
 * FedEx tracking numbers are numeric strings of varying lengths depending on
 * the service type:
 *
 *   12 digits   — Ground (FNSKU / standard Ground)
 *   15 digits   — SmartPost / FedEx Home Delivery
 *   20 digits   — Express (international)
 *   22 digits   — Door tag / FedEx Office
 *   34 digits   — SSCC-18 barcode-format tracking
 *
 * The SCAN app accepts 10–34 digit numeric strings as a pragmatic range that
 * covers all current and near-future FedEx number formats.
 *
 * This validator:
 *   1. Rejects empty input (required — use `required()` to emit that message
 *      separately; this validator returns null for empty to allow composing).
 *   2. Rejects non-numeric characters.
 *   3. Rejects strings outside the 10–34 digit range.
 *
 * @example
 * fedexTrackingNumber()("")             // → null  (let `required()` handle empty)
 * fedexTrackingNumber()("abcde12345")   // → "FedEx tracking numbers contain only digits."
 * fedexTrackingNumber()("123")          // → "FedEx tracking numbers are 10–34 digits long."
 * fedexTrackingNumber()("794644823741") // → null  (valid 12-digit Ground number)
 */
export function fedexTrackingNumber(): FieldValidator<string> {
  return (value) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null; // let required() handle empty

    // Must be digits only (no spaces, dashes, or alpha)
    if (!/^\d+$/.test(trimmed)) {
      return "FedEx tracking numbers contain only digits (no spaces or dashes).";
    }

    // Must be within the 10–34 digit range
    if (trimmed.length < 10) {
      return "FedEx tracking numbers are at least 10 digits long.";
    }
    if (trimmed.length > 34) {
      return "FedEx tracking numbers are at most 34 digits long.";
    }

    return null;
  };
}

/**
 * Validates that a value (non-string, e.g. a nullable object) is not null/undefined.
 *
 * @param message  Custom error message.
 *
 * @example
 * requiredSelection<UserSelectorValue>("Select a recipient.")( null)   // → "Select a recipient."
 * requiredSelection<UserSelectorValue>("Select a recipient.")({ … })   // → null
 */
export function requiredSelection<T>(
  message = "A selection is required."
): FieldValidator<T | null> {
  return (value) => (value == null ? message : null);
}

// ─── Validator composition ─────────────────────────────────────────────────────

/**
 * Run a list of validators in order and return the first error, or null if all
 * pass.
 *
 * @example
 * const validate = composeValidators(
 *   required(),
 *   fedexTrackingNumber()
 * );
 * validate("")              // → "This field is required."
 * validate("abc")           // → "FedEx tracking numbers contain only digits..."
 * validate("794644823741")  // → null
 */
export function composeValidators<T>(
  ...validators: Array<FieldValidator<T>>
): FieldValidator<T> {
  return (value) => {
    for (const v of validators) {
      const error = v(value);
      if (error !== null) return error;
    }
    return null;
  };
}

// ─── Convex error parsing ──────────────────────────────────────────────────────

/**
 * Structured result from parsing a Convex mutation error.
 *
 * `fieldName` — the form field name the error is associated with, or null when
 *               the error applies to the form as a whole (banner-level error).
 * `message`   — the user-friendly error message to display.
 */
export interface ConvexFieldError {
  /** The form field name this error applies to, or null for a form-level error. */
  fieldName: string | null;
  /** User-facing error message. */
  message: string;
}

/**
 * Parse a Convex mutation error into a structured `ConvexFieldError`.
 *
 * Convex mutations may encode the relevant form field in the error message using
 * either of two prefix conventions:
 *
 *   "[FIELD:fieldName] Description"  — field-specific error
 *   "[CODE] Description"             — form-level coded error (no field)
 *
 * When neither convention applies, the raw message is returned as a form-level
 * error (fieldName: null).
 *
 * `fieldName` is normalised to camelCase where the Convex error uses the
 * mutation argument name (e.g. `trackingNumber`, `toUserId`).
 *
 * @param err  The caught error from a Convex mutation call.
 * @returns    A `ConvexFieldError` with the field name (or null) and message.
 *
 * @example
 * parseConvexFieldError(new Error("[FIELD:trackingNumber] Number is invalid"))
 * // → { fieldName: "trackingNumber", message: "Number is invalid" }
 *
 * parseConvexFieldError(new Error("[INVALID_STATUS] Cannot transition from archived."))
 * // → { fieldName: null, message: "Cannot transition from archived." }
 *
 * parseConvexFieldError(new Error("Something unexpected happened."))
 * // → { fieldName: null, message: "Something unexpected happened." }
 */
export function parseConvexFieldError(err: unknown): ConvexFieldError {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : "";

  if (!raw) {
    return {
      fieldName: null,
      message: "An unexpected error occurred. Please try again.",
    };
  }

  // Pattern 1: "[FIELD:fieldName] message"
  const fieldMatch = raw.match(/^\[FIELD:([A-Za-z][A-Za-z0-9_]*)\]\s*(.*)/s);
  if (fieldMatch) {
    return {
      fieldName: fieldMatch[1],
      message: fieldMatch[2].trim() || raw,
    };
  }

  // Pattern 2: "[ERROR_CODE] message" — form-level coded error
  const codeMatch = raw.match(/^\[[A-Z][A-Z0-9_]*\]\s*(.*)/s);
  if (codeMatch) {
    const strippedMessage = codeMatch[1].trim();
    return {
      fieldName: null,
      message: strippedMessage || raw,
    };
  }

  // Pattern 3: Plain message — return as-is as a form-level error
  return { fieldName: null, message: raw };
}

/**
 * Extract the bracketed error code from a Convex mutation error message.
 *
 * Convex mutations encode a machine-readable code as the first token of the
 * error message using the convention "[ERROR_CODE] description…".  This helper
 * extracts that code so callers can handle specific error conditions differently
 * from the generic "form-level error" banner path.
 *
 * @param err  The caught error from a Convex mutation call.
 * @returns    The upper-case error code string (e.g. "QC_APPROVAL_REQUIRED"),
 *             or null when the error does not match the convention.
 *
 * @example
 * extractConvexErrorCode(new Error("[QC_APPROVAL_REQUIRED] Case cannot be dispatched…"))
 * // → "QC_APPROVAL_REQUIRED"
 *
 * extractConvexErrorCode(new Error("Something unexpected happened."))
 * // → null
 *
 * extractConvexErrorCode(new Error("[FIELD:trackingNumber] Invalid format"))
 * // → null  (FIELD: prefix is handled by parseConvexFieldError, not this helper)
 */
export function extractConvexErrorCode(err: unknown): string | null {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : "";

  if (!raw) return null;

  // Match "[CODE]" prefix — upper-case letters, digits, and underscores only.
  // Does NOT match "[FIELD:name]" because "FIELD:" contains a colon.
  const codeMatch = raw.match(/^\[([A-Z][A-Z0-9_]*)\]/);
  if (codeMatch && !codeMatch[1].startsWith("FIELD")) {
    return codeMatch[1];
  }

  return null;
}

/**
 * Map a Convex mutation error to a field-level error map.
 *
 * When the error encodes a `fieldName`, the map contains that field's error.
 * When the error is form-level (fieldName: null), the map is empty and the
 * caller should surface the error via the form-level `submitError` state.
 *
 * @param err        The caught mutation error.
 * @param fieldNames The set of field names that exist in this form.  Only field
 *                   names present in this set will be added to the map; unmatched
 *                   field errors fall back to the form-level banner.
 * @returns          A record of `{ [fieldName]: errorMessage }`, possibly empty.
 *
 * @example
 * mapConvexErrorToFields(
 *   new Error("[FIELD:trackingNumber] Invalid format"),
 *   ["trackingNumber", "originName"]
 * )
 * // → { trackingNumber: "Invalid format" }
 *
 * mapConvexErrorToFields(
 *   new Error("[RATE_LIMITED] Too many requests"),
 *   ["trackingNumber"]
 * )
 * // → {}   (form-level error — caller handles separately)
 */
export function mapConvexErrorToFields(
  err: unknown,
  fieldNames: string[]
): Record<string, string> {
  const parsed = parseConvexFieldError(err);
  if (
    parsed.fieldName !== null &&
    fieldNames.includes(parsed.fieldName)
  ) {
    return { [parsed.fieldName]: parsed.message };
  }
  return {};
}

// ─── Field touched / dirty state helpers ──────────────────────────────────────

/**
 * Determine whether a field should show its validation error.
 *
 * Fields only show errors after the user has interacted with them ("touched")
 * or after a submit attempt has been made — this avoids showing red errors on
 * a pristine form.
 *
 * @param fieldName    The field identifier.
 * @param touchedFields  A `Set` of fields the user has already focused+blurred.
 * @param submitAttempted  `true` after the first submit attempt (show all errors).
 *
 * @example
 * shouldShowError("trackingNumber", new Set(), false)           // → false
 * shouldShowError("trackingNumber", new Set(["trackingNumber"]), false) // → true
 * shouldShowError("trackingNumber", new Set(), true)            // → true
 */
export function shouldShowError(
  fieldName: string,
  touchedFields: Set<string>,
  submitAttempted: boolean
): boolean {
  return submitAttempted || touchedFields.has(fieldName);
}
