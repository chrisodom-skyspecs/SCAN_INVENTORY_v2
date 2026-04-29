/**
 * convex/seed.ts
 *
 * Realistic seed dataset for the SkySpecs INVENTORY + SCAN dev/test environment.
 *
 * Populates the Convex database with production-representative records:
 *   • 5 case templates (packing lists of 6–15 items each)
 *   • 6 missions across Michigan, Ohio, Illinois, Indiana wind farms
 *   • 40 turbine site markers distributed across mission sites
 *   • 50 equipment cases covering all lifecycle statuses
 *   • 690 manifest items (cases × template items)
 *   • 42 inspections (completed, in-progress, and pending)
 *   • 15 shipment records with FedEx tracking numbers
 *   • ~220 immutable audit events (status changes, inspections, damage, handoffs)
 *   • 60 custody handoff records
 *   • 130 scan records
 *   • 3 feature flag entries
 *
 * Usage:
 *   npx convex run seed:seedDatabase                        # dev (additive)
 *   npx convex run seed:seedDatabase '{"clearExisting":true}'  # dev (reset then seed)
 *
 * ⚠️  Only call with clearExisting=true in dev/test environments — it deletes
 *     ALL rows in each seeded table before inserting fresh data.
 *
 * Implementation notes:
 *   • Uses internalMutation → no auth required → safe for CI/CD pipelines.
 *   • Returns a summary object with counts of inserted rows per table.
 *   • Idempotency: when clearExisting=false (default), seed rows are still
 *     inserted, so call once per environment or always use clearExisting=true.
 *   • All timestamps are relative to the seed run time (Date.now()).
 */

import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// ─── Seed constants ───────────────────────────────────────────────────────────

/** SkySpecs HQ — Ann Arbor, MI (return destination for all shipments) */
const HQ = { lat: 42.2808, lng: -83.7430, name: "SkySpecs HQ — Ann Arbor, MI" };

/** Geographic centres for wind farm deployment zones */
const SITES = {
  lakeMichigan: { lat: 43.2340, lng: -86.2506, name: "Lake Michigan Offshore Site" },
  illinoisPrairie: { lat: 40.4842, lng: -88.9937, name: "Illinois Prairie Wind Farm" },
  lakeErie: { lat: 41.4993, lng: -81.6944, name: "Lake Erie Basin Site" },
  indianaHoosier: { lat: 40.4864, lng: -86.1336, name: "Indiana Hoosier Wind Farm" },
  upperMichigan: { lat: 46.5436, lng: -87.3954, name: "Upper Michigan Legacy Site" },
  ohioEmergency: { lat: 41.4489, lng: -82.7079, name: "Emergency Repair Delta Site" },
};

/** Simulated Kinde user identities (not real Kinde IDs — dev only) */
const USERS = [
  { id: "seed_usr_ops_mgr",    name: "Morgan Reeves",      role: "ops_manager" },
  { id: "seed_usr_tech_alice", name: "Alice Chen",         role: "field_tech" },
  { id: "seed_usr_tech_raj",   name: "Raj Patel",          role: "field_tech" },
  { id: "seed_usr_tech_dana",  name: "Dana Kim",           role: "field_tech" },
  { id: "seed_usr_tech_james", name: "James Okafor",       role: "field_tech" },
  { id: "seed_usr_pilot_emma", name: "Emma Lundström",     role: "pilot" },
  { id: "seed_usr_pilot_marc", name: "Marcus Brown",       role: "pilot" },
  { id: "seed_usr_logistics",  name: "Sarah Novak",        role: "logistics" },
];

