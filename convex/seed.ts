/**
 * convex/seed.ts
 *
 * Domain seed dataset for SCAN + INVENTORY.
 *
 * This seed is intentionally scenario-driven. Each kit represents a real-world
 * custody story: hangar assembly, QC signoff, shipping or handoff, field
 * checkout, condition confirmation, onward transfer, return, and hangar intake.
 *
 * Usage:
 *   npx convex run seed:seedDatabase
 *   npx convex run seed:seedDatabase '{"clearExisting":true}'
 */

import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

type TemplateItem = {
  id: string;
  name: string;
  description?: string;
  required: boolean;
  category?: string;
  sortOrder?: number;
  quantity?: number;
  unit?: string;
  notes?: string;
};

type TemplateKey =
  | "foresightGsc"
  | "foresightV1Aircraft"
  | "foresightV2Aircraft"
  | "foresightBattery"
  | "foresightCharger"
  | "skycrawlerRover"
  | "skycrawlerSupport"
  | "skycrawlerBattery";

type CaseStatus =
  | "hangar"
  | "assembled"
  | "transit_out"
  | "deployed"
  | "flagged"
  | "recalled"
  | "transit_in"
  | "received"
  | "archived";

type ManifestStatus = "unchecked" | "ok" | "damaged" | "missing";
type InspectionStatus = "pending" | "in_progress" | "completed" | "flagged";
type ShipmentStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";
type ScanType = "check_in" | "inspection" | "handoff" | "lookup" | "shipping" | "receiving";
type EventType =
  | "status_change"
  | "inspection_started"
  | "inspection_completed"
  | "item_checked"
  | "damage_reported"
  | "shipped"
  | "delivered"
  | "custody_handoff"
  | "note_added"
  | "photo_added"
  | "mission_assigned"
  | "template_applied"
  | "qc_sign_off"
  | "case_recalled"
  | "shipment_created"
  | "shipment_released";

type User = {
  id: string;
  name: string;
  role: "operator" | "logistics" | "field_tech" | "pilot" | "maintenance";
};

type Site = {
  key: string;
  name: string;
  lat: number;
  lng: number;
  missionName: string;
  description: string;
  status: "planning" | "active" | "completed" | "cancelled";
  lead: User;
  siteCode: string;
};

type Scenario = {
  unitId: string;
  platform: "ForeSight" | "SkyCrawler";
  version?: "V1" | "V2";
  beakon: string;
  nickname?: string;
  faaRegistration?: string;
  serialNumber?: string;
  missionKey: string;
  custodian: User;
  narrative: string;
  routeReason: string;
  cases: CaseSpec[];
};

type CaseSpec = {
  suffix: string;
  displayName: string;
  templateKey: TemplateKey;
  status: CaseStatus;
  batterySerials?: string[];
  issueTemplateItemIds?: string[];
  notes?: string;
  shippingDirection?: "outbound" | "return";
  shipmentStatus?: ShipmentStatus;
};

type SeededCase = {
  id: Id<"cases">;
  scenario: Scenario;
  spec: CaseSpec;
  label: string;
  qrCode: string;
  status: CaseStatus;
  missionId: Id<"missions">;
  site: Site;
  assignee: User;
};

const HQ = {
  lat: 42.2808,
  lng: -83.7430,
  name: "SkySpecs Hangar - Ann Arbor, MI",
};

const USERS = {
  ops: { id: "seed_usr_ops_morgan", name: "Morgan Reeves", role: "operator" },
  hangarLead: { id: "seed_usr_hangar_alicia", name: "Alicia Torres", role: "operator" },
  qc: { id: "seed_usr_qc_dana", name: "Dana Kim", role: "operator" },
  logistics: { id: "seed_usr_logistics_sarah", name: "Sarah Novak", role: "logistics" },
  pilotEmma: { id: "seed_usr_pilot_emma", name: "Emma Lundstrom", role: "pilot" },
  pilotMarc: { id: "seed_usr_pilot_marc", name: "Marcus Brown", role: "pilot" },
  techAlice: { id: "seed_usr_tech_alice", name: "Alice Chen", role: "field_tech" },
  techRaj: { id: "seed_usr_tech_raj", name: "Raj Patel", role: "field_tech" },
  techJames: { id: "seed_usr_tech_james", name: "James Okafor", role: "field_tech" },
  maintNia: { id: "seed_usr_maint_nia", name: "Nia Brooks", role: "maintenance" },
} satisfies Record<string, User>;

const FEDEX_TRACKING_NUMBERS = [
  "794644823741",
  "771448178291",
  "785334928472",
  "776271918294",
  "789234810293",
  "782918374521",
  "773847261938",
  "791827364821",
  "768234917283",
  "784719283746",
  "779283746182",
  "793847261934",
  "781928374652",
  "796182736451",
  "772918364728",
  "780034918274",
  "792837465120",
  "775928374610",
];

function daysAgo(now: number, n: number): number {
  return now - n * 24 * 60 * 60 * 1000;
}

