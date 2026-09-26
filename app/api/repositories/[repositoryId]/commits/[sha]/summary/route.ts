import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api-errors";
import { rateLimitResponse } from "@/lib/api-rate-limit";
import { gitShaSchema, repositoryIdParamsSchema } from "@/lib/api-validation";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type SummaryRouteProps = {
  params: Promise<{ repositoryId: string; sha: string }>;
};

async function getParams(params: SummaryRouteProps["params"]) {
  const resolved = await params;
  const { repositoryId } = repositoryIdParamsSchema.parse(resolved);
  return {
    repositoryId,
    sha: gitShaSchema.parse(resolved.sha),
  };
}

export async function GET(_request: Request, { params }: SummaryRouteProps) {
  try {
    const { repositoryId, sha } = await getParams(params);
    const service = new CaseRepositoryService(db);
    const summary = await service.getCommitSummary(repositoryId, sha);
    return NextResponse.json({ summary });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: SummaryRouteProps) {
  try {
    const rateLimited = rateLimitResponse(request, "ai");
    if (rateLimited !== null) {
      return rateLimited;
    }

    const { repositoryId, sha } = await getParams(params);
    const service = new CaseRepositoryService(db);
    const summary = await service.generateCommitSummary(repositoryId, sha);
    return NextResponse.json({ summary });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
