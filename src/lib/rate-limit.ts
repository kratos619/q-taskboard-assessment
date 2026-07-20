import { NextRequest, NextResponse } from "next/server";

// ponytail: in-memory fixed-window counter, per-process only. Fine for a single
// instance; swap the Map for Redis/Upstash if you scale horizontally.
const hits = new Map<string, { count: number; resetAt: number }>();

/** Returns true if the key is still under `limit` within `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}

export function tooManyRequests(message = "too many requests") {
  return NextResponse.json({ error: message }, { status: 429 });
}
