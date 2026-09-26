import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, invalidJsonResponse } from "@/lib/api-errors";
import { createDemoActor, demoIdentityInputSchema } from "@/lib/demo-identity";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const mergeRequestSchema = z.object({
  actor: demoIdentityInputSchema,
});

type MergeRouteProps = {
  params: Promise<{ pullRequestId: string }>;
};

export async function POST(request: Request, { params }: MergeRouteProps) {
  try {
    const { pullRequestId } = await params;
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return invalidJsonResponse();
    }

    const input = mergeRequestSchema.parse(payload);
    const service = new CaseRepositoryService(db);
    const result = await service.mergePullRequest({
      pullRequestId,
      actor: createDemoActor(input.actor, "reviewer"),
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
