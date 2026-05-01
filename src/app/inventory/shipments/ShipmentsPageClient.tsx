"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { StatusPill } from "@/components/StatusPill";
import {
  formatOutboundShipmentDate,
  labelForOutboundShipmentStatus,
  OUTBOUND_SHIPMENT_STATUS_KIND,
} from "@/lib/outbound-shipment-ui";
import styles from "./Shipments.module.css";

export function ShipmentsPageClient() {
  const shipments = useQuery(api.outboundShipments.listOutboundShipments, {});

  return (
    <main className={styles.root} aria-label="Outbound shipments">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Hangar</p>
          <h1 className={styles.title}>Outbound Shipments</h1>
          <p className={styles.subtitle}>
            Build one shipment bundle around a unit identity, then include the
            GSC, aircraft or rover case, charger or support case, and battery cases.
          </p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.button} href="/inventory/shipments/new">
            + New shipment
          </Link>
        </div>
      </header>

      <section className={styles.panel} aria-live="polite">
        {shipments === undefined ? (
          <div className={styles.empty}>Loading outbound shipments...</div>
        ) : shipments.length === 0 ? (
          <div className={styles.empty}>
            No outbound shipments yet. Create one from the hangar workflow.
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Shipment</th>
                <th>Status</th>
                <th>Destination</th>
                <th>Recipient</th>
                <th>Cases</th>
                <th>Released</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((shipment) => (
                <tr key={shipment._id}>
                  <td>
                    <Link
                      className={styles.primaryText}
                      href={`/inventory/shipments/${shipment._id}`}
                    >
                      {shipment.displayName}
                    </Link>
                    <div className={styles.muted}>
                      {shipment.unit?.platform ?? "Unit"}{" "}
                      {shipment.unit?.version ?? ""}
                      {shipment.unit?.pairedBeakon
                        ? ` - ${shipment.unit.pairedBeakon}`
                        : ""}
                    </div>
                  </td>
                  <td>
                    <StatusPill
                      kind={OUTBOUND_SHIPMENT_STATUS_KIND[shipment.status] ?? "pending"}
                      label={labelForOutboundShipmentStatus(shipment.status)}
                    />
                  </td>
                  <td>{shipment.destinationName ?? "Destination TBD"}</td>
                  <td>{shipment.recipientName ?? "Unassigned"}</td>
                  <td className={styles.mono}>{shipment.caseIds.length}</td>
                  <td>{formatOutboundShipmentDate(shipment.releasedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
