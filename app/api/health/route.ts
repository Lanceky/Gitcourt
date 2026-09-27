import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  try {
    await db.$queryRaw(Prisma.sql`SELECT 1`);

    return NextResponse.json({
      status: "ok",
      service: "git-court",
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error(
      "Git Court health check could not reach the database.",
      error,
    );

    return NextResponse.json(
      {
        code: "DATABASE_UNAVAILABLE",
        status: "error",
        service: "git-court",
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
