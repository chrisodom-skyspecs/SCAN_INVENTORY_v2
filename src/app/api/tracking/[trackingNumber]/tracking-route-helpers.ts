import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";

import {
  CONVEX_ERROR_CODE_TO_API_CODE,
  TRACKING_API_ERROR_MESSAGES,
  TRACKING_API_STATUS_MAP,
  type TrackingApiErrorBody,
  type TrackingApiErrorCode,
  type TrackingApiResult,
  type TrackingApiSuccessBody,
} from "@/types/tracking-api";
import {
  parseFedExErrorCode,
  type FedExTrackingErrorCode,
} from "@/lib/fedex-tracking-errors";

const REALTIME_CACHE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

export function isValidFedExTrackingNumber(value: string): boolean {
  const tn = value.trim();
  if (!tn) return false;
  if (/^DT\d{12,}$/i.test(tn)) return true;
  if (/^\d{10,}$/.test(tn)) return true;
  return false;
}

export function ok(data: TrackingApiResult): NextResponse<TrackingApiSuccessBody> {
  const body: TrackingApiSuccessBody = { ok: true, data };
  return NextResponse.json(body, {
    status: 200,
    headers: REALTIME_CACHE_HEADERS,
  });
}

export function fail(
  code: TrackingApiErrorCode,
  message?: string,
): NextResponse<TrackingApiErrorBody> {
  const status = TRACKING_API_STATUS_MAP[code];
  const body: TrackingApiErrorBody = {
    ok: false,
    code,
    message: message ?? TRACKING_API_ERROR_MESSAGES[code],
    status,
  };
  return NextResponse.json(body, {
    status,
    headers: REALTIME_CACHE_HEADERS,
  });
}

export function translateConvexError(
  err: unknown,
): NextResponse<TrackingApiErrorBody> {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";

  const convexCode = parseFedExErrorCode(raw);

  if (convexCode === null) {
    if (raw.startsWith("[AUTH_REQUIRED]")) {
      return fail("AUTH_REQUIRED");
    }
    return fail("UNKNOWN_ERROR", raw || undefined);
  }

  const apiCode: TrackingApiErrorCode =
    CONVEX_ERROR_CODE_TO_API_CODE[convexCode as FedExTrackingErrorCode] ??
    "UNKNOWN_ERROR";

  const cleanedMessage = raw.replace(/^\[[A-Z_]+\]\s*/, "").trim();
  return fail(apiCode, cleanedMessage || undefined);
}

export function getConvexClient(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return new ConvexHttpClient(url);
}
