import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, invalidJsonResponse } from "@/lib/api-errors";
import { rateLimitResponse } from "@/lib/api-rate-limit";
import { pullRequestIdParamsSchema } from "@/lib/api-validation";
import { createDemoActor, demoIdentityInputSchema } from "@/lib/demo-identity";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const reviewRequestSchema = z.object({
  actor: demoIdentityInputSchema,
  decision: z.enum(["approve", "request_changes", "comment"]),
  comment: z.string().trim().max(5000).optional(),
});

type ReviewRouteProps = {
  params: Promise<{ pullRequestId: string }>;
};

export async function POST(request: Request, { params }: ReviewRouteProps) {
  try {
    const rateLimited = rateLimitResponse(request, "write");
    if (rateLimited !== null) {
      return rateLimited;
    }

    const { pullRequestId } = pullRequestIdParamsSchema.parse(await params);
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return invalidJsonResponse();
    }

    const input = reviewRequestSchema.parse(payload);
    const service = new CaseRepositoryService(db);
    const pullRequest = await service.reviewPullRequest({
      pullRequestId,
      actor: createDemoActor(input.actor, "reviewer"),
      decision: input.decision,
      comment: input.comment,
    });

    return NextResponse.json({ pullRequest });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
