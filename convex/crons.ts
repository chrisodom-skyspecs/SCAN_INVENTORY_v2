/**
 * convex/crons.ts
 *
 * Scheduled (cron) jobs registered with Convex.
 *
 * Convex auto-discovers any default-exported `Crons` object at the path
 * `convex/crons.ts`.  Schedules defined here are deployed alongside the rest
 * of the Convex functions whenever `npx convex deploy` (or `npx convex dev`)
 * is run.  No additional wiring is required.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Active shipments tracking poll  (Sub-AC 3 of AC 39)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The `poll active shipments` job fires every 15 minutes and invokes
 * `internal.shipping.pollActiveShipments`, which:
 *
 *   1. Reads every shipment whose status is non-terminal (label_created,
 *      picked_up, in_transit, out_for_delivery) via the `by_status` index.
 *   2. Fans out one `internal.shipping.refreshShipmentTracking` call per
 *      shipment via `ctx.scheduler.runAfter(0, …)`.  Each fan-out:
 *        • Calls the FedEx Track v1 API for the shipment's tracking number.
 *        • Normalises the response (status, statusCode, ETA, last-location,
 *          full event timeline).
 *        • Persists the new status, lastEvent, and estimatedDelivery to the
 *          `shipments` row via `internal.shipping.updateShipmentStatus`.
 *        • Denormalises carrierStatus + lastCarrierEvent + estimatedDelivery
 *          onto the parent `cases` row so the M4 logistics map mode and T1/T4
 *          dashboard panels reflect carrier state without a secondary join.
 *
 * Cadence rationale (every 15 minutes):
 *   • FedEx scan events typically appear at the same cadence as physical
 *     network activity (every few hours), so polling at 15-minute granularity
 *     captures status changes well within the operations team's expected
 *     "freshness" window for the M4 map mode and T4 shipping dashboard.
 *   • Active fleets carry well under 500 in-flight shipments.  At 4×
 *     fan-outs/hour × <500 shipments = <2,000 FedEx calls/hour worst case,
 *     comfortably below FedEx's Track v1 rate limits.
 *   • Each fan-out is independent — a single slow or failing tracking number
 *     cannot back up the queue.
 *
 * Operational notes:
 *   • The job is idempotent: `refreshShipmentTracking` skips rows that have
 *     transitioned to a terminal status between scheduling and execution.
 *   • If the entire fleet is dormant, `pollActiveShipments` returns
 *     `{ scheduled: 0 }` and exits without scheduling anything.
 *   • Manual on-demand refresh (e.g. from the SCAN app's "Refresh Tracking"
 *     button) is unaffected; this cron only supplements user-driven polls.
 *
 * To monitor cron health:
 *   • Convex dashboard → Functions → Logs (filter by
 *     `internal.shipping.pollActiveShipments`).
 *   • Convex dashboard → Functions → Crons (shows last run timestamp + status).
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "poll active shipments",
  { minutes: 15 },
  internal.shipping.pollActiveShipments,
  {},
);

export default crons;
