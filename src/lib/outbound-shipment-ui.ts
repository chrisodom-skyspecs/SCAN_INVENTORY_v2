import type { StatusKind } from "@/components/StatusPill";

export const OUTBOUND_SHIPMENT_STATUS_KIND: Record<string, StatusKind> = {
  draft: "pending",
  assembled: "assembled",
  released: "active",
  in_transit: "in_transit",
  delivered: "delivered",
  cancelled: "cancelled",
};

export function labelForOutboundShipmentStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatOutboundShipmentDate(value?: number) {
  if (!value) return "Not released";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
