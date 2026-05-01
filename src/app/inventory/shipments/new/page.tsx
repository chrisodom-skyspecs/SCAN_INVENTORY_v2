import type { Metadata } from "next";
import { NewShipmentClient } from "./NewShipmentClient";

export const metadata: Metadata = {
  title: "New Shipment - INVENTORY | SkySpecs",
  description: "Create a hangar outbound shipment bundle.",
};

export default function NewShipmentPage() {
  return <NewShipmentClient />;
}
