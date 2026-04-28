/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as caseTemplates from "../caseTemplates.js";
import type * as cases from "../cases.js";
import type * as checklistHelpers from "../checklistHelpers.js";
import type * as checklists from "../checklists.js";
import type * as custody from "../custody.js";
import type * as custodyHelpers from "../custodyHelpers.js";
import type * as damageReports from "../damageReports.js";
import type * as fedex_trackShipment from "../fedex/trackShipment.js";
import type * as fedexClient from "../fedexClient.js";
import type * as http from "../http.js";
import type * as lib_fedexAuth from "../lib/fedexAuth.js";
import type * as mapData from "../mapData.js";
import type * as maps from "../maps.js";
import type * as missions from "../missions.js";
import type * as qrCodes from "../qrCodes.js";
import type * as scan from "../scan.js";
import type * as shipping from "../shipping.js";
import type * as shippingHelpers from "../shippingHelpers.js";
import type * as telemetry from "../telemetry.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  caseTemplates: typeof caseTemplates;
  cases: typeof cases;
  checklistHelpers: typeof checklistHelpers;
  checklists: typeof checklists;
  custody: typeof custody;
  custodyHelpers: typeof custodyHelpers;
  damageReports: typeof damageReports;
  "fedex/trackShipment": typeof fedex_trackShipment;
  fedexClient: typeof fedexClient;
  http: typeof http;
  "lib/fedexAuth": typeof lib_fedexAuth;
  mapData: typeof mapData;
  maps: typeof maps;
  missions: typeof missions;
  qrCodes: typeof qrCodes;
  scan: typeof scan;
  shipping: typeof shipping;
  shippingHelpers: typeof shippingHelpers;
  telemetry: typeof telemetry;
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
