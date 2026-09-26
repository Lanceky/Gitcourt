import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api-errors";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type AuditRouteProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function GET(request: Request, { params }: AuditRouteProps) {
  try {
    const { repositoryId } = await params;
    const service = new CaseRepositoryService(db);
    const events = await service.listAuditEvents(repositoryId);
    return NextResponse.json({ events });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
