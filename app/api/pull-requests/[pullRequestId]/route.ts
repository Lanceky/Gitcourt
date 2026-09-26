import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api-errors";
import { pullRequestIdParamsSchema } from "@/lib/api-validation";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type PullRequestDetailRouteProps = {
  params: Promise<{ pullRequestId: string }>;
};

export async function GET(
  _request: Request,
  { params }: PullRequestDetailRouteProps,
) {
  try {
    const { pullRequestId } = pullRequestIdParamsSchema.parse(await params);
    const service = new CaseRepositoryService(db);
    const pullRequest = await service.getPullRequest(pullRequestId);
    return NextResponse.json({ pullRequest });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
