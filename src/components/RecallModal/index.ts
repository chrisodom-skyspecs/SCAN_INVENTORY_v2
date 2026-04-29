/**
 * RecallModal — barrel export.
 *
 * Exports the main RecallModal component (multi-step shell), per-step
 * content components, and all associated TypeScript interfaces.
 *
 * Primary export:
 *   RecallModal                 — top-level modal shell (portal + dialog)
 *
 * Step components (exposed for testing / composition):
 *   RecallModalStep1Confirm     — Step 1 confirm view (pure presentational)
 *   RecallModalStep2Reroute     — Step 2 reroute view (return method + notes)
 *
 * Types:
 *   RecallCaseSummary             — pre-fetched case data accepted by the modal
 *   RecallStep                    — step discriminant (1 | 2)
 *   RecallModalProps              — main modal props
 *   RecallModalStep1ConfirmProps  — step 1 component props
 *   RecallReturnMethod            — union of valid return method values
 *   RecallRerouteData             — step 2 form submission payload
 *   RecallModalStep2RerouteProps  — step 2 component props
 */

export { RecallModal, type RecallCaseSummary, type RecallStep, type RecallModalProps } from "./RecallModal";
export { RecallModalStep1Confirm, type RecallModalStep1ConfirmProps } from "./RecallModalStep1Confirm";
export {
  RecallModalStep2Reroute,
  type RecallReturnMethod,
  type RecallRerouteData,
  type RecallModalStep2RerouteProps,
} from "./RecallModalStep2Reroute";
