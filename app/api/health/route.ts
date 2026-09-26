import { NextResponse } from "next/server";

import { env } from "@/lib/env";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "git-court",
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}
