/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_trackShipment from "../actions/trackShipment.js";
import type * as auth from "../auth.js";
import type * as caseTemplates from "../caseTemplates.js";
import type * as cases from "../cases.js";
import type * as checklistHelpers from "../checklistHelpers.js";
import type * as checklists from "../checklists.js";
import type * as conditionNotes from "../conditionNotes.js";
import type * as crons from "../crons.js";
import type * as custody from "../custody.js";
import type * as custodyHandoffs from "../custodyHandoffs.js";
import type * as custodyHelpers from "../custodyHelpers.js";
import type * as damage from "../damage.js";
import type * as damageAndShipping from "../damageAndShipping.js";
import type * as damageReports from "../damageReports.js";
import type * as fedex_trackShipment from "../fedex/trackShipment.js";
import type * as fedexClient from "../fedexClient.js";
import type * as heatmapData from "../heatmapData.js";
import type * as historyTrails from "../historyTrails.js";
import type * as http from "../http.js";
import type * as journeyStopHelpers from "../journeyStopHelpers.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_fedexAuth from "../lib/fedexAuth.js";
import type * as lib_fedexTrack from "../lib/fedexTrack.js";
import type * as lib_geo_bin from "../lib/geo_bin.js";
import type * as lib_org_role_policy from "../lib/org_role_policy.js";
import type * as mapData from "../mapData.js";
import type * as maps from "../maps.js";
import type * as missions from "../missions.js";
import type * as mutations_checklist from "../mutations/checklist.js";
import type * as mutations_custody from "../mutations/custody.js";
import type * as mutations_damage from "../mutations/damage.js";
import type * as mutations_index from "../mutations/index.js";
import type * as mutations_qcSignOff from "../mutations/qcSignOff.js";
import type * as mutations_scan from "../mutations/scan.js";
import type * as mutations_ship from "../mutations/ship.js";
import type * as notifications from "../notifications.js";
import type * as organizations from "../organizations.js";
import type * as outboundShipments from "../outboundShipments.js";
import type * as qrAssociationAuditHelpers from "../qrAssociationAuditHelpers.js";
import type * as qrAssociationEventInsert from "../qrAssociationEventInsert.js";
import type * as qrAssociationEvents from "../qrAssociationEvents.js";
import type * as qrCodeHelpers from "../qrCodeHelpers.js";
import type * as qrCodes from "../qrCodes.js";
import type * as qrReassignmentHelpers from "../qrReassignmentHelpers.js";
import type * as queries_damage from "../queries/damage.js";
import type * as queries_events from "../queries/events.js";
import type * as queries_journeyStops from "../queries/journeyStops.js";
import type * as queries_organizations from "../queries/organizations.js";
import type * as queries_qcSignOff from "../queries/qcSignOff.js";
import type * as queries_shipment from "../queries/shipment.js";
import type * as queries_swimLanes from "../queries/swimLanes.js";
import type * as rbac from "../rbac.js";
import type * as scan from "../scan.js";
import type * as scanActions from "../scanActions.js";
import type * as scanMobile from "../scanMobile.js";
import type * as seed from "../seed.js";
import type * as shipping from "../shipping.js";
import type * as shippingHelpers from "../shippingHelpers.js";
import type * as sites from "../sites.js";
import type * as swimLaneHelpers from "../swimLaneHelpers.js";
import type * as telemetry from "../telemetry.js";
import type * as turbines from "../turbines.js";
import type * as units from "../units.js";
import type * as userPreferences from "../userPreferences.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/trackShipment": typeof actions_trackShipment;
  auth: typeof auth;
  caseTemplates: typeof caseTemplates;
  cases: typeof cases;
  checklistHelpers: typeof checklistHelpers;
  checklists: typeof checklists;
  conditionNotes: typeof conditionNotes;
  crons: typeof crons;
  custody: typeof custody;
  custodyHandoffs: typeof custodyHandoffs;
  custodyHelpers: typeof custodyHelpers;
  damage: typeof damage;
  damageAndShipping: typeof damageAndShipping;
  damageReports: typeof damageReports;
  "fedex/trackShipment": typeof fedex_trackShipment;
  fedexClient: typeof fedexClient;
  heatmapData: typeof heatmapData;
  historyTrails: typeof historyTrails;
  http: typeof http;
  journeyStopHelpers: typeof journeyStopHelpers;
  "lib/auth": typeof lib_auth;
  "lib/fedexAuth": typeof lib_fedexAuth;
  "lib/fedexTrack": typeof lib_fedexTrack;
  "lib/geo_bin": typeof lib_geo_bin;
  "lib/org_role_policy": typeof lib_org_role_policy;
  mapData: typeof mapData;
  maps: typeof maps;
  missions: typeof missions;
  "mutations/checklist": typeof mutations_checklist;
  "mutations/custody": typeof mutations_custody;
  "mutations/damage": typeof mutations_damage;
  "mutations/index": typeof mutations_index;
  "mutations/qcSignOff": typeof mutations_qcSignOff;
  "mutations/scan": typeof mutations_scan;
  "mutations/ship": typeof mutations_ship;
  notifications: typeof notifications;
  organizations: typeof organizations;
  outboundShipments: typeof outboundShipments;
  qrAssociationAuditHelpers: typeof qrAssociationAuditHelpers;
  qrAssociationEventInsert: typeof qrAssociationEventInsert;
  qrAssociationEvents: typeof qrAssociationEvents;
  qrCodeHelpers: typeof qrCodeHelpers;
  qrCodes: typeof qrCodes;
  qrReassignmentHelpers: typeof qrReassignmentHelpers;
  "queries/damage": typeof queries_damage;
  "queries/events": typeof queries_events;
  "queries/journeyStops": typeof queries_journeyStops;
  "queries/organizations": typeof queries_organizations;
  "queries/qcSignOff": typeof queries_qcSignOff;
  "queries/shipment": typeof queries_shipment;
  "queries/swimLanes": typeof queries_swimLanes;
  rbac: typeof rbac;
  scan: typeof scan;
  scanActions: typeof scanActions;
  scanMobile: typeof scanMobile;
  seed: typeof seed;
  shipping: typeof shipping;
  shippingHelpers: typeof shippingHelpers;
  sites: typeof sites;
  swimLaneHelpers: typeof swimLaneHelpers;
  telemetry: typeof telemetry;
  turbines: typeof turbines;
  units: typeof units;
  userPreferences: typeof userPreferences;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
