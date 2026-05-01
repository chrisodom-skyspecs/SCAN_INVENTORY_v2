import type { Metadata } from "next";
import { ShipmentsPageClient } from "./ShipmentsPageClient";

export const metadata: Metadata = {
  title: "Shipments - INVENTORY | SkySpecs",
  description: "Hangar-created outbound shipment bundles grouped by unit.",
};

export default function ShipmentsPage() {
  return <ShipmentsPageClient />;
}