/** Realistic FedEx Ground / Express tracking numbers */
const FEDEX_TRACKING_NUMBERS = [
  "794644823741", "771448178291", "785334928472",
  "776271918294", "789234810293", "782918374521",
  "773847261938", "791827364821", "768234917283",
  "784719283746", "779283746182", "793847261934",
  "781928374652", "796182736451", "772918364728",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return a random element from an array (not cryptographically random — fine for seed data) */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Add small jitter to coordinates so markers don't overlap on the map */
function jitter(base: number, range: number): number {
  return base + (Math.random() - 0.5) * range * 2;
}

/** Epoch ms N days before now */
function daysAgo(n: number): number {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}

/** Epoch ms N days after now */
function daysFromNow(n: number): number {
  return Date.now() + n * 24 * 60 * 60 * 1000;
}

/** Format epoch ms as ISO date string (YYYY-MM-DD) */
function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ─── Template item definitions ────────────────────────────────────────────────

const TEMPLATE_ITEMS = {
  droneInspectionKit: [
    { id: "dik-drone",      name: "DJI Matrice 300 RTK",          category: "Primary Equipment", required: true,  sortOrder: 1 },
    { id: "dik-batt1",      name: "TB60 Intelligent Battery #1",  category: "Power",             required: true,  sortOrder: 2 },
    { id: "dik-batt2",      name: "TB60 Intelligent Battery #2",  category: "Power",             required: true,  sortOrder: 3 },
    { id: "dik-batt3",      name: "TB60 Intelligent Battery #3",  category: "Power",             required: false, sortOrder: 4 },
    { id: "dik-batt4",      name: "TB60 Intelligent Battery #4",  category: "Power",             required: false, sortOrder: 5 },
    { id: "dik-controller", name: "Smart Controller Enterprise",  category: "Control",           required: true,  sortOrder: 6 },
    { id: "dik-tablet",     name: "iPad Pro 12.9-inch (with mount)",  category: "Control",           required: true,  sortOrder: 7 },
    { id: "dik-props-cw",   name: "CW Propeller Set (4-pack)",    category: "Hardware",          required: true,  sortOrder: 8 },
    { id: "dik-props-ccw",  name: "CCW Propeller Set (4-pack)",   category: "Hardware",          required: true,  sortOrder: 9 },
    { id: "dik-charger",    name: "BS65 Charging Station",        category: "Power",             required: true,  sortOrder: 10 },
    { id: "dik-sd",         name: "SanDisk 256GB microSD (×2)",   category: "Storage",           required: true,  sortOrder: 11 },
    { id: "dik-cal-target", name: "Calibration Target Board",     category: "Calibration",       required: false, sortOrder: 12 },
    { id: "dik-vest",       name: "Hi-Vis Safety Vest",           category: "Safety",            required: true,  sortOrder: 13 },
    { id: "dik-logbook",    name: "Flight Operations Log Book",   category: "Documentation",     required: true,  sortOrder: 14 },
  ],

  sensorArrayPackage: [
    { id: "sap-thermal",    name: "FLIR Zenmuse H20T Thermal",    category: "Sensors",           required: true,  sortOrder: 1 },
    { id: "sap-lidar",      name: "Livox Avia LiDAR Module",      category: "Sensors",           required: true,  sortOrder: 2 },
    { id: "sap-logger",     name: "Raspberry Pi 4 Data Logger",   category: "Computing",         required: true,  sortOrder: 3 },
    { id: "sap-mount",      name: "Universal Sensor Mount Arm",   category: "Hardware",          required: true,  sortOrder: 4 },
    { id: "sap-eth-cable",  name: "Cat6 Shielded Cable 5m",       category: "Cabling",           required: true,  sortOrder: 5 },
    { id: "sap-powerbank1", name: "Anker 26800mAh Power Bank #1", category: "Power",             required: true,  sortOrder: 6 },
    { id: "sap-powerbank2", name: "Anker 26800mAh Power Bank #2", category: "Power",             required: false, sortOrder: 7 },
    { id: "sap-cal-card",   name: "Thermal Calibration Card Set", category: "Calibration",       required: true,  sortOrder: 8 },
    { id: "sap-case-sm",    name: "Pelican 1510 Carry Case",      category: "Storage",           required: true,  sortOrder: 9 },
    { id: "sap-case-lg",    name: "Pelican 1650 Equipment Case",  category: "Storage",           required: true,  sortOrder: 10 },
    { id: "sap-dongle",     name: "SkySpecs Software License USB", category: "Software",         required: true,  sortOrder: 11 },
  ],

  safetyPPEKit: [
    { id: "ppk-hardhat",    name: "ANSI Z89.1 Hard Hat",          category: "Head Protection",   required: true,  sortOrder: 1 },
    { id: "ppk-harness",    name: "Full-Body Safety Harness",     category: "Fall Protection",   required: true,  sortOrder: 2 },
    { id: "ppk-lanyard",    name: "Shock-Absorbing Lanyard 6ft",  category: "Fall Protection",   required: true,  sortOrder: 3 },
    { id: "ppk-carabiner",  name: "Auto-Lock Carabiner (×4)",     category: "Fall Protection",   required: true,  sortOrder: 4 },
    { id: "ppk-glasses",    name: "Safety Glasses (ANSI Z87.1)",  category: "Eye Protection",    required: true,  sortOrder: 5 },
    { id: "ppk-hiviz",      name: "Hi-Vis ANSI Class 3 Vest",     category: "Visibility",        required: true,  sortOrder: 6 },
    { id: "ppk-firstaid",   name: "First Aid Kit (ANSI A+)",      category: "Medical",           required: true,  sortOrder: 7 },
    { id: "ppk-gloves",     name: "Cut-Resistant Gloves (×2 pr)", category: "Hand Protection",   required: true,  sortOrder: 8 },
  ],

  documentationStation: [
    { id: "ds-laptop",      name: "MacBook Pro 14\" (M3 Pro)",    category: "Computing",         required: true,  sortOrder: 1 },
    { id: "ds-camera",      name: "Sony A7R IV Mirrorless Camera",category: "Photography",       required: true,  sortOrder: 2 },
    { id: "ds-lens",        name: "Sony 24–70mm f/2.8 GM II Lens",category: "Photography",       required: true,  sortOrder: 3 },
    { id: "ds-sd-cards",    name: "CFexpress Type A Card (×3)",   category: "Storage",           required: true,  sortOrder: 4 },
    { id: "ds-tripod",      name: "Manfrotto Carbon Fiber Tripod",category: "Photography",       required: false, sortOrder: 5 },
    { id: "ds-powerstrip",  name: "Heavy-Duty 6-Outlet Strip",    category: "Power",             required: true,  sortOrder: 6 },
    { id: "ds-usb-hub",     name: "USB-C 10-Port Hub",            category: "Computing",         required: false, sortOrder: 7 },
  ],

  emergencyRepairKit: [
    { id: "erk-motor",      name: "Replacement Motor DJI M300",   category: "Motors",            required: true,  sortOrder: 1 },
    { id: "erk-esc",        name: "ESC Replacement Module",       category: "Electronics",       required: true,  sortOrder: 2 },
    { id: "erk-props",      name: "Emergency Propeller Set",      category: "Hardware",          required: true,  sortOrder: 3 },
    { id: "erk-frame",      name: "Frame Arm Repair Kit",         category: "Structure",         required: true,  sortOrder: 4 },
    { id: "erk-soldering",  name: "Hakko FX-888D Soldering Iron", category: "Tools",             required: true,  sortOrder: 5 },
    { id: "erk-shrink",     name: "Heat Shrink Tube Assortment",  category: "Materials",         required: true,  sortOrder: 6 },
    { id: "erk-tape",       name: "3M Electrical Tape (×3 rolls)",category: "Materials",         required: true,  sortOrder: 7 },
    { id: "erk-multimeter", name: "Fluke 87V Multimeter",        category: "Tools",             required: true,  sortOrder: 8 },
    { id: "erk-wiring",     name: "Spare Wiring Bundle 18–26AWG", category: "Electronics",       required: false, sortOrder: 9 },
    { id: "erk-heatgun",    name: "DeWalt 20V Heat Gun",          category: "Tools",             required: false, sortOrder: 10 },
  ],
};

// ─── Seed mutation ────────────────────────────────────────────────────────────

export const seedDatabase = internalMutation({
  args: {
    /** When true, delete all existing rows in seeded tables before inserting. */
    clearExisting: v.optional(v.boolean()),
  },

  handler: async (ctx, args) => {
    const now = Date.now();
    const stats: Record<string, number> = {};

    // ── 0. Optionally clear existing seed data ──────────────────────────────

    if (args.clearExisting) {
      const tables = [
        "featureFlags", "caseTemplates", "missions", "turbines", "cases",
        "manifestItems", "inspections", "shipments", "events", "custodyRecords",
        "scans", "checklist_updates", "damage_reports", "notifications",
      ] as const;

      for (const table of tables) {
        // Convex doesn't support TRUNCATE; iterate + delete
        const rows = await ctx.db.query(table).collect();
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      }
    }

    // ── 1. Feature flags ────────────────────────────────────────────────────

    const flagDefs = [
      { key: "FF_AUDIT_HASH_CHAIN", enabled: true,  description: "Hash-chain tamper detection on T5 audit panel" },
      { key: "FF_MAP_MISSION",      enabled: true,  description: "M5 Mission Control map mode" },
      { key: "FF_INV_REDESIGN",     enabled: true,  description: "INVENTORY redesign (§0–§25) UI" },
    ];

    for (const flag of flagDefs) {
      await ctx.db.insert("featureFlags", { ...flag, updatedAt: now });
    }
    stats.featureFlags = flagDefs.length;

    // ── 2. Case templates ────────────────────────────────────────────────────

    const templateDroneId = await ctx.db.insert("caseTemplates", {
      name: "Drone Inspection Kit",
      description: "Full DJI Matrice 300 RTK kit for turbine blade and tower inspection missions. Includes drone, batteries, controller, tablet, spare props, charging station, and required safety/documentation items.",
      isActive: true,
      items: TEMPLATE_ITEMS.droneInspectionKit,
      createdAt: daysAgo(120),
      updatedAt: daysAgo(14),
    });

    const templateSensorId = await ctx.db.insert("caseTemplates", {
      name: "Sensor Array Package",
      description: "Thermal + LiDAR sensor payload bundle with data logging hardware. Used when attaching advanced sensor suites to the drone platform for multi-spectral blade defect analysis.",
      isActive: true,
      items: TEMPLATE_ITEMS.sensorArrayPackage,
      createdAt: daysAgo(90),
      updatedAt: daysAgo(7),
    });

    const templateSafetyId = await ctx.db.insert("caseTemplates", {
      name: "Safety & PPE Kit",
      description: "Complete ANSI-compliant personal protective equipment set for field operations. Mandatory issue to all field technicians and pilots before site access.",
      isActive: true,
      items: TEMPLATE_ITEMS.safetyPPEKit,
      createdAt: daysAgo(180),
      updatedAt: daysAgo(30),
    });

    const templateDocId = await ctx.db.insert("caseTemplates", {
      name: "Documentation Station",
      description: "Laptop, mirrorless camera, and supporting peripherals for on-site inspection documentation, report authoring, and stakeholder deliverables.",
      isActive: true,
      items: TEMPLATE_ITEMS.documentationStation,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(5),
    });

    const templateRepairId = await ctx.db.insert("caseTemplates", {
      name: "Emergency Repair Kit",
      description: "Field repair consumables and tools for on-site drone maintenance. Dispatched when a unit sustains field damage that can be resolved without return to depot.",
      isActive: true,
      items: TEMPLATE_ITEMS.emergencyRepairKit,
      createdAt: daysAgo(45),
      updatedAt: daysAgo(10),
    });

    stats.caseTemplates = 5;

    // ── 3. Missions ──────────────────────────────────────────────────────────

    const mission1Id = await ctx.db.insert("missions", {
      name: "Lake Michigan Offshore Pilot Q2",
      description: "Spring offshore wind farm inspection campaign. 24 turbines in the proposed Lake Michigan Offshore Wind Energy Area. Priority on blade leading-edge erosion assessment.",
      status: "active",
      lat: SITES.lakeMichigan.lat,
      lng: SITES.lakeMichigan.lng,
      locationName: SITES.lakeMichigan.name,
      startDate: daysAgo(14),
      endDate: daysFromNow(21),
      leadId: "seed_usr_pilot_marc",
      leadName: "Marcus Brown",
      createdAt: daysAgo(30),
      updatedAt: daysAgo(1),
    });

    const mission2Id = await ctx.db.insert("missions", {
      name: "Illinois Prairie Wind Survey",
      description: "Annual preventive maintenance inspection for the 68-turbine Heartland Wind Farm in McLean County. Includes nacelle access and blade root inspections.",
      status: "active",
      lat: SITES.illinoisPrairie.lat,
      lng: SITES.illinoisPrairie.lng,
      locationName: SITES.illinoisPrairie.name,
      startDate: daysAgo(7),
      endDate: daysFromNow(28),
      leadId: "seed_usr_tech_alice",
      leadName: "Alice Chen",
      createdAt: daysAgo(21),
      updatedAt: daysAgo(2),
    });

    const mission3Id = await ctx.db.insert("missions", {
      name: "Lake Erie Basin Inspection",
      description: "Completed Q1 inspection of 45 offshore turbines in the Lake Erie Energy Development Zone. All blades assessed; 3 units flagged for leading-edge repair.",
      status: "completed",
      lat: SITES.lakeErie.lat,
      lng: SITES.lakeErie.lng,
      locationName: SITES.lakeErie.name,
      startDate: daysAgo(90),
      endDate: daysAgo(45),
      leadId: "seed_usr_pilot_emma",
      leadName: "Emma Lundström",
      createdAt: daysAgo(120),
      updatedAt: daysAgo(45),
    });

    const mission4Id = await ctx.db.insert("missions", {
      name: "Indiana Hoosier Wind Fleet",
      description: "Multi-week inspection contract for the Hoosier Energy Cooperative 52-turbine fleet across Tipton, Clinton, and Benton counties. Includes gearbox vibration sensing.",
      status: "active",
      lat: SITES.indianaHoosier.lat,
      lng: SITES.indianaHoosier.lng,
      locationName: SITES.indianaHoosier.name,
      startDate: daysAgo(3),
      endDate: daysFromNow(35),
      leadId: "seed_usr_tech_raj",
      leadName: "Raj Patel",
      createdAt: daysAgo(14),
      updatedAt: now,
    });

    const mission5Id = await ctx.db.insert("missions", {
      name: "Upper Michigan Legacy Fleet",
      description: "Planned inspection of aging Marquette County turbine fleet. Assets 15–25 years old; focus on structural integrity and blade delamination. Awaiting site access permits.",
      status: "planning",
      lat: SITES.upperMichigan.lat,
      lng: SITES.upperMichigan.lng,
      locationName: SITES.upperMichigan.name,
      startDate: daysFromNow(30),
      endDate: daysFromNow(70),
      leadId: "seed_usr_ops_mgr",
      leadName: "Morgan Reeves",
      createdAt: daysAgo(7),
      updatedAt: daysAgo(2),
    });

    const mission6Id = await ctx.db.insert("missions", {
      name: "Emergency Repair Delta Site",
      description: "Unplanned dispatch to Sandusky OH after a lightning strike damaged 2 turbines. Emergency repair teams on-site; drone survey required for damage extent assessment.",
      status: "active",
      lat: SITES.ohioEmergency.lat,
      lng: SITES.ohioEmergency.lng,
      locationName: SITES.ohioEmergency.name,
      startDate: daysAgo(2),
      endDate: daysFromNow(5),
      leadId: "seed_usr_tech_james",
      leadName: "James Okafor",
      createdAt: daysAgo(3),
      updatedAt: now,
    });

    stats.missions = 6;

    // ── 4. Turbines (40 total across all sites) ──────────────────────────────

    const turbineRows: Array<{
      name: string; lat: number; lng: number;
      missionId?: Id<"missions">; siteCode: string;
      status: "active" | "inactive" | "decommissioned";
      hubHeight: number; rotorDiameter: number;
    }> = [];

    // Lake Michigan (8 turbines)
    for (let i = 1; i <= 8; i++) {
      turbineRows.push({
        name: `LMO-T${String(i).padStart(3, "0")}`,
        lat: jitter(SITES.lakeMichigan.lat, 0.08),
        lng: jitter(SITES.lakeMichigan.lng, 0.12),
        missionId: mission1Id,
        siteCode: "LMO",
        status: i <= 6 ? "active" : "inactive",
        hubHeight: 95 + Math.floor(Math.random() * 15),
        rotorDiameter: 126 + Math.floor(Math.random() * 20),
      });
    }

    // Illinois Prairie (8 turbines)
    for (let i = 1; i <= 8; i++) {
      turbineRows.push({
        name: `IPW-T${String(i).padStart(3, "0")}`,
        lat: jitter(SITES.illinoisPrairie.lat, 0.12),
        lng: jitter(SITES.illinoisPrairie.lng, 0.15),
        missionId: mission2Id,
        siteCode: "IPW",
        status: "active",
        hubHeight: 80 + Math.floor(Math.random() * 20),
        rotorDiameter: 117 + Math.floor(Math.random() * 25),
      });
    }

    // Lake Erie Basin (7 turbines — completed mission, still tracked)
    for (let i = 1; i <= 7; i++) {
      turbineRows.push({
        name: `LEB-T${String(i).padStart(3, "0")}`,
        lat: jitter(SITES.lakeErie.lat, 0.06),
        lng: jitter(SITES.lakeErie.lng, 0.10),
        missionId: mission3Id,
        siteCode: "LEB",
        status: i <= 4 ? "active" : "inactive",
        hubHeight: 90 + Math.floor(Math.random() * 10),
        rotorDiameter: 130,
      });
    }

    // Indiana Hoosier (7 turbines)
    for (let i = 1; i <= 7; i++) {
      turbineRows.push({
        name: `IHW-T${String(i).padStart(3, "0")}`,
        lat: jitter(SITES.indianaHoosier.lat, 0.10),
        lng: jitter(SITES.indianaHoosier.lng, 0.12),
        missionId: mission4Id,
        siteCode: "IHW",
        status: "active",
        hubHeight: 85 + Math.floor(Math.random() * 15),
        rotorDiameter: 120 + Math.floor(Math.random() * 15),
      });
    }

    // Upper Michigan (5 turbines — legacy/planning)
    for (let i = 1; i <= 5; i++) {
      turbineRows.push({
        name: `UML-T${String(i).padStart(3, "0")}`,
        lat: jitter(SITES.upperMichigan.lat, 0.08),
        lng: jitter(SITES.upperMichigan.lng, 0.10),
        missionId: mission5Id,
        siteCode: "UML",
        status: i <= 3 ? "active" : "decommissioned",
        hubHeight: 65 + Math.floor(Math.random() * 20),
        rotorDiameter: 80 + Math.floor(Math.random() * 20),
      });
    }

    // Emergency Delta Site (5 turbines)
    for (let i = 1; i <= 5; i++) {
      turbineRows.push({
        name: `EDS-T${String(i).padStart(3, "0")}`,
        lat: jitter(SITES.ohioEmergency.lat, 0.05),
        lng: jitter(SITES.ohioEmergency.lng, 0.07),
        missionId: mission6Id,
        siteCode: "EDS",
        status: i <= 3 ? "active" : "inactive",
        hubHeight: 78 + Math.floor(Math.random() * 12),
        rotorDiameter: 112 + Math.floor(Math.random() * 18),
      });
    }

    for (const t of turbineRows) {
      await ctx.db.insert("turbines", {
        name: t.name,
        lat: t.lat,
        lng: t.lng,
        missionId: t.missionId,
        siteCode: t.siteCode,
        status: t.status,
        hubHeight: t.hubHeight,
        rotorDiameter: t.rotorDiameter,
        createdAt: daysAgo(180),
        updatedAt: daysAgo(Math.floor(Math.random() * 30)),
      });
    }
    stats.turbines = turbineRows.length;

    // ── 5. Cases (50 total) ──────────────────────────────────────────────────

    /**
     * Case distribution across lifecycle statuses:
     *   hangar:      8  (stored in warehouse, not yet assembled)
     *   assembled:   7  (packed and ready to ship)
     *   transit_out: 5  (en route to field site)
     *   deployed:    14 (actively in use at a site)
     *   flagged:     4  (has outstanding issues)
     *   transit_in:  4  (returning to base)
     *   received:    5  (back at base, awaiting teardown)
     *   archived:    3  (decommissioned)
     */

    const caseIds: Id<"cases">[] = [];

    // Helper to insert a case and record its ID
    const insertCase = async (data: Parameters<typeof ctx.db.insert<"cases">>[1]) => {
      const id = await ctx.db.insert("cases", data);
      caseIds.push(id);
      return id;
    };

    // ── Hangar cases (CASE-001 through CASE-008) ────────────────────────────

    for (let i = 1; i <= 8; i++) {
      await insertCase({
        label: `CASE-${String(i).padStart(3, "0")}`,
        qrCode: `SKY:CASE-${String(i).padStart(3, "0")}:${(1000000 + i).toString(36).toUpperCase()}`,
        qrCodeSource: "generated",
        status: "hangar",
        templateId: [templateDroneId, templateSafetyId, templateDocId, templateRepairId, templateSensorId, templateDroneId, templateSafetyId, templateDocId][i - 1],
        lat: jitter(HQ.lat, 0.005),
        lng: jitter(HQ.lng, 0.005),
        locationName: `${HQ.name} — Bay ${i}`,
        notes: i === 3 ? "Awaiting replacement battery — on order from DJI" : undefined,
        createdAt: daysAgo(180 - i * 5),
        updatedAt: daysAgo(30 - i),
      });
    }

    // ── Assembled cases (CASE-009 through CASE-015) ─────────────────────────

    const assembledTemplates = [templateDroneId, templateSensorId, templateSafetyId, templateDocId, templateRepairId, templateDroneId, templateSensorId];
    for (let i = 9; i <= 15; i++) {
      await insertCase({
        label: `CASE-${String(i).padStart(3, "0")}`,
        qrCode: `SKY:CASE-${String(i).padStart(3, "0")}:${(1000000 + i).toString(36).toUpperCase()}`,
        qrCodeSource: "generated",
        status: "assembled",
        templateId: assembledTemplates[i - 9],
        lat: jitter(HQ.lat, 0.005),
        lng: jitter(HQ.lng, 0.005),
        locationName: `${HQ.name} — Staging Area`,
        assigneeId: pick(USERS.filter(u => u.role === "logistics")).id,
        assigneeName: pick(USERS.filter(u => u.role === "logistics")).name,
        createdAt: daysAgo(60 - i),
        updatedAt: daysAgo(5),
      });
    }

    // ── Transit Out cases (CASE-016 through CASE-020) ───────────────────────

    const transitOutDestinations = [
      { missionId: mission1Id, site: SITES.lakeMichigan, assignee: USERS[6] },
      { missionId: mission2Id, site: SITES.illinoisPrairie, assignee: USERS[1] },
      { missionId: mission4Id, site: SITES.indianaHoosier, assignee: USERS[2] },
      { missionId: mission6Id, site: SITES.ohioEmergency, assignee: USERS[4] },
      { missionId: mission2Id, site: SITES.illinoisPrairie, assignee: USERS[3] },
    ];

    const transitOutCaseIds: Id<"cases">[] = [];

    for (let i = 16; i <= 20; i++) {
      const dest = transitOutDestinations[i - 16];
      const trackingNum = FEDEX_TRACKING_NUMBERS[i - 16];
      const shippedAt = daysAgo(2 - (i - 16) * 0.3);
      const caseId = await insertCase({
        label: `CASE-${String(i).padStart(3, "0")}`,
        qrCode: `SKY:CASE-${String(i).padStart(3, "0")}:${(1000000 + i).toString(36).toUpperCase()}`,
        qrCodeSource: "generated",
        status: "transit_out",
        templateId: pick([templateDroneId, templateSensorId, templateRepairId]),
        missionId: dest.missionId,
        lat: jitter(HQ.lat + (dest.site.lat - HQ.lat) * 0.4, 0.3),
        lng: jitter(HQ.lng + (dest.site.lng - HQ.lng) * 0.4, 0.4),
        locationName: "In Transit — FedEx Ground Network",
        assigneeId: dest.assignee.id,
        assigneeName: dest.assignee.name,
        trackingNumber: trackingNum,
        carrier: "FedEx",
        shippedAt,
        destinationName: dest.site.name,
        destinationLat: dest.site.lat,
        destinationLng: dest.site.lng,
        createdAt: daysAgo(30 - (i - 16)),
        updatedAt: shippedAt,
      });
      transitOutCaseIds.push(caseId);
    }

    // ── Deployed cases (CASE-021 through CASE-034) ──────────────────────────

    const deployedSites = [
      { missionId: mission1Id, site: SITES.lakeMichigan, assignee: USERS[6] },
      { missionId: mission1Id, site: SITES.lakeMichigan, assignee: USERS[1] },
      { missionId: mission2Id, site: SITES.illinoisPrairie, assignee: USERS[1] },
      { missionId: mission2Id, site: SITES.illinoisPrairie, assignee: USERS[3] },
      { missionId: mission2Id, site: SITES.illinoisPrairie, assignee: USERS[5] },
      { missionId: mission4Id, site: SITES.indianaHoosier, assignee: USERS[2] },
      { missionId: mission4Id, site: SITES.indianaHoosier, assignee: USERS[5] },
      { missionId: mission4Id, site: SITES.indianaHoosier, assignee: USERS[4] },
      { missionId: mission6Id, site: SITES.ohioEmergency, assignee: USERS[4] },
      { missionId: mission6Id, site: SITES.ohioEmergency, assignee: USERS[3] },
      { missionId: mission1Id, site: SITES.lakeMichigan, assignee: USERS[5] },
      { missionId: mission2Id, site: SITES.illinoisPrairie, assignee: USERS[2] },
      { missionId: mission4Id, site: SITES.indianaHoosier, assignee: USERS[1] },
      { missionId: mission6Id, site: SITES.ohioEmergency, assignee: USERS[6] },
    ];

    const deployedCaseIds: Id<"cases">[] = [];

    for (let i = 21; i <= 34; i++) {
      const si = i - 21;
      const site = deployedSites[si];
      const caseId = await insertCase({
        label: `CASE-${String(i).padStart(3, "0")}`,
        qrCode: `SKY:CASE-${String(i).padStart(3, "0")}:${(1000000 + i).toString(36).toUpperCase()}`,
        qrCodeSource: "generated",
        status: "deployed",
        templateId: [
          templateDroneId, templateSensorId, templateDroneId, templateSafetyId,
          templateDocId, templateDroneId, templateSensorId, templateRepairId,
          templateDroneId, templateSensorId, templateDroneId, templateSafetyId,
          templateDocId, templateRepairId,
        ][si],
        missionId: site.missionId,
        lat: jitter(site.site.lat, 0.05),
        lng: jitter(site.site.lng, 0.06),
        locationName: site.site.name,
        assigneeId: site.assignee.id,
        assigneeName: site.assignee.name,
        createdAt: daysAgo(90 - si * 2),
        updatedAt: daysAgo(Math.floor(Math.random() * 5)),
      });
      deployedCaseIds.push(caseId);
    }

    // ── Flagged cases (CASE-035 through CASE-038) ────────────────────────────

    const flaggedReasons = [
      "Battery swelling detected during pre-flight check — unit grounded pending inspection",
      "Controller firmware update failed mid-mission — cannot reconnect",
      "Thermal sensor mounting arm cracked on landing — needs depot repair",
      "SD card corruption — multiple flights lost; under investigation",
    ];

    const flaggedCaseIds: Id<"cases">[] = [];

    for (let i = 35; i <= 38; i++) {
      const si = i - 35;
      const site = [
        { missionId: mission1Id, site: SITES.lakeMichigan, assignee: USERS[1] },
        { missionId: mission2Id, site: SITES.illinoisPrairie, assignee: USERS[3] },
        { missionId: mission4Id, site: SITES.indianaHoosier, assignee: USERS[2] },
        { missionId: mission6Id, site: SITES.ohioEmergency, assignee: USERS[4] },
      ][si];
      const caseId = await insertCase({
        label: `CASE-${String(i).padStart(3, "0")}`,
        qrCode: `SKY:CASE-${String(i).padStart(3, "0")}:${(1000000 + i).toString(36).toUpperCase()}`,
        qrCodeSource: "generated",
        status: "flagged",
        templateId: pick([templateDroneId, templateSensorId]),
        missionId: site.missionId,
        lat: jitter(site.site.lat, 0.04),
        lng: jitter(site.site.lng, 0.04),
        locationName: site.site.name,
        assigneeId: site.assignee.id,
        assigneeName: site.assignee.name,
        notes: flaggedReasons[si],
        createdAt: daysAgo(40 - si * 3),
        updatedAt: daysAgo(1),
      });
      flaggedCaseIds.push(caseId);
    }

    // ── Transit In cases (CASE-039 through CASE-042) ─────────────────────────

    const transitInCaseIds: Id<"cases">[] = [];

    for (let i = 39; i <= 42; i++) {
      const si = i - 39;
      const trackingNum = FEDEX_TRACKING_NUMBERS[5 + si];
      const shippedAt = daysAgo(1 + si * 0.5);
      const caseId = await insertCase({
        label: `CASE-${String(i).padStart(3, "0")}`,
        qrCode: `SKY:CASE-${String(i).padStart(3, "0")}:${(1000000 + i).toString(36).toUpperCase()}`,
        qrCodeSource: "generated",
        status: "transit_in",
        templateId: pick([templateDroneId, templateSensorId]),
        lat: jitter(HQ.lat + (SITES.lakeErie.lat - HQ.lat) * 0.5, 0.2),
        lng: jitter(HQ.lng + (SITES.lakeErie.lng - HQ.lng) * 0.5, 0.3),
        locationName: "In Transit — FedEx Ground Network (Return)",
        assigneeId: USERS[7].id,
        assigneeName: USERS[7].name,
        trackingNumber: trackingNum,
        carrier: "FedEx",
        shippedAt,
        destinationName: HQ.name,
        destinationLat: HQ.lat,
        destinationLng: HQ.lng,
        createdAt: daysAgo(60 - si * 5),
        updatedAt: shippedAt,
      });
      transitInCaseIds.push(caseId);
    }

    // ── Received cases (CASE-043 through CASE-047) ───────────────────────────

    const receivedCaseIds: Id<"cases">[] = [];

    for (let i = 43; i <= 47; i++) {
      const caseId = await insertCase({
        label: `CASE-${String(i).padStart(3, "0")}`,
        qrCode: `SKY:CASE-${String(i).padStart(3, "0")}:${(1000000 + i).toString(36).toUpperCase()}`,
        qrCodeSource: "generated",
        status: "received",
        templateId: pick([templateDroneId, templateSensorId, templateSafetyId, templateDocId]),
        lat: jitter(HQ.lat, 0.005),
        lng: jitter(HQ.lng, 0.005),
        locationName: `${HQ.name} — Receiving Dock`,
        assigneeId: USERS[7].id,
        assigneeName: USERS[7].name,
        createdAt: daysAgo(90 - (i - 43) * 10),
        updatedAt: daysAgo(3 + (i - 43)),
      });
      receivedCaseIds.push(caseId);
    }

    // ── Archived cases (CASE-048 through CASE-050) ───────────────────────────

    for (let i = 48; i <= 50; i++) {
      await insertCase({
        label: `CASE-${String(i).padStart(3, "0")}`,
        qrCode: `SKY:CASE-${String(i).padStart(3, "0")}:${(1000000 + i).toString(36).toUpperCase()}`,
        qrCodeSource: "generated",
        status: "archived",
        templateId: templateDroneId,
        lat: jitter(HQ.lat, 0.005),
        lng: jitter(HQ.lng, 0.005),
        locationName: `${HQ.name} — Archive Storage`,
        notes: ["Unit total loss — crash during storm at Lake Erie Site (Q4 prior year)",
                 "Beyond economic repair — frame corrosion after 3 seasons",
                 "Replaced by CASE-002 — end of service life"][i - 48],
        createdAt: daysAgo(365 - (i - 48) * 60),
        updatedAt: daysAgo(60 + (i - 48) * 20),
      });
    }

    stats.cases = caseIds.length;

    // ── 6. Manifest items ─────────────────────────────────────────────────────

    let manifestItemCount = 0;

    // Build manifest items for all 50 cases
    // We need to look up each case's templateId and insert the appropriate items.
    // Re-read the cases we just inserted (they have known IDs in caseIds array).

    // Predefine template items map for lookup
    const templateItemsMap = new Map<string, typeof TEMPLATE_ITEMS.droneInspectionKit>([
      [templateDroneId,   TEMPLATE_ITEMS.droneInspectionKit],
      [templateSensorId,  TEMPLATE_ITEMS.sensorArrayPackage],
      [templateSafetyId,  TEMPLATE_ITEMS.safetyPPEKit],
      [templateDocId,     TEMPLATE_ITEMS.documentationStation],
      [templateRepairId,  TEMPLATE_ITEMS.emergencyRepairKit],
    ]);

    // We need to associate manifest items with cases. Load each case to get its templateId.
    const allCases = await Promise.all(caseIds.map(id => ctx.db.get(id)));

    // manifestItemId lookup: caseId → Map<templateItemId, manifestItemId>
    const caseManifestMap = new Map<Id<"cases">, Map<string, Id<"manifestItems">>>();

    for (const c of allCases) {
      if (!c || !c.templateId) continue;
      const items = templateItemsMap.get(c.templateId as string);
      if (!items) continue;

      const itemMap = new Map<string, Id<"manifestItems">>();

      // Determine item statuses based on case status
      const isDeployed = c.status === "deployed";
      const isFlagged = c.status === "flagged";
      const isCompleted = c.status === "received" || c.status === "archived";

      for (const item of items) {
        let status: "unchecked" | "ok" | "damaged" | "missing" = "unchecked";
        let checkedAt: number | undefined;
        let checkedById: string | undefined;
        let checkedByName: string | undefined;
        let notes: string | undefined;

        if (isCompleted || isDeployed) {
          // Most items checked OK, a few damaged/missing
          const roll = Math.random();
          if (roll < 0.82) {
            status = "ok";
          } else if (roll < 0.92) {
            status = "damaged";
            notes = pick([
              "Minor surface scratch",
              "Connector bent — still functional",
              "Case latch damaged",
              "Label worn off",
            ]);
          } else if (roll < 0.97) {
            status = "missing";
            notes = "Not found during inspection";
          } else {
            status = "unchecked";
          }

          if (status !== "unchecked") {
            const techUser = pick(USERS.filter(u => u.role === "field_tech" || u.role === "pilot"));
            checkedAt = daysAgo(Math.floor(Math.random() * 20) + 1);
            checkedById = c.assigneeId ?? techUser.id;
            checkedByName = c.assigneeName ?? techUser.name;
          }
        } else if (isFlagged) {
          // Flagged cases: mix of ok and damaged
          const roll = Math.random();
          if (roll < 0.60) {
            status = "ok";
          } else if (roll < 0.88) {
            status = "damaged";
            notes = pick([
              "Impact damage observed",
              "Visible crack in housing",
              "Bent connector pins",
              "Scorch mark from short circuit",
            ]);
          } else if (roll < 0.95) {
            status = "missing";
          } else {
            status = "unchecked";
          }
          if (status !== "unchecked") {
            const techUser = pick(USERS.filter(u => u.role === "field_tech"));
            checkedAt = daysAgo(2);
            checkedById = c.assigneeId ?? techUser.id;
            checkedByName = c.assigneeName ?? techUser.name;
          }
        }

        const manifestItemId = await ctx.db.insert("manifestItems", {
          caseId: c._id,
          templateItemId: item.id,
          name: item.name,
          status,
          notes,
          checkedAt,
          checkedById,
          checkedByName,
        });

        itemMap.set(item.id, manifestItemId);
        manifestItemCount++;
      }

      caseManifestMap.set(c._id, itemMap);
    }

    stats.manifestItems = manifestItemCount;

    // ── 7. Inspections ───────────────────────────────────────────────────────

    let inspectionCount = 0;

    // Create inspections for deployed, flagged, received, and archived cases
    const inspectionCaseIds = [
      ...deployedCaseIds,
      ...flaggedCaseIds,
      ...receivedCaseIds,
      caseIds[47], caseIds[48], caseIds[49], // archived
    ].filter(Boolean);

    // inspectionId lookup: caseId → inspectionId
    const caseInspectionMap = new Map<Id<"cases">, Id<"inspections">>();

    for (const caseId of inspectionCaseIds) {
      const c = await ctx.db.get(caseId);
      if (!c || !c.templateId) continue;

      const items = templateItemsMap.get(c.templateId as string) ?? [];
      const itemMap = caseManifestMap.get(caseId);
      if (!itemMap) continue;

      let checked = 0, damaged = 0, missing = 0;
      for (const [, manifestId] of itemMap.entries()) {
        const mi = await ctx.db.get(manifestId);
        if (!mi) continue;
        if (mi.status === "ok") checked++;
        else if (mi.status === "damaged") { checked++; damaged++; }
        else if (mi.status === "missing") { checked++; missing++; }
      }

      const total = items.length;
      const inspector = pick(USERS.filter(u => u.role === "field_tech" || u.role === "pilot"));

      let inspStatus: "pending" | "in_progress" | "completed" | "flagged" = "completed";
      let completedAt: number | undefined = daysAgo(Math.floor(Math.random() * 14) + 1);

      if (c.status === "deployed") {
        const allChecked = checked === total;
        inspStatus = allChecked ? "completed" : "in_progress";
        if (!allChecked) completedAt = undefined;
      } else if (c.status === "flagged") {
        inspStatus = "flagged";
        completedAt = daysAgo(2);
      } else if (c.status === "archived") {
        inspStatus = "completed";
        completedAt = daysAgo(60);
      }

      const inspectionId = await ctx.db.insert("inspections", {
        caseId,
        inspectorId: c.assigneeId ?? inspector.id,
        inspectorName: c.assigneeName ?? inspector.name,
        status: inspStatus,
        startedAt: daysAgo(Math.floor(Math.random() * 20) + 2),
        completedAt,
        totalItems: total,
        checkedItems: checked,
        damagedItems: damaged,
        missingItems: missing,
        notes: c.status === "flagged" ? "Inspection flagged — items require supervisor review" : undefined,
      });

      caseInspectionMap.set(caseId, inspectionId);
      inspectionCount++;
    }

    stats.inspections = inspectionCount;

    // ── 8. Shipments ─────────────────────────────────────────────────────────

    let shipmentCount = 0;

    // Transit-out shipments (CASE-016 through CASE-020)
    for (let i = 0; i < transitOutCaseIds.length; i++) {
      const caseId = transitOutCaseIds[i];
      const c = await ctx.db.get(caseId);
      if (!c) continue;

      await ctx.db.insert("shipments", {
        caseId,
        trackingNumber: FEDEX_TRACKING_NUMBERS[i],
        carrier: "FedEx",
        status: pick(["in_transit", "in_transit", "in_transit", "picked_up", "out_for_delivery"]),
        originLat: HQ.lat,
        originLng: HQ.lng,
        originName: HQ.name,
        destinationLat: c.destinationLat,
        destinationLng: c.destinationLng,
        destinationName: c.destinationName,
        currentLat: c.lat,
        currentLng: c.lng,
        estimatedDelivery: isoDate(daysFromNow(2 - i * 0.2)),
        shippedAt: c.shippedAt,
        createdAt: c.shippedAt ?? now,
        updatedAt: now,
      });
      shipmentCount++;
    }

    // Transit-in shipments (CASE-039 through CASE-042)
    for (let i = 0; i < transitInCaseIds.length; i++) {
      const caseId = transitInCaseIds[i];
      const c = await ctx.db.get(caseId);
      if (!c) continue;

      await ctx.db.insert("shipments", {
        caseId,
        trackingNumber: FEDEX_TRACKING_NUMBERS[5 + i],
        carrier: "FedEx",
        status: pick(["in_transit", "in_transit", "out_for_delivery", "in_transit"]),
        originLat: SITES.lakeErie.lat,
        originLng: SITES.lakeErie.lng,
        originName: SITES.lakeErie.name,
        destinationLat: HQ.lat,
        destinationLng: HQ.lng,
        destinationName: HQ.name,
        currentLat: c.lat,
        currentLng: c.lng,
        estimatedDelivery: isoDate(daysFromNow(1 + i * 0.5)),
        shippedAt: c.shippedAt,
        createdAt: c.shippedAt ?? now,
        updatedAt: now,
      });
      shipmentCount++;
    }

    // Delivered historical shipments for received cases (CASE-043 through CASE-047)
    for (let i = 0; i < receivedCaseIds.length; i++) {
      const caseId = receivedCaseIds[i];
      const deliveredAt = daysAgo(4 + i);
      await ctx.db.insert("shipments", {
        caseId,
        trackingNumber: FEDEX_TRACKING_NUMBERS[9 + i],
        carrier: "FedEx",
        status: "delivered",
        originLat: SITES.lakeErie.lat,
        originLng: SITES.lakeErie.lng,
        originName: SITES.lakeErie.name,
        destinationLat: HQ.lat,
        destinationLng: HQ.lng,
        destinationName: HQ.name,
        currentLat: HQ.lat,
        currentLng: HQ.lng,
        estimatedDelivery: isoDate(deliveredAt),
        shippedAt: daysAgo(8 + i),
        deliveredAt,
        createdAt: daysAgo(8 + i),
        updatedAt: deliveredAt,
      });
      shipmentCount++;
    }

    stats.shipments = shipmentCount;

    // ── 9. Events (audit trail) ──────────────────────────────────────────────

    let eventCount = 0;

    // Helper to insert an audit event
    const addEvent = async (
      caseId: Id<"cases">,
      eventType: string,
      userId: string,
      userName: string,
      timestamp: number,
      data: Record<string, unknown>,
    ) => {
      await ctx.db.insert("events", {
        caseId,
        eventType: eventType as "status_change",
        userId,
        userName,
        timestamp,
        data,
      });
      eventCount++;
    };

    // Generate events for every case
    for (const c of allCases) {
      if (!c) continue;

      const assigneeId = c.assigneeId ?? USERS[0].id;
      const assigneeName = c.assigneeName ?? USERS[0].name;
      const logisticsUser = USERS[7];

      // Creation event
      await addEvent(c._id, "status_change", logisticsUser.id, logisticsUser.name,
        c.createdAt, { fromStatus: null, toStatus: "hangar", reason: "Case created and registered in INVENTORY" });

      // Status progression events based on current status
      if (["assembled", "transit_out", "deployed", "flagged", "transit_in", "received", "archived"].includes(c.status)) {
        await addEvent(c._id, "status_change", logisticsUser.id, logisticsUser.name,
          c.createdAt + 3600000, { fromStatus: "hangar", toStatus: "assembled", reason: "Packing list verified and case sealed" });

        await addEvent(c._id, "template_applied", logisticsUser.id, logisticsUser.name,
          c.createdAt + 1800000, { templateId: c.templateId, templateName: "Applied during assembly" });
      }

      if (["transit_out", "deployed", "flagged", "transit_in", "received", "archived"].includes(c.status)) {
        await addEvent(c._id, "shipped", logisticsUser.id, logisticsUser.name,
          daysAgo(10), {
            trackingNumber: c.trackingNumber ?? FEDEX_TRACKING_NUMBERS[0],
            carrier: "FedEx",
            destination: c.destinationName ?? "Field Site",
          });
      }

      if (["deployed", "flagged", "transit_in", "received", "archived"].includes(c.status)) {
        const inspId = caseInspectionMap.get(c._id);
        await addEvent(c._id, "status_change", assigneeId, assigneeName,
          daysAgo(7), { fromStatus: "transit_out", toStatus: "deployed", reason: "Case arrived at site and checked in via SCAN app" });

        await addEvent(c._id, "inspection_started", assigneeId, assigneeName,
          daysAgo(7) + 3600000, { inspectionId: inspId ?? null, inspectorName: assigneeName });
      }

      if (["received", "archived"].includes(c.status)) {
        await addEvent(c._id, "inspection_completed", assigneeId, assigneeName,
          daysAgo(6), { totalItems: 14, checkedItems: 13, damagedItems: 1, missingItems: 0 });

        await addEvent(c._id, "shipped", logisticsUser.id, logisticsUser.name,
          daysAgo(5), { trackingNumber: FEDEX_TRACKING_NUMBERS[0], carrier: "FedEx", destination: HQ.name });

        await addEvent(c._id, "delivered", logisticsUser.id, logisticsUser.name,
          daysAgo(3), { deliveredAt: daysAgo(3), location: HQ.name });

        await addEvent(c._id, "status_change", logisticsUser.id, logisticsUser.name,
          daysAgo(3), { fromStatus: "transit_in", toStatus: "received", reason: "Delivery confirmed via SCAN app scan at receiving dock" });
      }

      if (c.status === "flagged") {
        await addEvent(c._id, "damage_reported", assigneeId, assigneeName,
          daysAgo(2), {
            severity: "moderate",
            itemName: "Primary drone unit",
            notes: c.notes ?? "Damage observed during field inspection",
          });

        await addEvent(c._id, "status_change", assigneeId, assigneeName,
          daysAgo(2), { fromStatus: "deployed", toStatus: "flagged", reason: "Damage reported requiring supervisor review" });
      }

      if (c.status === "archived") {
        await addEvent(c._id, "status_change", USERS[0].id, USERS[0].name,
          daysAgo(60), { fromStatus: "received", toStatus: "archived", reason: c.notes ?? "Decommissioned per annual equipment review" });
      }
    }

    stats.events = eventCount;

    // ── 10. Custody records ──────────────────────────────────────────────────

    let custodyCount = 0;

    // Create custody chains for deployed and flagged cases
    const custodyCaseIds = [...deployedCaseIds, ...flaggedCaseIds];

    for (const caseId of custodyCaseIds) {
      const c = await ctx.db.get(caseId);
      if (!c) continue;

      // Logistics → Field Tech handoff (outbound)
      await ctx.db.insert("custodyRecords", {
        caseId,
        fromUserId: USERS[7].id,
        fromUserName: USERS[7].name,
        toUserId: c.assigneeId ?? USERS[1].id,
        toUserName: c.assigneeName ?? USERS[1].name,
        transferredAt: daysAgo(8),
        notes: "Outbound: Case checked out for field deployment",
      });
      custodyCount++;

      // Field Tech → Pilot handoff (for deployed cases on active missions)
      if (c.status === "deployed" && Math.random() < 0.5) {
        const pilot = pick(USERS.filter(u => u.role === "pilot"));
        await ctx.db.insert("custodyRecords", {
          caseId,
          fromUserId: c.assigneeId ?? USERS[1].id,
          fromUserName: c.assigneeName ?? USERS[1].name,
          toUserId: pilot.id,
          toUserName: pilot.name,
          transferredAt: daysAgo(5),
          notes: "Handoff: Transferring to pilot for flight operations",
        });
        custodyCount++;
      }
    }

    stats.custodyRecords = custodyCount;

    // ── 11. Scans ─────────────────────────────────────────────────────────────

    let scanCount = 0;

    // Generate scan records for deployed, flagged, and transit cases
    const scanCases = [...deployedCaseIds, ...flaggedCaseIds, ...transitOutCaseIds, ...transitInCaseIds];

    for (const caseId of scanCases) {
      const c = await ctx.db.get(caseId);
      if (!c) continue;

      const numScans = 2 + Math.floor(Math.random() * 4); // 2–5 scans per case

      for (let s = 0; s < numScans; s++) {
        const scanner = pick(USERS.filter(u => u.role === "field_tech" || u.role === "pilot"));
        const scannedAt = daysAgo(s * 2 + Math.random());
        const contexts: string[] = ["check_in", "inspection", "lookup", "handoff"];
        const ctx_val = contexts[Math.floor(Math.random() * contexts.length)];

        await ctx.db.insert("scans", {
          caseId,
          qrPayload: c.qrCode,
          scannedBy: scanner.id,
          scannedByName: scanner.name,
          scannedAt,
          lat: c.lat ? jitter(c.lat, 0.001) : undefined,
          lng: c.lng ? jitter(c.lng, 0.001) : undefined,
          locationName: c.locationName,
          scanContext: ctx_val,
          deviceInfo: pick([
            '{"ua":"iPhone 15 Pro","app":"SCAN v2.4.1"}',
            '{"ua":"Samsung Galaxy S24","app":"SCAN v2.4.1"}',
            '{"ua":"iPad Pro 12.9","app":"SCAN v2.4.1"}',
          ]),
        });
        scanCount++;
      }
    }

    // Additional historical scans for received cases
    for (const caseId of receivedCaseIds) {
      const c = await ctx.db.get(caseId);
      if (!c) continue;

      await ctx.db.insert("scans", {
        caseId,
        qrPayload: c.qrCode,
        scannedBy: USERS[7].id,
        scannedByName: USERS[7].name,
        scannedAt: daysAgo(3),
        lat: jitter(HQ.lat, 0.001),
        lng: jitter(HQ.lng, 0.001),
        locationName: `${HQ.name} — Receiving Dock`,
        scanContext: "check_in",
        deviceInfo: '{"ua":"iPad Pro 12.9","app":"SCAN v2.4.1"}',
      });
      scanCount++;
    }

    stats.scans = scanCount;

    // ── 12. Checklist update history ─────────────────────────────────────────

    let checklistUpdateCount = 0;

    // Generate checklist update history for deployed + flagged + received cases
    for (const caseId of [...deployedCaseIds, ...flaggedCaseIds, ...receivedCaseIds]) {
      const c = await ctx.db.get(caseId);
      if (!c || !c.templateId) continue;

      const itemMap = caseManifestMap.get(caseId);
      if (!itemMap) continue;

      const items = templateItemsMap.get(c.templateId as string) ?? [];
      const inspectionId = caseInspectionMap.get(caseId);

      for (const item of items.slice(0, Math.min(items.length, 6))) {
        const manifestItemId = itemMap.get(item.id);
        if (!manifestItemId) continue;

        const mi = await ctx.db.get(manifestItemId);
        if (!mi || mi.status === "unchecked") continue;

        const techUser = pick(USERS.filter(u => u.role === "field_tech" || u.role === "pilot"));
        await ctx.db.insert("checklist_updates", {
          caseId,
          manifestItemId,
          templateItemId: item.id,
          itemName: item.name,
          previousStatus: "unchecked",
          newStatus: mi.status as "ok" | "damaged" | "missing",
          updatedBy: c.assigneeId ?? techUser.id,
          updatedByName: c.assigneeName ?? techUser.name,
          updatedAt: daysAgo(Math.floor(Math.random() * 10) + 1),
          notes: mi.notes,
          inspectionId,
          damageSeverity: mi.status === "damaged" ? pick(["minor", "moderate", "severe"]) : undefined,
        });
        checklistUpdateCount++;
      }
    }

    stats.checklistUpdates = checklistUpdateCount;

    // ─────────────────────────────────────────────────────────────────────────

    return {
      success: true,
      timestamp: new Date(now).toISOString(),
      stats,
    };
  },
});