function daysFromNow(now: number, n: number): number {
  return now + n * 24 * 60 * 60 * 1000;
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function offset(base: number, index: number, step: number): number {
  return base + (index - 2) * step;
}

function withOrder(items: TemplateItem[]): TemplateItem[] {
  return items.map((item, index) => ({ ...item, sortOrder: index + 1 }));
}

function item(
  id: string,
  name: string,
  category: string,
  quantity = 1,
  unit = "each",
  notes?: string,
  required = true,
): TemplateItem {
  return { id, name, category, quantity, unit, required, notes };
}

const TEMPLATE_ITEMS: Record<TemplateKey, TemplateItem[]> = {
  foresightGsc: withOrder([
    item("gsc-lipo-bags", "LiPo bags - inspect inside", "Safety", 2),
    item("gsc-desiccant", "Desiccant packet - check indicator", "Environmental", 1),
    item("gsc-usb-ethernet", "USB-A Ethernet adapter", "Connectivity", 2),
    item("gsc-ethernet-cable", "Ethernet cable", "Connectivity", 2),
    item("gsc-lens-blower", "Camera lens blower bulb", "Optics", 1),
    item("gsc-fire-blanket", "Fire blanket", "Safety", 1),
    item("gsc-dc-inverter", "300W DC inverter", "Power", 1),
    item("gsc-repair-electrical-tape", "Electrical tape", "Repair Items", 1, "roll"),
    item("gsc-repair-zip-ties", "Zip ties", "Repair Items", 24),
    item("gsc-repair-vhb", "VHB strips", "Repair Items", 3),
    item("gsc-repair-dual-lock", "Dual-lock strips", "Repair Items", 2),
    item("gsc-repair-loctite", "Closed Loctite capsule package", "Repair Items", 1),
    item("gsc-spare-telemetry-antennas", "Spare telemetry antennas - one left, one right", "Spares", 2),
    item("gsc-inspection-tags", "ULINE inspection tags", "Spares", 8),
    item("gsc-usb-mini", "USB-Mini cable", "Spares", 1),
    item("gsc-hw-m4-nyloc", "M4 SS Nyloc nuts", "Spare Hardware", 8),
    item("gsc-hw-m3-nyloc", "M3 SS Nyloc nuts", "Spare Hardware", 8),
    item("gsc-hw-m4x10", "M4x10 SS patched SHCS", "Spare Hardware", 4),
    item("gsc-hw-m3x8", "M3x8 SS patched SHCS", "Spare Hardware", 8),
    item("gsc-hw-gps-screws", "3-48x5/16 SHCS GPS antenna screws", "Spare Hardware", 4),
    item("gsc-hw-m3x6", "M3 x 6mm SS SHCS patched", "Spare Hardware", 6),
    item("gsc-hw-m25x10", "M2.5 x 10mm SS SHCS", "Spare Hardware", 4),
    item("gsc-tool-lens-wipes", "Camera lens wipes", "Toolbag", 4),
    item("gsc-tool-microfiber", "Camera lens microfiber cloth", "Toolbag", 1),
    item("gsc-tool-sd-reader", "USB SD card reader with micro SD", "Toolbag", 1),
    item("gsc-tool-micro-sd", "Micro SD card and adapter", "Toolbag", 1),
    item("gsc-tool-crescent", "Crescent wrench", "Toolbag", 1),
    item("gsc-tool-55-wrench", "5.5mm wrench", "Toolbag", 1),
    item("gsc-tool-7-wrench", "7mm wrench", "Toolbag", 1),
    item("gsc-tool-25-hex", "2.5 hex ball-nose L-key", "Toolbag", 1),
    item("gsc-tool-pliers", "Standard pliers", "Toolbag", 1),
    item("gsc-tool-snips", "Snips", "Toolbag", 1),
    item("gsc-tool-sma-torque", "SMA torque wrench - check torque", "Toolbag", 1),
    item("gsc-tool-hemostat", "Hemostat pliers", "Toolbag", 1),
    item("gsc-tool-wiha", "WIHA breakover tool with hex 2.5 set to 1.1 N-m", "Toolbag", 1),
    item("gsc-tool-15-driver", "1.5mm straight hex driver", "Toolbag", 1),
    item("gsc-tool-20-driver", "2.0mm straight hex driver", "Toolbag", 1),
    item("gsc-tool-25-driver", "2.5mm straight hex driver", "Toolbag", 1),
    item("gsc-tool-30-driver", "3.0mm straight hex driver", "Toolbag", 1),
    item("gsc-tool-ph0", "PH0 Phillips screwdriver", "Toolbag", 1),
    item("gsc-tool-t6", "T6x40 Torx driver", "Toolbag", 1),
    item("gsc-tool-fh", "FH screwdriver", "Toolbag", 1),
    item("gsc-tool-ruler", "Ruler", "Toolbag", 1),
    item("gsc-tool-dental-pick-case", "Dental pick case without metal pick", "Toolbag", 1),
    item("gsc-toughpad", "GCS Toughpad", "Ground Control", 1, "each", "Power on and verify screen protector."),
    item("gsc-toughpad-power", "Toughpad power supply and AC adaptor", "Ground Control", 1),
    item("gsc-toughpad-battery", "Spare GCS Toughpad battery", "Ground Control", 1, "each", "Verify battery is not recalled FZ-VZSU84U."),
    item("gsc-rtk-power", "RTK power supply 16V 4.5A 90 degree connector", "RTK", 1, "each", "Check by powering on."),
    item("gsc-rtk-cable", "RTK 12V cable assembly", "RTK", 1),
    item("gsc-drone-power", "Drone power supply 48V 5.2A with XT90 and wall cable", "Power", 1, "each", "Check anti-spark and XT connector insertion."),
    item("gsc-rtk-beakon", "RTK Beakon - record Beakon number", "Tracking", 1),
    item("gsc-first-aid", "First aid kit - document expiration date", "Safety", 1),
    item("gsc-rtk-battery-v2", "RTK battery pack - V2 only", "RTK", 1, "each", "Replace barrel adapter as needed.", false),
  ]),

  foresightV1Aircraft: withOrder([
    item("fv1-refurb", "Foresight refurbishment procedure complete", "Preflight", 1, "signoff", "Lens cap on, gimbal spacer installed, M4 top plate screws seated."),
    item("fv1-aircraft-system", "Foresight V1 inspection system with inspection runtime", "Aircraft", 1),
    item("fv1-aircraft-beakon", "Aircraft Beakon paired to ForeSight unit", "Tracking", 1),
    item("fv1-horus", "FrSky Horus with transmitter module", "Control", 1, "each", "Verify bound to aircraft and hardware calibration performed."),
    item("fv1-horus-protection", "Horus protection printed piece", "Control", 1),
    item("fv1-horus-batteries", "Horus LiPo batteries Gens Ace 2200", "Control", 2, "each", "One battery disconnected in the radio."),
    item("fv1-rigid-props-cw", "Rigid props in felt bags - clockwise", "Props", 4),
    item("fv1-rigid-props-ccw", "Rigid props in felt bags - counter-clockwise", "Props", 4),
    item("fv1-desiccant", "Desiccant packet", "Environmental", 1),
    item("fv1-fpv-monitor", "FPV monitor - check by power on", "FPV", 1),
    item("fv1-fpv-internal-battery", "Internal FPV monitor battery installed", "FPV", 1),
    item("fv1-fpv-antennas", "FPV monitor SMA black mushroom antennas", "FPV", 3),
    item("fv1-fpv-adapter", "FPV monitor AC adapter 12V 2A and adapter cable", "FPV", 1, "each", "Check by charging."),
    item("fv1-spare-battery-strap", "Spare battery straps - inspect for damage", "Spare Parts", 2),
    item("fv1-velcro-strap", "Velcro strap for battery", "Spare Parts", 1),
    item("fv1-spare-fpv-transmitter", "Spare FPV transmitter with epoxied antenna and heatsink", "Spare Parts", 1),
    item("fv1-spare-tbs", "Spare TBS receiver - hot glue present", "Spare Parts", 1),
    item("fv1-radio-charge-adapter", "Spare radio battery charge adapter", "Spare Parts", 1),
    item("fv1-lobster-tool", "Fabulous Lobster 13790-A", "Spare Parts", 1),
    item("fv1-prop-clearance-tool", "Prop clearance tool", "Spare Parts", 1),
    item("fv1-spare-rid-antenna", "Spare RID antenna", "Spare Parts", 1),
    item("fv1-rigid-prop-adapters", "Rigid prop adapters and M3x12mm patched screws", "Spare Hardware", 12, "adapters", "Includes 100 screws."),
    item("fv1-tpu-prop-adapters", "TPU prop adapters and M4x12mm BO patched screws", "Spare Hardware", 6, "adapters", "Includes 50 screws."),
  ]),

  foresightV2Aircraft: withOrder([
    item("fv2-refurb", "Foresight refurbishment procedure complete", "Preflight", 1, "signoff", "Lens cap on and battery plate included."),
    item("fv2-aircraft-system", "Foresight V2 inspection system with inspection runtime", "Aircraft", 1),
    item("fv2-aircraft-beakon", "Aircraft Beakon paired to ForeSight unit", "Tracking", 1),
    item("fv2-horus", "FrSky Horus with transmitter module", "Control", 1, "each", "Verify bound to aircraft and hardware calibration performed."),
    item("fv2-horus-batteries", "Horus LiPo batteries Gens Ace 2200", "Control", 2, "each", "One battery disconnected in the radio."),
    item("fv2-rigid-props-cw", "Rigid props in felt bags - clockwise", "Props", 4),
    item("fv2-rigid-props-ccw", "Rigid props in felt bags - counter-clockwise", "Props", 4),
    item("fv2-desiccant", "Desiccant packet", "Environmental", 1),
    item("fv2-fpv-monitor", "FPV monitor - check by power on", "FPV", 1),
    item("fv2-fpv-internal-battery", "Internal FPV monitor battery installed", "FPV", 1),
    item("fv2-fpv-antennas", "FPV monitor SMA black mushroom antennas", "FPV", 2),
    item("fv2-fpv-adapter", "FPV monitor AC adapter 12V 2A and cable", "FPV", 1, "each", "Check by charging."),
    item("fv2-spare-battery-strap", "Spare Velcro battery straps", "Spare Parts", 2),
    item("fv2-spare-fpv-antenna", "Spare FPV monitor SMA antenna RHCP", "Spare Parts", 1),
    item("fv2-spare-fpv-transmitter", "Spare FPV transmitter with epoxied antenna and heatsink", "Spare Parts", 1),
    item("fv2-fpv-clamp-bar", "FPV clamp bar", "Spare Parts", 1),
    item("fv2-spare-tbs", "Spare TBS receiver - hot glue present and dovetail for B2", "Spare Parts", 1),
    item("fv2-radio-charge-adapter", "Spare radio battery charge adapter", "Spare Parts", 1),
    item("fv2-lobster-tool", "Fabulous Lobster 13790-A Horus switch nut tool", "Spare Parts", 1),
    item("fv2-rigid-prop-adapters", "Rigid prop adapters and M3x12mm screws", "Spare Hardware", 12, "adapters", "Four packs, includes 100 screws."),
    item("fv2-tpu-prop-adapters", "TPU prop adapters and M4x12mm BO patched screws", "Spare Hardware", 6, "adapters", "Includes 50 screws."),
    item("fv2-landing-onshore", "Landing gear struts - onshore shorter", "Landing Gear", 4),
    item("fv2-landing-offshore", "Landing gear struts - offshore longer", "Landing Gear", 4),
    item("fv2-arm-locks", "Arm locks", "Airframe", 2),
    item("fv2-offshore-inflator", "Offshore inflator mount without CO2 cartridges and salt bobbins", "Offshore Kit", 2),
    item("fv2-tipover-clamps", "Left/right tipover clamps and jig", "Airframe", 2),
  ]),

  foresightBattery: withOrder([
    item("fs-battery-1", "ForeSight flight battery slot 1", "Batteries", 1, "battery", "Verify serial, no swelling, storage charge 45-60%."),
    item("fs-battery-2", "ForeSight flight battery slot 2", "Batteries", 1, "battery", "Verify serial, no swelling, storage charge 45-60%."),
    item("fs-battery-3", "ForeSight flight battery slot 3", "Batteries", 1, "battery", "Verify serial, no swelling, storage charge 45-60%."),
    item("fs-battery-4", "ForeSight flight battery slot 4", "Batteries", 1, "battery", "Verify serial, no swelling, storage charge 45-60%."),
    item("fs-battery-lipo-bag", "Battery LiPo containment bag", "Safety", 1),
    item("fs-battery-desiccant", "Desiccant packet - battery case", "Environmental", 1),
    item("fs-battery-terminal-covers", "Terminal covers", "Safety", 4),
    item("fs-battery-charge-log", "Battery charge log card", "Documentation", 1),
  ]),

  foresightCharger: withOrder([
    item("fs-charger-main", "ForeSight battery charger", "Power", 1, "charger", "Power on and verify all charge bays."),
    item("fs-charger-ac-cable", "AC wall power cable", "Power", 1),
    item("fs-charger-dc-cable", "DC field power cable", "Power", 1),
    item("fs-charger-balance-leads", "Balance lead set", "Power", 4),
    item("fs-charger-spare-fuses", "Spare charger fuses", "Spares", 4),
    item("fs-charger-thermal-bag", "Thermal-safe charging bag", "Safety", 1),
    item("fs-charger-quick-guide", "Charging quick reference card", "Documentation", 1),
  ]),

  skycrawlerRover: withOrder([
    item("sc-refurb", "SkyCrawler refurbishment procedure complete", "Preflight", 1, "signoff", "Tracks tensioned, camera mast locked, payload bay clean."),
    item("sc-rover-system", "SkyCrawler rover inspection system", "Rover", 1),
    item("sc-rover-beakon", "Rover Beakon paired to SkyCrawler unit", "Tracking", 1),
    item("sc-controller", "SkyCrawler handheld controller", "Control", 1, "each", "Verify controller is bound to rover."),
    item("sc-controller-battery", "Controller battery", "Control", 2),
    item("sc-camera-mast", "Camera mast and gimbal assembly", "Payload", 1),
    item("sc-spare-track-left", "Spare left crawler track", "Mobility", 1),
    item("sc-spare-track-right", "Spare right crawler track", "Mobility", 1),
    item("sc-track-pins", "Crawler track pin kit", "Mobility", 1, "kit"),
    item("sc-tether", "Recovery tether and carabiner", "Recovery", 1),
    item("sc-field-tablet", "Rugged field tablet with SCAN profile", "Control", 1),
    item("sc-desiccant", "Desiccant packet", "Environmental", 1),
  ]),

  skycrawlerSupport: withOrder([
    item("sc-support-charger", "SkyCrawler multi-bay charger", "Power", 1, "charger", "Power on and verify all bays."),
    item("sc-support-ac-cable", "AC wall power cable", "Power", 1),
    item("sc-support-dc-inverter", "300W DC inverter", "Power", 1),
    item("sc-support-ethernet", "Ethernet cable", "Connectivity", 2),
    item("sc-support-usb-ethernet", "USB-A Ethernet adapter", "Connectivity", 1),
    item("sc-support-lens-wipes", "Lens wipes", "Optics", 4),
    item("sc-support-microfiber", "Microfiber cloth", "Optics", 1),
    item("sc-support-tool-roll", "SkyCrawler tool roll", "Tools", 1),
    item("sc-support-hex-drivers", "Hex driver set 1.5mm-3.0mm", "Tools", 1, "set"),
    item("sc-support-pliers", "Standard pliers", "Tools", 1),
    item("sc-support-snips", "Snips", "Tools", 1),
    item("sc-support-zip-ties", "Zip ties", "Repair Items", 24),
    item("sc-support-vhb", "VHB strips", "Repair Items", 3),
    item("sc-support-loctite", "Closed Loctite capsule package", "Repair Items", 1),
    item("sc-support-first-aid", "First aid kit", "Safety", 1),
    item("sc-support-fire-blanket", "Fire blanket", "Safety", 1),
    item("sc-support-log-card", "Rover field service log card", "Documentation", 1),
  ]),

  skycrawlerBattery: withOrder([
    item("sc-battery-1", "SkyCrawler traction battery slot 1", "Batteries", 1, "battery", "Verify serial, no swelling, storage charge 45-60%."),
    item("sc-battery-2", "SkyCrawler traction battery slot 2", "Batteries", 1, "battery", "Verify serial, no swelling, storage charge 45-60%."),
    item("sc-battery-3", "SkyCrawler traction battery slot 3", "Batteries", 1, "battery", "Verify serial, no swelling, storage charge 45-60%."),
    item("sc-battery-4", "SkyCrawler traction battery slot 4", "Batteries", 1, "battery", "Verify serial, no swelling, storage charge 45-60%."),
    item("sc-battery-lipo-bag", "Battery containment bag", "Safety", 1),
    item("sc-battery-terminal-covers", "Terminal covers", "Safety", 4),
    item("sc-battery-charge-log", "Battery charge log card", "Documentation", 1),
  ]),
};

const TEMPLATE_DEFS: Array<{
  key: TemplateKey;
  name: string;
  description: string;
}> = [
  {
    key: "foresightGsc",
    name: "ForeSight Ground Support Case",
    description: "Ground Support Case packing list sourced from the Alicia hangar checklist. Used for ForeSight field operations, RTK setup, tools, spares, power, and safety equipment.",
  },
  {
    key: "foresightV1Aircraft",
    name: "ForeSight V1 Aircraft Case",
    description: "ForeSight V1 aircraft case sourced from the current packing checklist, including aircraft, Horus controller, FPV monitor, props, spares, and the unit's paired Beakon.",
  },
  {
    key: "foresightV2Aircraft",
    name: "ForeSight V2 Aircraft Case",
    description: "ForeSight V2 aircraft case sourced from the current packing checklist, including offshore/onshore hardware, FPV components, spares, and the unit's paired Beakon.",
  },
  {
    key: "foresightBattery",
    name: "ForeSight Battery Case",
    description: "ForeSight battery transport case. Each physical case contains exactly four batteries plus safety and charge documentation items.",
  },
  {
    key: "foresightCharger",
    name: "ForeSight Charger Case",
    description: "ForeSight charging support case for charger, power cables, balance leads, fuses, and safety documentation.",
  },
  {
    key: "skycrawlerRover",
    name: "SkyCrawler Rover Case",
    description: "Provisional seed/demo template for a SkyCrawler ground crawler case, including the rover, controller, mobility spares, payload, and always-associated Beakon.",
  },
  {
    key: "skycrawlerSupport",
    name: "SkyCrawler Support Case",
    description: "Provisional seed/demo support case for SkyCrawler field operations, including charger, tools, cables, repair items, and safety gear.",
  },
  {
    key: "skycrawlerBattery",
    name: "SkyCrawler Battery Case",
    description: "Provisional seed/demo SkyCrawler battery transport case. Each physical case contains exactly four traction batteries plus safety documentation.",
  },
];

const SITES: Site[] = [
  {
    key: "ann-arbor-staging",
    name: "Ann Arbor Hangar Staging",
    lat: HQ.lat,
    lng: HQ.lng,
    missionName: "ForeSight FS-101 Hangar Assembly",
    description: "Hangar staff assemble, QC, and stage a complete ForeSight V1 shipment before outbound release.",
    status: "planning",
    lead: USERS.hangarLead,
    siteCode: "AAS",
  },
  {
    key: "lake-michigan",
    name: "Lake Michigan Offshore Site",
    lat: 43.2340,
    lng: -86.2506,
    missionName: "ForeSight FS-102 Outbound Deployment",
    description: "ForeSight V2 kit moving from the Ann Arbor hangar to an offshore inspection team via FedEx.",
    status: "active",
    lead: USERS.pilotMarc,
    siteCode: "LMO",
  },
  {
    key: "illinois-prairie",
    name: "Illinois Prairie Wind Farm",
    lat: 40.4842,
    lng: -88.9937,
    missionName: "ForeSight FS-103 Field Operations",
    description: "ForeSight V2 kit checked out by a pilot and operating on a multi-week turbine inspection route.",
    status: "active",
    lead: USERS.pilotEmma,
    siteCode: "IPW",
  },
  {
    key: "indiana-hoosier",
    name: "Indiana Hoosier Wind Farm",
    lat: 40.4864,
    lng: -86.1336,
    missionName: "SkyCrawler SC-201 Handoff Deployment",
    description: "SkyCrawler kit transferred by handoff to a field technician for ground-based crawl inspection.",
    status: "active",
    lead: USERS.techRaj,
    siteCode: "IHW",
  },
  {
    key: "ohio-emergency",
    name: "Ohio Emergency Repair Site",
    lat: 41.4489,
    lng: -82.7079,
    missionName: "SkyCrawler SC-202 Incident Return",
    description: "SkyCrawler kit with a damaged left tread and return workflow initiated after a field incident.",
    status: "active",
    lead: USERS.techJames,
    siteCode: "OER",
  },
  {
    key: "upper-michigan",
    name: "Upper Michigan Legacy Fleet",
    lat: 46.5436,
    lng: -87.3954,
    missionName: "SkyCrawler SC-203 Refurb Intake",
    description: "SkyCrawler kit received back at the hangar and routed for refurb, firmware updates, and battery refresh.",
    status: "completed",
    lead: USERS.maintNia,
    siteCode: "UML",
  },
];

function fsBatterySerials(unitId: string, caseLetter: string): string[] {
  return [1, 2, 3, 4].map((n) => `${unitId}-BAT-${caseLetter}${n}`);
}

function scBatterySerials(unitId: string, caseLetter: string): string[] {
  return [1, 2, 3, 4].map((n) => `${unitId}-TRAC-${caseLetter}${n}`);
}

const SCENARIOS: Scenario[] = [
  {
    unitId: "FS-101",
    platform: "ForeSight",
    version: "V1",
    beakon: "BK-4101",
    nickname: "Lakefly",
    faaRegistration: "N101FS",
    serialNumber: "FSV1-2024-101",
    missionKey: "ann-arbor-staging",
    custodian: USERS.logistics,
    routeReason: "Ready for pilot assignment",
    narrative: "Complete ForeSight V1 kit assembled by hangar staff and waiting for outbound release.",
    cases: [
      { suffix: "GSC", displayName: "Ground Support Case", templateKey: "foresightGsc", status: "assembled" },
      { suffix: "AC", displayName: "ForeSight V1 Aircraft Case", templateKey: "foresightV1Aircraft", status: "assembled" },
      { suffix: "CHG", displayName: "ForeSight Charger Case", templateKey: "foresightCharger", status: "assembled" },
      { suffix: "BAT-A", displayName: "ForeSight Battery Case A", templateKey: "foresightBattery", status: "assembled", batterySerials: fsBatterySerials("FS-101", "A") },
      { suffix: "BAT-B", displayName: "ForeSight Battery Case B", templateKey: "foresightBattery", status: "assembled", batterySerials: fsBatterySerials("FS-101", "B") },
    ],
  },
  {
    unitId: "FS-102",
    platform: "ForeSight",
    version: "V2",
    beakon: "BK-4102",
    nickname: "Breakwater",
    faaRegistration: "N102FS",
    serialNumber: "FSV2-2025-102",
    missionKey: "lake-michigan",
    custodian: USERS.pilotMarc,
    routeReason: "Outbound deployment to offshore pilot",
    narrative: "Complete ForeSight V2 kit shipped by FedEx from hangar to pilot for offshore work.",
    cases: [
      { suffix: "GSC", displayName: "Ground Support Case", templateKey: "foresightGsc", status: "transit_out", shippingDirection: "outbound", shipmentStatus: "in_transit" },
      { suffix: "AC", displayName: "ForeSight V2 Aircraft Case", templateKey: "foresightV2Aircraft", status: "transit_out", shippingDirection: "outbound", shipmentStatus: "out_for_delivery" },
      { suffix: "CHG", displayName: "ForeSight Charger Case", templateKey: "foresightCharger", status: "transit_out", shippingDirection: "outbound", shipmentStatus: "in_transit" },
      { suffix: "BAT-A", displayName: "ForeSight Battery Case A", templateKey: "foresightBattery", status: "transit_out", batterySerials: fsBatterySerials("FS-102", "A"), shippingDirection: "outbound", shipmentStatus: "picked_up" },
      { suffix: "BAT-B", displayName: "ForeSight Battery Case B", templateKey: "foresightBattery", status: "transit_out", batterySerials: fsBatterySerials("FS-102", "B"), shippingDirection: "outbound", shipmentStatus: "in_transit" },
      { suffix: "BAT-C", displayName: "ForeSight Battery Case C", templateKey: "foresightBattery", status: "transit_out", batterySerials: fsBatterySerials("FS-102", "C"), shippingDirection: "outbound", shipmentStatus: "in_transit" },
    ],
  },
  {
    unitId: "FS-103",
    platform: "ForeSight",
    version: "V2",
    beakon: "BK-4103",
    nickname: "Prairie Hawk",
    faaRegistration: "N103FS",
    serialNumber: "FSV2-2025-103",
    missionKey: "illinois-prairie",
    custodian: USERS.pilotEmma,
    routeReason: "Active field assignment",
    narrative: "ForeSight V2 kit has arrived, been checked out, and has one minor condition note for the next pilot.",
    cases: [
      { suffix: "GSC", displayName: "Ground Support Case", templateKey: "foresightGsc", status: "deployed" },
      { suffix: "AC", displayName: "ForeSight V2 Aircraft Case", templateKey: "foresightV2Aircraft", status: "deployed", issueTemplateItemIds: ["fv2-fpv-antennas"], notes: "One FPV antenna cap is cracked but antenna tested functional." },
      { suffix: "CHG", displayName: "ForeSight Charger Case", templateKey: "foresightCharger", status: "deployed" },
      { suffix: "BAT-A", displayName: "ForeSight Battery Case A", templateKey: "foresightBattery", status: "deployed", batterySerials: fsBatterySerials("FS-103", "A") },
      { suffix: "BAT-B", displayName: "ForeSight Battery Case B", templateKey: "foresightBattery", status: "deployed", batterySerials: fsBatterySerials("FS-103", "B") },
    ],
  },
  {
    unitId: "SC-201",
    platform: "SkyCrawler",
    beakon: "BK-5201",
    nickname: "Crawler Seven",
    serialNumber: "SC-2025-201",
    missionKey: "indiana-hoosier",
    custodian: USERS.techRaj,
    routeReason: "Handoff to field technician",
    narrative: "SkyCrawler kit transferred by handoff and checked out by the receiving technician.",
    cases: [
      { suffix: "ROVER", displayName: "SkyCrawler Rover Case", templateKey: "skycrawlerRover", status: "deployed" },
      { suffix: "SUP", displayName: "SkyCrawler Support Case", templateKey: "skycrawlerSupport", status: "deployed" },
      { suffix: "BAT-A", displayName: "SkyCrawler Battery Case A", templateKey: "skycrawlerBattery", status: "deployed", batterySerials: scBatterySerials("SC-201", "A") },
      { suffix: "BAT-B", displayName: "SkyCrawler Battery Case B", templateKey: "skycrawlerBattery", status: "deployed", batterySerials: scBatterySerials("SC-201", "B") },
    ],
  },
  {
    unitId: "SC-202",
    platform: "SkyCrawler",
    beakon: "BK-5202",
    nickname: "Gravel Runner",
    serialNumber: "SC-2025-202",
    missionKey: "ohio-emergency",
    custodian: USERS.techJames,
    routeReason: "Incident return after tread damage",
    narrative: "SkyCrawler rover has a damaged left tread. Support and battery cases are already returning to hangar.",
    cases: [
      { suffix: "ROVER", displayName: "SkyCrawler Rover Case", templateKey: "skycrawlerRover", status: "flagged", issueTemplateItemIds: ["sc-spare-track-left", "sc-rover-system"], notes: "Left tread damaged after gravel impact; rover should not be redeployed until repaired." },
      { suffix: "SUP", displayName: "SkyCrawler Support Case", templateKey: "skycrawlerSupport", status: "transit_in", shippingDirection: "return", shipmentStatus: "in_transit" },
      { suffix: "BAT-A", displayName: "SkyCrawler Battery Case A", templateKey: "skycrawlerBattery", status: "transit_in", batterySerials: scBatterySerials("SC-202", "A"), shippingDirection: "return", shipmentStatus: "out_for_delivery" },
      { suffix: "BAT-B", displayName: "SkyCrawler Battery Case B", templateKey: "skycrawlerBattery", status: "transit_in", batterySerials: scBatterySerials("SC-202", "B"), shippingDirection: "return", shipmentStatus: "in_transit" },
    ],
  },
  {
    unitId: "SC-203",
    platform: "SkyCrawler",
    beakon: "BK-5203",
    nickname: "Northline",
    serialNumber: "SC-2025-203",
    missionKey: "upper-michigan",
    custodian: USERS.maintNia,
    routeReason: "Maintenance, refurb, and firmware upgrade",
    narrative: "SkyCrawler kit has been received back at hangar and routed for refurb after a completed assignment.",
    cases: [
      { suffix: "ROVER", displayName: "SkyCrawler Rover Case", templateKey: "skycrawlerRover", status: "received", notes: "Received for refurb. Firmware update and camera mast inspection requested." },
      { suffix: "SUP", displayName: "SkyCrawler Support Case", templateKey: "skycrawlerSupport", status: "received" },
      { suffix: "BAT-A", displayName: "SkyCrawler Battery Case A", templateKey: "skycrawlerBattery", status: "received", batterySerials: scBatterySerials("SC-203", "A") },
      { suffix: "BAT-B", displayName: "SkyCrawler Battery Case B", templateKey: "skycrawlerBattery", status: "received", batterySerials: scBatterySerials("SC-203", "B") },
    ],
  },
];

function siteByKey(key: string): Site {
  const site = SITES.find((s) => s.key === key);
  if (!site) throw new Error(`Missing seed site ${key}`);
  return site;
}

function trackingFor(index: number): string {
  return FEDEX_TRACKING_NUMBERS[index % FEDEX_TRACKING_NUMBERS.length];
}

function unitDisplayName(scenario: Scenario): string {
  const nickname = scenario.nickname ? ` "${scenario.nickname}"` : "";
  const registration = scenario.faaRegistration ? ` (${scenario.faaRegistration})` : "";
  return `${scenario.unitId}${nickname}${registration}`;
}

function caseLocation(spec: CaseSpec, site: Site, index: number) {
  if (spec.status === "assembled" || spec.status === "hangar") {
    return {
      lat: offset(HQ.lat, index % 5, 0.0012),
      lng: offset(HQ.lng, index % 5, 0.0012),
      locationName: `${HQ.name} - Staging Bay ${1 + (index % 4)}`,
    };
  }

  if (spec.status === "received") {
    return {
      lat: offset(HQ.lat, index % 5, 0.001),
      lng: offset(HQ.lng, index % 5, 0.001),
      locationName: `${HQ.name} - Receiving Dock`,
    };
  }

  if (spec.status === "transit_out") {
    return {
      lat: HQ.lat + (site.lat - HQ.lat) * 0.55 + (index % 3) * 0.05,
      lng: HQ.lng + (site.lng - HQ.lng) * 0.55 - (index % 3) * 0.05,
      locationName: "In Transit - FedEx outbound network",
    };
  }

  if (spec.status === "transit_in") {
    return {
      lat: HQ.lat + (site.lat - HQ.lat) * 0.45 - (index % 3) * 0.04,
      lng: HQ.lng + (site.lng - HQ.lng) * 0.45 + (index % 3) * 0.04,
      locationName: "In Transit - FedEx return network",
    };
  }

  return {
    lat: offset(site.lat, index % 5, 0.007),
    lng: offset(site.lng, index % 5, 0.009),
    locationName: site.name,
  };
}

function materializeManifestName(itemDef: TemplateItem, scenario: Scenario, spec: CaseSpec): string {
  const id = itemDef.id;
  if (id === "fv1-aircraft-system" || id === "fv2-aircraft-system") {
    return `${scenario.unitId} ForeSight ${scenario.version} inspection system`;
  }
  if (id === "fv1-aircraft-beakon" || id === "fv2-aircraft-beakon") {
    return `${scenario.beakon} Beakon paired with ${scenario.unitId}`;
  }
  if (id === "gsc-rtk-beakon") {
    return `${scenario.beakon}-RTK RTK Beakon assigned to ${scenario.unitId} kit`;
  }
  if (id === "sc-rover-system") {
    return `${scenario.unitId} SkyCrawler rover inspection system`;
  }
  if (id === "sc-rover-beakon") {
    return `${scenario.beakon} Beakon paired with ${scenario.unitId}`;
  }
  const batteryIndex = ["fs-battery-1", "fs-battery-2", "fs-battery-3", "fs-battery-4", "sc-battery-1", "sc-battery-2", "sc-battery-3", "sc-battery-4"].indexOf(id);
  if (batteryIndex >= 0 && spec.batterySerials?.[batteryIndex % 4]) {
    return `${spec.batterySerials[batteryIndex % 4]} ${itemDef.name}`;
  }
  if (id === "fs-charger-main") {
    return `${scenario.unitId}-CHG-01 ForeSight battery charger`;
  }
  if (id === "sc-support-charger") {
    return `${scenario.unitId}-CHG-01 SkyCrawler multi-bay charger`;
  }
  return itemDef.name;
}

function manifestStatusFor(itemDef: TemplateItem, scenario: Scenario, spec: CaseSpec): ManifestStatus {
  if (spec.status === "hangar") return "unchecked";
  if (spec.issueTemplateItemIds?.includes(itemDef.id)) return "damaged";
  if (scenario.unitId === "FS-103" && itemDef.id === "fv2-fpv-antennas") return "damaged";
  if (scenario.unitId === "SC-203" && itemDef.id === "sc-camera-mast") return "damaged";
  return "ok";
}

function manifestNotesFor(itemDef: TemplateItem, scenario: Scenario, spec: CaseSpec, status: ManifestStatus): string | undefined {
  if (itemDef.id === "fv1-aircraft-beakon" || itemDef.id === "fv2-aircraft-beakon" || itemDef.id === "sc-rover-beakon") {
    return `Permanent association: ${scenario.beakon} remains paired with ${scenario.unitId}.`;
  }
  if (itemDef.id === "gsc-rtk-beakon") {
    return `RTK Beakon recorded during QC for ${scenario.unitId}.`;
  }
  if (spec.batterySerials && itemDef.id.includes("battery-")) {
    return "Serial verified, terminals covered, no swelling observed.";
  }
  if (status === "damaged" && scenario.unitId === "FS-103") {
    return "Antenna cap cracked; RF check passed. Next pilot should monitor during setup.";
  }
  if (status === "damaged" && scenario.unitId === "SC-202") {
    return "Incident return: left tread damage documented before shipment to hangar.";
  }
  if (status === "damaged" && scenario.unitId === "SC-203") {
    return "Camera mast has excess play; refurb ticket opened.";
  }
  return itemDef.notes;
}

function inspectionStatusFor(caseStatus: CaseStatus, damagedItems: number, checkedItems: number, totalItems: number): InspectionStatus {
  if (caseStatus === "flagged" || damagedItems > 0) return "flagged";
  if (caseStatus === "transit_out" || caseStatus === "transit_in") return "pending";
  if (checkedItems < totalItems) return "in_progress";
  return "completed";
}

function scanContextFor(scanType: ScanType): string {
  return scanType;
}

export const seedDatabase = internalMutation({
  args: {
    clearExisting: v.optional(v.boolean()),
  },

  handler: async (ctx, args) => {
    const now = Date.now();
    const stats: Record<string, number> = {};

    if (args.clearExisting) {
      const tables = [
        "featureFlags",
        "caseTemplates",
        "units",
        "outboundShipments",
        "missions",
        "turbines",
        "cases",
        "manifestItems",
        "inspections",
        "shipments",
        "shipping_updates",
        "events",
        "custodyRecords",
        "custody_handoffs",
        "scans",
        "scan_events",
        "checklist_updates",
        "damage_reports",
        "notifications",
      ] as const;

      for (const table of tables) {
        const rows = await ctx.db.query(table).collect();
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      }
    }

    const flags = [
      { key: "FF_AUDIT_HASH_CHAIN", enabled: true, description: "Hash-chain tamper detection on T5 audit panel" },
      { key: "FF_MAP_MISSION", enabled: true, description: "M5 Mission Control map mode" },
      { key: "FF_INV_REDESIGN", enabled: true, description: "INVENTORY redesign UI" },
    ];

    for (const flag of flags) {
      await ctx.db.insert("featureFlags", { ...flag, updatedAt: now });
    }
    stats.featureFlags = flags.length;

    const templateIds = {} as Record<TemplateKey, Id<"caseTemplates">>;
    for (const template of TEMPLATE_DEFS) {
      templateIds[template.key] = await ctx.db.insert("caseTemplates", {
        name: template.name,
        description: template.description,
        isActive: true,
        items: TEMPLATE_ITEMS[template.key],
        createdAt: daysAgo(now, 120),
        updatedAt: daysAgo(now, 1),
      });
    }
    stats.caseTemplates = TEMPLATE_DEFS.length;

    const missionIds = new Map<string, Id<"missions">>();
    for (const site of SITES) {
      const missionId = await ctx.db.insert("missions", {
        name: site.missionName,
        description: site.description,
        status: site.status,
        lat: site.lat,
        lng: site.lng,
        locationName: site.name,
        startDate: site.status === "planning" ? daysFromNow(now, 10) : daysAgo(now, 20),
        endDate: site.status === "completed" ? daysAgo(now, 2) : daysFromNow(now, 30),
        leadId: site.lead.id,
        leadName: site.lead.name,
        createdAt: daysAgo(now, 45),
        updatedAt: daysAgo(now, site.status === "completed" ? 2 : 1),
      });
      missionIds.set(site.key, missionId);
    }
    stats.missions = missionIds.size;

    const unitIds = new Map<string, Id<"units">>();
    for (const scenario of SCENARIOS) {
      const missionId = missionIds.get(scenario.missionKey);
      const unitId = await ctx.db.insert("units", {
        unitId: scenario.unitId,
        assetType: scenario.platform === "ForeSight" ? "aircraft" : "rover",
        platform: scenario.platform,
        version: scenario.version,
        nickname: scenario.nickname,
        faaRegistration: scenario.faaRegistration,
        pairedBeakon: scenario.beakon,
        serialNumber: scenario.serialNumber,
        homeBase: HQ.name,
        currentMissionId: missionId,
        notes: scenario.narrative,
        createdAt: daysAgo(now, 120),
        updatedAt: daysAgo(now, 1),
      });
      unitIds.set(scenario.unitId, unitId);
    }
    stats.units = unitIds.size;

    let turbineCount = 0;
    for (const site of SITES.filter((s) => s.key !== "ann-arbor-staging")) {
      for (let i = 1; i <= 4; i++) {
        await ctx.db.insert("turbines", {
          name: `${site.siteCode}-T${String(i).padStart(3, "0")}`,
          lat: offset(site.lat, i, 0.012),
          lng: offset(site.lng, i, 0.014),
          missionId: missionIds.get(site.key),
          siteCode: site.siteCode,
          status: site.status === "completed" ? "inactive" : "active",
          hubHeight: 85 + i * 4,
          rotorDiameter: 118 + i * 3,
          createdAt: daysAgo(now, 180),
          updatedAt: daysAgo(now, i),
        });
        turbineCount++;
      }
    }
    stats.turbines = turbineCount;

    const seededCases: SeededCase[] = [];
    let caseIndex = 0;

    for (const scenario of SCENARIOS) {
      const site = siteByKey(scenario.missionKey);
      const missionId = missionIds.get(site.key);
      if (!missionId) throw new Error(`Missing mission for ${site.key}`);
      const unitId = unitIds.get(scenario.unitId);
      if (!unitId) throw new Error(`Missing unit for ${scenario.unitId}`);

      for (const spec of scenario.cases) {
        caseIndex++;
        const label = `${scenario.unitId}-${spec.suffix}`;
        const qrCode = `SCAN:${label}:${scenario.beakon}`;
        const location = caseLocation(spec, site, caseIndex);
        const trackingNumber = spec.shippingDirection ? trackingFor(caseIndex) : undefined;
        const destinationName = spec.shippingDirection === "outbound" ? site.name : HQ.name;
        const destinationLat = spec.shippingDirection === "outbound" ? site.lat : HQ.lat;
        const destinationLng = spec.shippingDirection === "outbound" ? site.lng : HQ.lng;

        const caseId = await ctx.db.insert("cases", {
          label,
          qrCode,
          qrCodeSource: "generated",
          status: spec.status,
          templateId: templateIds[spec.templateKey],
          missionId,
          unitId,
          lat: location.lat,
          lng: location.lng,
          locationName: location.locationName,
          assigneeId: scenario.custodian.id,
          assigneeName: scenario.custodian.name,
          trackingNumber,
          carrier: trackingNumber ? "FedEx" : undefined,
          shippedAt: trackingNumber ? daysAgo(now, spec.shippingDirection === "outbound" ? 2 : 1) : undefined,
          destinationName,
          destinationLat,
          destinationLng,
          carrierStatus: spec.shipmentStatus,
          estimatedDelivery: spec.shippingDirection ? isoDate(daysFromNow(now, spec.shippingDirection === "outbound" ? 2 : 1)) : undefined,
          lastCarrierEvent: spec.shipmentStatus
            ? {
                timestamp: new Date(daysAgo(now, 1)).toISOString(),
                eventType: spec.shipmentStatus === "out_for_delivery" ? "OD" : "IT",
                description: spec.shipmentStatus === "out_for_delivery" ? "Out for delivery" : "In transit",
                location: { city: spec.shippingDirection === "outbound" ? "Toledo" : "Ann Arbor", state: "MI", country: "US" },
              }
            : undefined,
          qcSignOffStatus: spec.status === "flagged" ? "rejected" : "approved",
          qcSignedOffBy: spec.status === "flagged" ? USERS.qc.id : USERS.hangarLead.id,
          qcSignedOffByName: spec.status === "flagged" ? USERS.qc.name : USERS.hangarLead.name,
          qcSignedOffAt: daysAgo(now, spec.status === "received" ? 12 : 4),
          qcSignOffNotes: spec.status === "flagged" ? "Rejected for return workflow after field incident." : "QC1/QC2 checklist complete; case contents verified.",
          notes: [scenario.narrative, spec.notes].filter(Boolean).join(" "),
          createdAt: daysAgo(now, 35 + caseIndex),
          updatedAt: daysAgo(now, spec.status === "received" ? 2 : 1),
        });

        seededCases.push({ id: caseId, scenario, spec, label, qrCode, status: spec.status, missionId, site, assignee: scenario.custodian });
      }
    }
    stats.cases = seededCases.length;

    const outboundShipmentScenarios = [
      { unitId: "FS-101", status: "draft" as const, releasedAt: undefined },
      { unitId: "FS-102", status: "released" as const, releasedAt: daysAgo(now, 2) },
    ];
    let outboundShipmentCount = 0;
    let outboundShipmentEventCount = 0;

    for (const bundle of outboundShipmentScenarios) {
      const scenario = SCENARIOS.find((item) => item.unitId === bundle.unitId);
      if (!scenario) continue;

      const unitId = unitIds.get(scenario.unitId);
      const site = siteByKey(scenario.missionKey);
      const missionId = missionIds.get(site.key);
      if (!unitId || !missionId) continue;

      const bundleCases = seededCases
        .filter((seededCase) => seededCase.scenario.unitId === scenario.unitId)
        .map((seededCase) => seededCase.id);

      const outboundShipmentId = await ctx.db.insert("outboundShipments", {
        unitId,
        displayName: unitDisplayName(scenario),
        status: bundle.status,
        originName: HQ.name,
        destinationMissionId: missionId,
        destinationName: site.name,
        destinationLat: site.lat,
        destinationLng: site.lng,
        recipientUserId: scenario.custodian.id,
        recipientName: scenario.custodian.name,
        caseIds: bundleCases,
        routeReason: scenario.routeReason,
        notes: scenario.narrative,
        createdBy: USERS.hangarLead.id,
        createdByName: USERS.hangarLead.name,
        releasedAt: bundle.releasedAt,
        createdAt: daysAgo(now, bundle.status === "draft" ? 1 : 3),
        updatedAt: daysAgo(now, bundle.status === "draft" ? 1 : 2),
      });
      outboundShipmentCount++;

      for (const seededCase of seededCases.filter((item) => item.scenario.unitId === scenario.unitId)) {
        await ctx.db.insert("events", {
          caseId: seededCase.id,
          eventType: bundle.status === "released" ? "shipment_released" : "shipment_created",
          userId: USERS.hangarLead.id,
          userName: USERS.hangarLead.name,
          timestamp: bundle.status === "released" ? daysAgo(now, 2) : daysAgo(now, 1),
          data: {
            outboundShipmentId,
            displayName: unitDisplayName(scenario),
            routeReason: scenario.routeReason,
            caseLabel: seededCase.label,
          },
        });
        outboundShipmentEventCount++;
      }
    }
    stats.outboundShipments = outboundShipmentCount;

    const caseManifestMap = new Map<Id<"cases">, Map<string, Id<"manifestItems">>>();
    let manifestItemCount = 0;

    for (const seededCase of seededCases) {
      const itemMap = new Map<string, Id<"manifestItems">>();
      const items = TEMPLATE_ITEMS[seededCase.spec.templateKey];

      for (const itemDef of items) {
        const status = manifestStatusFor(itemDef, seededCase.scenario, seededCase.spec);
        const checked = status !== "unchecked";
        const manifestItemId = await ctx.db.insert("manifestItems", {
          caseId: seededCase.id,
          templateItemId: itemDef.id,
          name: materializeManifestName(itemDef, seededCase.scenario, seededCase.spec),
          status,
          notes: manifestNotesFor(itemDef, seededCase.scenario, seededCase.spec, status),
          photoStorageIds: status === "damaged" ? [`seed-photo-${seededCase.label}-${itemDef.id}`] : undefined,
          checkedAt: checked ? daysAgo(now, seededCase.status === "received" ? 4 : 1) : undefined,
          checkedById: checked ? seededCase.assignee.id : undefined,
          checkedByName: checked ? seededCase.assignee.name : undefined,
        });
        itemMap.set(itemDef.id, manifestItemId);
        manifestItemCount++;
      }

      caseManifestMap.set(seededCase.id, itemMap);
    }
    stats.manifestItems = manifestItemCount;

    const caseInspectionMap = new Map<Id<"cases">, Id<"inspections">>();
    let inspectionCount = 0;

    for (const seededCase of seededCases) {
      if (seededCase.status === "transit_out" || seededCase.status === "transit_in") continue;

      const itemMap = caseManifestMap.get(seededCase.id);
      if (!itemMap) continue;

      let checkedItems = 0;
      let damagedItems = 0;
      let missingItems = 0;

      for (const manifestId of itemMap.values()) {
        const row = await ctx.db.get(manifestId);
        if (!row) continue;
        if (row.status !== "unchecked") checkedItems++;
        if (row.status === "damaged") damagedItems++;
        if (row.status === "missing") missingItems++;
      }

      const totalItems = itemMap.size;
      const status = inspectionStatusFor(seededCase.status, damagedItems, checkedItems, totalItems);
      const inspectionId = await ctx.db.insert("inspections", {
        caseId: seededCase.id,
        inspectorId: seededCase.assignee.id,
        inspectorName: seededCase.assignee.name,
        status,
        startedAt: daysAgo(now, seededCase.status === "received" ? 7 : 2),
        completedAt: status === "completed" || status === "flagged" ? daysAgo(now, seededCase.status === "received" ? 6 : 1) : undefined,
        notes: status === "flagged" ? "Condition issue documented for next custodian and hangar review." : "Checklist completed in SCAN.",
        totalItems,
        checkedItems,
        damagedItems,
        missingItems,
      });
      caseInspectionMap.set(seededCase.id, inspectionId);
      inspectionCount++;
    }
    stats.inspections = inspectionCount;

    let shipmentCount = 0;
    let shippingUpdateCount = 0;

    for (const seededCase of seededCases) {
      const shouldCreateShipment =
        seededCase.spec.shippingDirection !== undefined || seededCase.status === "received" || seededCase.status === "deployed";
      if (!shouldCreateShipment) continue;

      const outbound = seededCase.spec.shippingDirection !== "return";
      const trackingNumber = seededCase.spec.shippingDirection ? trackingFor(shipmentCount) : trackingFor(shipmentCount + 7);
      const delivered = seededCase.status === "received" || seededCase.status === "deployed";
      const shipmentStatus: ShipmentStatus = delivered ? "delivered" : seededCase.spec.shipmentStatus ?? "in_transit";
      const origin = outbound ? HQ : seededCase.site;
      const destination = outbound ? seededCase.site : HQ;
      const shippedAt = delivered ? daysAgo(now, seededCase.status === "received" ? 12 : 8) : daysAgo(now, outbound ? 2 : 1);
      const deliveredAt = delivered ? daysAgo(now, seededCase.status === "received" ? 8 : 5) : undefined;

      await ctx.db.insert("shipments", {
        caseId: seededCase.id,
        trackingNumber,
        carrier: "FedEx",
        status: shipmentStatus,
        originLat: origin.lat,
        originLng: origin.lng,
        originName: origin.name,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        destinationName: destination.name,
        currentLat: delivered ? destination.lat : seededCase.site.lat + (HQ.lat - seededCase.site.lat) * 0.35,
        currentLng: delivered ? destination.lng : seededCase.site.lng + (HQ.lng - seededCase.site.lng) * 0.35,
        estimatedDelivery: isoDate(deliveredAt ?? daysFromNow(now, 2)),
        lastEvent: {
          timestamp: new Date(deliveredAt ?? daysAgo(now, 1)).toISOString(),
          eventType: delivered ? "DL" : shipmentStatus === "out_for_delivery" ? "OD" : "IT",
          description: delivered ? "Delivered" : shipmentStatus === "out_for_delivery" ? "Out for delivery" : "In transit",
          location: { city: delivered ? destination.name.split(" ")[0] : "Toledo", state: "MI", country: "US" },
        },
        shippedAt,
        deliveredAt,
        createdAt: shippedAt,
        updatedAt: deliveredAt ?? daysAgo(now, 1),
      });

      const updates: Array<{ status: ShipmentStatus; offsetDays: number; city: string; state: string; eventType: string; description: string }> = delivered
        ? [
            { status: "picked_up", offsetDays: 11, city: "Ann Arbor", state: "MI", eventType: "PU", description: "Picked up" },
            { status: "in_transit", offsetDays: 10, city: "Toledo", state: "OH", eventType: "IT", description: "In transit" },
            { status: "delivered", offsetDays: 8, city: destination.name.split(" ")[0], state: "MI", eventType: "DL", description: "Delivered" },
          ]
        : [
            { status: "picked_up", offsetDays: 2, city: "Ann Arbor", state: "MI", eventType: "PU", description: "Picked up" },
            { status: shipmentStatus, offsetDays: 1, city: "Toledo", state: "OH", eventType: "IT", description: shipmentStatus === "out_for_delivery" ? "Out for delivery" : "In transit" },
          ];

      for (const update of updates) {
        await ctx.db.insert("shipping_updates", {
          caseId: seededCase.id,
          fedexTrackingId: trackingNumber,
          status: update.status,
          timestamp: daysAgo(now, update.offsetDays),
          location: {
            city: update.city,
            state: update.state,
            country: "US",
            lat: delivered ? destination.lat : seededCase.site.lat,
            lng: delivered ? destination.lng : seededCase.site.lng,
          },
          eventType: update.eventType,
          description: update.description,
        });
        shippingUpdateCount++;
      }

      shipmentCount++;
    }
    stats.shipments = shipmentCount;
    stats.shippingUpdates = shippingUpdateCount;

    let eventCount = outboundShipmentEventCount;
    const addEvent = async (
      seededCase: SeededCase,
      eventType: EventType,
      user: User,
      timestamp: number,
      data: Record<string, unknown>,
    ) => {
      await ctx.db.insert("events", {
        caseId: seededCase.id,
        eventType,
        userId: user.id,
        userName: user.name,
        timestamp,
        data,
      });
      eventCount++;
    };

    let custodyCount = 0;
    let custodyHandoffCount = 0;
    const addCustody = async (
      seededCase: SeededCase,
      from: User,
      to: User,
      timestamp: number,
      notes: string,
    ) => {
      await ctx.db.insert("custodyRecords", {
        caseId: seededCase.id,
        fromUserId: from.id,
        fromUserName: from.name,
        toUserId: to.id,
        toUserName: to.name,
        transferredAt: timestamp,
        notes,
        signatureStorageId: `seed-signature-${seededCase.label}-${timestamp}`,
      });
      custodyCount++;

      await ctx.db.insert("custody_handoffs", {
        caseId: seededCase.id,
        fromUserId: from.id,
        toUserId: to.id,
        timestamp,
        signature: `seed-signature-${seededCase.label}-${timestamp}`,
        location: {
          lat: seededCase.status === "assembled" ? HQ.lat : seededCase.site.lat,
          lng: seededCase.status === "assembled" ? HQ.lng : seededCase.site.lng,
          name: seededCase.status === "assembled" ? HQ.name : seededCase.site.name,
          accuracy: 12,
        },
      });
      custodyHandoffCount++;

      await addEvent(seededCase, "custody_handoff", to, timestamp, {
        fromUserId: from.id,
        fromUserName: from.name,
        toUserId: to.id,
        toUserName: to.name,
        notes,
      });
    };

    let scanCount = 0;
    let scanEventCount = 0;
    const addScan = async (seededCase: SeededCase, user: User, scanType: ScanType, timestamp: number, inspectionId?: Id<"inspections">) => {
      const location = caseLocation(seededCase.spec, seededCase.site, scanCount % 5);
      await ctx.db.insert("scans", {
        caseId: seededCase.id,
        qrPayload: seededCase.qrCode,
        scannedBy: user.id,
        scannedByName: user.name,
        scannedAt: timestamp,
        lat: location.lat,
        lng: location.lng,
        locationName: location.locationName,
        scanContext: scanContextFor(scanType),
        inspectionId,
        deviceInfo: scanType === "shipping" ? "{\"ua\":\"iPad Pro 12.9\",\"app\":\"SCAN v2.4.1\"}" : "{\"ua\":\"iPhone 15 Pro\",\"app\":\"SCAN v2.4.1\"}",
      });
      scanCount++;

      await ctx.db.insert("scan_events", {
        caseId: seededCase.id,
        userId: user.id,
        timestamp,
        location: {
          lat: location.lat,
          lng: location.lng,
          name: location.locationName,
          accuracy: 10,
        },
        scanType,
      });
      scanEventCount++;
    };

    let checklistUpdateCount = 0;
    let damageReportCount = 0;
    let notificationCount = 0;

    for (const seededCase of seededCases) {
      const inspectionId = caseInspectionMap.get(seededCase.id);
      await addEvent(seededCase, "status_change", USERS.hangarLead, daysAgo(now, 34), {
        fromStatus: null,
        toStatus: "hangar",
        reason: `${seededCase.label} registered for ${seededCase.scenario.unitId}.`,
      });
      await addEvent(seededCase, "template_applied", USERS.hangarLead, daysAgo(now, 33), {
        templateName: TEMPLATE_DEFS.find((t) => t.key === seededCase.spec.templateKey)?.name,
        unitId: seededCase.scenario.unitId,
        beakon: seededCase.scenario.beakon,
      });
      await addEvent(seededCase, "qc_sign_off", USERS.qc, daysAgo(now, 4), {
        status: seededCase.status === "flagged" ? "rejected" : "approved",
        notes: seededCase.status === "flagged" ? "Field issue requires hangar repair." : "QC1/QC2 complete.",
      });

      if (seededCase.status !== "hangar") {
        await addEvent(seededCase, "status_change", USERS.hangarLead, daysAgo(now, 4), {
          fromStatus: "hangar",
          toStatus: "assembled",
          reason: "Packing list verified and case sealed.",
        });
      }

      if (seededCase.spec.shippingDirection === "outbound") {
        await addEvent(seededCase, "shipped", USERS.logistics, daysAgo(now, 2), {
          carrier: "FedEx",
          direction: "outbound",
          destination: seededCase.site.name,
          trackingNumber: trackingFor(eventCount),
        });
        await addScan(seededCase, USERS.logistics, "shipping", daysAgo(now, 2));
      }

      if (seededCase.status === "deployed" || seededCase.status === "flagged") {
        await addEvent(seededCase, "delivered", USERS.logistics, daysAgo(now, 5), {
          location: seededCase.site.name,
          handoffRequired: true,
        });
        await addEvent(seededCase, "status_change", seededCase.assignee, daysAgo(now, 5), {
          fromStatus: "transit_out",
          toStatus: "deployed",
          reason: "Case arrived and was checked out in SCAN.",
        });
        await addCustody(seededCase, USERS.logistics, seededCase.assignee, daysAgo(now, 5), "Outbound custody accepted during field checkout.");
        await addScan(seededCase, seededCase.assignee, "check_in", daysAgo(now, 5), inspectionId);
      }

      if (seededCase.scenario.unitId === "SC-201") {
        await addCustody(seededCase, USERS.techAlice, USERS.techRaj, daysAgo(now, 3), "Direct handoff at site trailer before crawl inspection.");
        await addScan(seededCase, USERS.techRaj, "handoff", daysAgo(now, 3), inspectionId);
      }

      if (seededCase.status === "received") {
        await addEvent(seededCase, "delivered", USERS.logistics, daysAgo(now, 8), {
          location: HQ.name,
          destination: "maintenance intake",
        });
        await addEvent(seededCase, "status_change", USERS.maintNia, daysAgo(now, 7), {
          fromStatus: "transit_in",
          toStatus: "received",
          reason: seededCase.scenario.routeReason,
        });
        await addCustody(seededCase, seededCase.scenario.custodian, USERS.maintNia, daysAgo(now, 7), "Returned to hangar and accepted for refurb intake.");
        await addScan(seededCase, USERS.maintNia, "receiving", daysAgo(now, 7), inspectionId);
      }

      if (seededCase.spec.shippingDirection === "return") {
        await addEvent(seededCase, "shipped", seededCase.assignee, daysAgo(now, 1), {
          carrier: "FedEx",
          direction: "return",
          destination: HQ.name,
          reason: seededCase.scenario.routeReason,
        });
        await addScan(seededCase, seededCase.assignee, "shipping", daysAgo(now, 1), inspectionId);
      }

      if (inspectionId) {
        await addEvent(seededCase, "inspection_started", seededCase.assignee, daysAgo(now, seededCase.status === "received" ? 7 : 2), {
          inspectionId,
          inspectorName: seededCase.assignee.name,
        });
      }

      const itemMap = caseManifestMap.get(seededCase.id);
      if (itemMap) {
        for (const [templateItemId, manifestItemId] of itemMap.entries()) {
          const manifest = await ctx.db.get(manifestItemId);
          if (!manifest || manifest.status === "unchecked") continue;

          await ctx.db.insert("checklist_updates", {
            caseId: seededCase.id,
            manifestItemId,
            templateItemId,
            itemName: manifest.name,
            previousStatus: "unchecked",
            newStatus: manifest.status,
            updatedBy: manifest.checkedById ?? seededCase.assignee.id,
            updatedByName: manifest.checkedByName ?? seededCase.assignee.name,
            updatedAt: manifest.checkedAt ?? daysAgo(now, 1),
            notes: manifest.notes,
            photoStorageIds: manifest.photoStorageIds,
            damageDescription: manifest.status === "damaged" ? manifest.notes ?? "Condition issue documented during checklist." : undefined,
            damageSeverity: manifest.status === "damaged" ? "moderate" : undefined,
            inspectionId,
          });
          checklistUpdateCount++;

          if (manifest.status === "damaged") {
            await addEvent(seededCase, "damage_reported", seededCase.assignee, manifest.checkedAt ?? daysAgo(now, 1), {
              manifestItemId,
              templateItemId,
              itemName: manifest.name,
              severity: "moderate",
              notes: manifest.notes,
            });

            await ctx.db.insert("damage_reports", {
              caseId: seededCase.id,
              photoStorageId: `seed-photo-${seededCase.label}-${templateItemId}`,
              annotations: [
                { x: 0.42, y: 0.58, label: "Documented condition", color: "#f97316" },
              ],
              severity: "moderate",
              reportedAt: manifest.checkedAt ?? daysAgo(now, 1),
              manifestItemId,
              templateItemId,
              reportedById: seededCase.assignee.id,
              reportedByName: seededCase.assignee.name,
              notes: manifest.notes,
            });
            damageReportCount++;

            await ctx.db.insert("notifications", {
              userId: USERS.ops.id,
              type: "damage_reported",
              title: `${seededCase.label} condition issue`,
              message: `${manifest.name} was marked damaged by ${seededCase.assignee.name}.`,
              caseId: seededCase.id,
              read: false,
              createdAt: manifest.checkedAt ?? daysAgo(now, 1),
            });
            notificationCount++;
          }
        }
      }

      if (inspectionId) {
        await addEvent(seededCase, "inspection_completed", seededCase.assignee, daysAgo(now, seededCase.status === "received" ? 6 : 1), {
          inspectionId,
          result: seededCase.status === "flagged" ? "flagged" : "completed",
        });
      }

      if (seededCase.status === "received") {
        await ctx.db.insert("notifications", {
          userId: USERS.maintNia.id,
          type: "shipment_delivered",
          title: `${seededCase.label} received at hangar`,
              message: `${seededCase.spec.displayName} is ready for refurb intake.`,
          caseId: seededCase.id,
          read: false,
          createdAt: daysAgo(now, 7),
        });
        notificationCount++;
      }
    }

    stats.events = eventCount;
    stats.custodyRecords = custodyCount;
    stats.custodyHandoffs = custodyHandoffCount;
    stats.scans = scanCount;
    stats.scanEvents = scanEventCount;
    stats.checklistUpdates = checklistUpdateCount;
    stats.damageReports = damageReportCount;
    stats.notifications = notificationCount;

    return {
      success: true,
      timestamp: new Date(now).toISOString(),
      stats,
      scenarios: SCENARIOS.map((scenario) => ({
        unitId: scenario.unitId,
        platform: scenario.platform,
        version: scenario.version,
        beakon: scenario.beakon,
        nickname: scenario.nickname,
        faaRegistration: scenario.faaRegistration,
        caseCount: scenario.cases.length,
        narrative: scenario.narrative,
      })),
    };
  },
});
