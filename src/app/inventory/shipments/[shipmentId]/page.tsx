import type { Metadata } from "next";
import { ShipmentDetailClient } from "./ShipmentDetailClient";

export const metadata: Metadata = {
  title: "Shipment Detail - INVENTORY | SkySpecs",
};

export default function ShipmentDetailPage() {
  return <ShipmentDetailClient />;
}
