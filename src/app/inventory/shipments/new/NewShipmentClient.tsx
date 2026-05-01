"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { StatusPill } from "@/components/StatusPill";
import styles from "../Shipments.module.css";

type UnitMode = "existing" | "new";
type SaveMode = "draft" | "release";

const DEPLOYABLE_CASE_STATUSES = new Set(["hangar", "assembled", "received"]);

export function NewShipmentClient() {
  const router = useRouter();
  const units = useQuery(api.units.listUnits, {});
  const missions = useQuery(api.missions.listMissions, {});
  const cases = useQuery(api.cases.listCases, {});

  const createUnit = useMutation(api.units.createUnit);
  const createShipment = useMutation(api.outboundShipments.createOutboundShipment);
  const releaseShipment = useMutation(api.outboundShipments.releaseOutboundShipment);

  const [unitMode, setUnitMode] = useState<UnitMode>("existing");
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [platform, setPlatform] = useState<"ForeSight" | "SkyCrawler">("ForeSight");
  const [version, setVersion] = useState("V2");
  const [nickname, setNickname] = useState("");
  const [faaRegistration, setFaaRegistration] = useState("");
  const [pairedBeakon, setPairedBeakon] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [destinationMissionId, setDestinationMissionId] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientUserId, setRecipientUserId] = useState("");
  const [routeReason, setRouteReason] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedUnit = units?.find((unit) => unit._id === selectedUnitId);
  const selectedMission = missions?.find((mission) => mission._id === destinationMissionId);

  const eligibleCases = useMemo(() => {
    if (!cases) return [];
    return cases.filter((caseDoc) => {
      if (!DEPLOYABLE_CASE_STATUSES.has(caseDoc.status)) return false;
      if (unitMode === "existing" && selectedUnitId) {
        return !caseDoc.unitId || caseDoc.unitId === selectedUnitId;
      }
      return true;
    });
  }, [cases, selectedUnitId, unitMode]);

  const selectedCases = useMemo(
    () => eligibleCases.filter((caseDoc) => selectedCaseIds.includes(caseDoc._id)),
    [eligibleCases, selectedCaseIds],
  );

  const toggleCase = (caseId: string) => {
    setSelectedCaseIds((current) =>
      current.includes(caseId)
        ? current.filter((id) => id !== caseId)
        : [...current, caseId],
    );
  };

  const submit = async (mode: SaveMode) => {
    setError(null);
    setIsSubmitting(true);
    try {
      let unitId = selectedUnitId as Id<"units">;
      if (unitMode === "new") {
        unitId = await createUnit({
          unitId: unitCode,
          assetType: platform === "ForeSight" ? "aircraft" : "rover",
          platform,
          version: platform === "ForeSight" ? version : undefined,
          nickname: nickname || undefined,
          faaRegistration: platform === "ForeSight" ? faaRegistration || undefined : undefined,
          pairedBeakon: pairedBeakon || undefined,
          serialNumber: serialNumber || undefined,
          homeBase: "SkySpecs Hangar - Ann Arbor, MI",
          currentMissionId: destinationMissionId
            ? (destinationMissionId as Id<"missions">)
            : undefined,
        });
      }

      if (!unitId) {
        throw new Error("Choose or create a unit before saving the shipment.");
      }
      if (selectedCaseIds.length === 0) {
        throw new Error("Add at least one case to the shipment.");
      }

      const shipmentId = await createShipment({
        unitId,
        originName: "SkySpecs Hangar - Ann Arbor, MI",
        destinationMissionId: destinationMissionId
          ? (destinationMissionId as Id<"missions">)
          : undefined,
        destinationName: destinationName || selectedMission?.locationName || selectedMission?.name,
        destinationLat: selectedMission?.lat,
        destinationLng: selectedMission?.lng,
        recipientUserId: recipientUserId || undefined,
        recipientName: recipientName || undefined,
        caseIds: selectedCaseIds.map((caseId) => caseId as Id<"cases">),
        routeReason: routeReason || undefined,
        notes: notes || undefined,
      });

      if (mode === "release") {
        await releaseShipment({ shipmentId, notes: notes || undefined });
      }

      router.push(`/inventory/shipments/${shipmentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create shipment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit("draft");
  };

  return (
    <main className={styles.root} aria-label="Create outbound shipment">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Hangar workflow</p>
          <h1 className={styles.title}>New outbound shipment</h1>
          <p className={styles.subtitle}>
            Build the unit bundle that leaves the hangar together. Carrier labels
            can still be created per case from SCAN when needed.
          </p>
        </div>
        <Link className={styles.secondaryButton} href="/inventory/shipments">
          Back to shipments
        </Link>
      </header>

      <form className={styles.form} onSubmit={handleSubmit}>
        {error && <div className={styles.error}>{error}</div>}

        <section className={styles.panel}>
          <div className={styles.table}>
            <div className={styles.stepGrid} style={{ padding: "1rem" }}>
              <div className={styles.field}>
                <label htmlFor="unitMode">Unit source</label>
                <select
                  id="unitMode"
                  className={styles.select}
                  value={unitMode}
                  onChange={(event) => setUnitMode(event.target.value as UnitMode)}
                >
                  <option value="existing">Use existing unit</option>
                  <option value="new">Create new unit</option>
                </select>
              </div>

              {unitMode === "existing" ? (
                <div className={styles.field}>
                  <label htmlFor="unit">Unit</label>
                  <select
                    id="unit"
                    className={styles.select}
                    value={selectedUnitId}
                    onChange={(event) => setSelectedUnitId(event.target.value)}
                  >
                    <option value="">Choose unit</option>
                    {(units ?? []).map((unit) => (
                      <option key={unit._id} value={unit._id}>
                        {unit.unitId}
                        {unit.nickname ? ` "${unit.nickname}"` : ""}
                        {unit.faaRegistration ? ` (${unit.faaRegistration})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className={styles.field}>
                    <label htmlFor="unitCode">Unit ID</label>
                    <input
                      id="unitCode"
                      className={styles.input}
                      value={unitCode}
                      onChange={(event) => setUnitCode(event.target.value)}
                      placeholder="FS-104 or SC-204"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="platform">Platform</label>
                    <select
                      id="platform"
                      className={styles.select}
                      value={platform}
                      onChange={(event) =>
                        setPlatform(event.target.value as "ForeSight" | "SkyCrawler")
                      }
                    >
                      <option value="ForeSight">ForeSight</option>
                      <option value="SkyCrawler">SkyCrawler</option>
                    </select>
                  </div>
                  {platform === "ForeSight" && (
                    <div className={styles.field}>
                      <label htmlFor="version">Version</label>
                      <select
                        id="version"
                        className={styles.select}
                        value={version}
                        onChange={(event) => setVersion(event.target.value)}
                      >
                        <option value="V1">V1</option>
                        <option value="V2">V2</option>
                      </select>
                    </div>
                  )}
                  <div className={styles.field}>
                    <label htmlFor="nickname">Nickname</label>
                    <input
                      id="nickname"
                      className={styles.input}
                      value={nickname}
                      onChange={(event) => setNickname(event.target.value)}
                      placeholder="Lakefly"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="faaRegistration">FAA registration</label>
                    <input
                      id="faaRegistration"
                      className={styles.input}
                      value={faaRegistration}
                      onChange={(event) => setFaaRegistration(event.target.value)}
                      placeholder="N104FS"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="pairedBeakon">Paired Beakon</label>
                    <input
                      id="pairedBeakon"
                      className={styles.input}
                      value={pairedBeakon}
                      onChange={(event) => setPairedBeakon(event.target.value)}
                      placeholder="BK-4104"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="serialNumber">Serial number</label>
                    <input
                      id="serialNumber"
                      className={styles.input}
                      value={serialNumber}
                      onChange={(event) => setSerialNumber(event.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.stepGrid} style={{ padding: "1rem" }}>
            <div className={styles.field}>
              <label htmlFor="mission">Destination mission</label>
              <select
                id="mission"
                className={styles.select}
                value={destinationMissionId}
                onChange={(event) => {
                  setDestinationMissionId(event.target.value);
                  const mission = missions?.find((item) => item._id === event.target.value);
                  if (mission?.locationName) setDestinationName(mission.locationName);
                }}
              >
                <option value="">Freeform destination</option>
                {(missions ?? []).map((mission) => (
                  <option key={mission._id} value={mission._id}>
                    {mission.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="destination">Destination</label>
              <input
                id="destination"
                className={styles.input}
                value={destinationName}
                onChange={(event) => setDestinationName(event.target.value)}
                placeholder="Site, airport, or field office"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="recipient">Recipient</label>
              <input
                id="recipient"
                className={styles.input}
                value={recipientName}
                onChange={(event) => setRecipientName(event.target.value)}
                placeholder="Pilot or field tech"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="recipientUserId">Recipient user ID</label>
              <input
                id="recipientUserId"
                className={styles.input}
                value={recipientUserId}
                onChange={(event) => setRecipientUserId(event.target.value)}
                placeholder="Optional Kinde user id"
              />
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div style={{ padding: "1rem" }}>
            <p className={styles.eyebrow}>Cases</p>
            <div className={styles.caseList}>
              {eligibleCases.length === 0 ? (
                <p className={styles.muted}>No hangar-ready cases match this unit yet.</p>
              ) : (
                eligibleCases.map((caseDoc) => (
                  <label className={styles.caseOption} key={caseDoc._id}>
                    <input
                      type="checkbox"
                      checked={selectedCaseIds.includes(caseDoc._id)}
                      onChange={() => toggleCase(caseDoc._id)}
                    />
                    <span>
                      <strong>{caseDoc.label}</strong>{" "}
                      <StatusPill kind={caseDoc.status} />
                      <br />
                      <span className={styles.muted}>{caseDoc.locationName}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div style={{ padding: "1rem" }}>
            <p className={styles.eyebrow}>Review</p>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryCard}>
                <strong>Unit</strong>
                <div className={styles.muted}>
                  {unitMode === "existing"
                    ? selectedUnit?.unitId ?? "Not selected"
                    : unitCode || "New unit"}
                </div>
              </div>
              <div className={styles.summaryCard}>
                <strong>Destination</strong>
                <div className={styles.muted}>
                  {destinationName || selectedMission?.locationName || "Not set"}
                </div>
              </div>
              <div className={styles.summaryCard}>
                <strong>Cases</strong>
                <div className={styles.mono}>{selectedCases.length}</div>
              </div>
            </div>
            <div className={styles.stepGrid} style={{ marginTop: "1rem" }}>
              <div className={styles.field}>
                <label htmlFor="routeReason">Route reason</label>
                <input
                  id="routeReason"
                  className={styles.input}
                  value={routeReason}
                  onChange={(event) => setRouteReason(event.target.value)}
                  placeholder="Outbound deployment, handoff, maintenance..."
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="notes">Notes</label>
                <textarea
                  id="notes"
                  className={styles.textarea}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Any instructions for the recipient"
                />
              </div>
            </div>
          </div>
        </section>

        <div className={styles.actions}>
          <button className={styles.secondaryButton} type="submit" disabled={isSubmitting}>
            Save draft
          </button>
          <button
            className={styles.button}
            type="button"
            disabled={isSubmitting}
            onClick={() => void submit("release")}
          >
            Release shipment
          </button>
        </div>
      </form>
    </main>
  );
}
