import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse } from "@/lib/api-errors";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const shaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/i, "Use a full Git commit SHA.");

type SummaryRouteProps = {
  params: Promise<{ repositoryId: string; sha: string }>;
};

async function getParams(params: SummaryRouteProps["params"]) {
  const resolved = await params;
  return {
    repositoryId: resolved.repositoryId,
    sha: shaSchema.parse(resolved.sha),
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

export async function POST(_request: Request, { params }: SummaryRouteProps) {
  try {
    const { repositoryId, sha } = await getParams(params);
    const service = new CaseRepositoryService(db);
    const summary = await service.generateCommitSummary(repositoryId, sha);
    return NextResponse.json({ summary });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
