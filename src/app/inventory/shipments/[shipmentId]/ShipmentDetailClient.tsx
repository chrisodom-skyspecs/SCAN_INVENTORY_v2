"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { StatusPill } from "@/components/StatusPill";
import {
  formatOutboundShipmentDate,
  labelForOutboundShipmentStatus,
  OUTBOUND_SHIPMENT_STATUS_KIND,
} from "@/lib/outbound-shipment-ui";
import styles from "../Shipments.module.css";

export function ShipmentDetailClient() {
  const params = useParams<{ shipmentId: string }>();
  const shipmentId = params.shipmentId as Id<"outboundShipments">;
  const shipment = useQuery(api.outboundShipments.getOutboundShipmentById, {
    shipmentId,
  });
  const releaseShipment = useMutation(api.outboundShipments.releaseOutboundShipment);
  const [isReleasing, setIsReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRelease = shipment?.status === "draft" || shipment?.status === "assembled";

  const handleRelease = async () => {
    if (!shipment) return;
    setError(null);
    setIsReleasing(true);
    try {
      await releaseShipment({ shipmentId: shipment._id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to release shipment.");
    } finally {
      setIsReleasing(false);
    }
  };

  return (
    <main className={styles.root} aria-label="Shipment detail">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Outbound shipment</p>
          <h1 className={styles.title}>
            {shipment === undefined
              ? "Loading shipment..."
              : shipment
                ? shipment.displayName
                : "Shipment not found"}
          </h1>
          {shipment && (
            <p className={styles.subtitle}>
              {shipment.destinationName ?? "Destination TBD"} -{" "}
              {shipment.recipientName ?? "recipient unassigned"}
            </p>
          )}
        </div>
        <div className={styles.actions}>
          <Link className={styles.secondaryButton} href="/inventory/shipments">
            Back
          </Link>
          {shipment && canRelease && (
            <button
              className={styles.button}
              type="button"
              disabled={isReleasing}
              onClick={() => void handleRelease()}
            >
              Release
            </button>
          )}
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      {shipment === undefined ? (
        <section className={styles.panel}>
          <div className={styles.empty}>Loading...</div>
        </section>
      ) : shipment === null ? (
        <section className={styles.panel}>
          <div className={styles.empty}>No shipment exists for this id.</div>
        </section>
      ) : (
        <>
          <section className={styles.summaryGrid}>
            <div className={styles.summaryCard}>
              <strong>Status</strong>
              <div className={styles.statusPillRow}>
                <StatusPill
                  kind={OUTBOUND_SHIPMENT_STATUS_KIND[shipment.status] ?? "pending"}
                  label={labelForOutboundShipmentStatus(shipment.status)}
                />
              </div>
            </div>
            <div className={styles.summaryCard}>
              <strong>Unit</strong>
              <div className={styles.muted}>
                {shipment.unit?.platform ?? "Unit"} {shipment.unit?.version ?? ""}
                {shipment.unit?.pairedBeakon ? ` - ${shipment.unit.pairedBeakon}` : ""}
              </div>
            </div>
            <div className={styles.summaryCard}>
              <strong>Released</strong>
              <div className={styles.muted}>
                {formatOutboundShipmentDate(shipment.releasedAt)}
              </div>
            </div>
          </section>

          <section className={styles.panel}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Current holder</th>
                  <th>Verify</th>
                </tr>
              </thead>
              <tbody>
                {shipment.cases.map((caseDoc) => (
                  <tr key={caseDoc._id}>
                    <td>
                      <Link
                        className={styles.primaryText}
                        href={`/inventory?case=${caseDoc._id}&panel=1`}
                      >
                        {caseDoc.label}
                      </Link>
                    </td>
                    <td>
                      <StatusPill kind={caseDoc.status} />
                    </td>
                    <td>{caseDoc.locationName ?? "Unknown"}</td>
                    <td>{caseDoc.assigneeName ?? "Unassigned"}</td>
                    <td>
                      <div className={styles.caseLinks}>
                        <Link
                          className={styles.subtleLink}
                          href={`/inventory?case=${caseDoc._id}&panel=1`}
                        >
                          Inventory
                        </Link>
                        <Link
                          className={styles.subtleLink}
                          href={`/scan/${caseDoc._id}`}
                        >
                          SCAN
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
