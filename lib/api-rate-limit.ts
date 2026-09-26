import { NextResponse } from "next/server";

type RateLimitScope = "write" | "ai";

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const defaultLimits: Record<RateLimitScope, RateLimitOptions> = {
  write: { limit: 30, windowMs: 60_000 },
  ai: { limit: 10, windowMs: 60_000 },
};

const globalForRateLimits = globalThis as typeof globalThis & {
  gitCourtRateLimitBuckets?: Map<string, RateLimitBucket>;
};

const buckets =
  globalForRateLimits.gitCourtRateLimitBuckets ??
  new Map<string, RateLimitBucket>();

globalForRateLimits.gitCourtRateLimitBuckets = buckets;

function pruneExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function clientKey(request: Request): string {
  const forwardedFor =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "anonymous";
  return forwardedFor.split(",")[0]?.trim().slice(0, 128) || "anonymous";
}

export function rateLimitResponse(
  request: Request,
  scope: RateLimitScope,
  options: Partial<RateLimitOptions> = {},
): NextResponse | null {
  const configured = { ...defaultLimits[scope], ...options };
  const now = Date.now();
  if (buckets.size > 1_000) {
    pruneExpiredBuckets(now);
  }
  const key = `${scope}:${clientKey(request)}`;
  const current = buckets.get(key);

  if (current === undefined || current.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + configured.windowMs,
    });
    return null;
  }

  if (current.count >= configured.limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      {
        code: "RATE_LIMITED",
        error: "Too many requests. Please wait before trying again.",
      },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(retryAfter),
        },
      },
    );
  }

  current.count += 1;
  return null;
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
