import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, invalidJsonResponse } from "@/lib/api-errors";
import { rateLimitResponse } from "@/lib/api-rate-limit";
import {
  branchNameSchema,
  gitShaSchema,
  repositoryIdParamsSchema,
} from "@/lib/api-validation";
import { createDemoActor, demoIdentityInputSchema } from "@/lib/demo-identity";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const branchRequestSchema = z.object({
  actor: demoIdentityInputSchema,
  name: branchNameSchema.min(3),
  fromSha: gitShaSchema,
});

type BranchRouteProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function POST(request: Request, { params }: BranchRouteProps) {
  try {
    const rateLimited = rateLimitResponse(request, "write");
    if (rateLimited !== null) {
      return rateLimited;
    }

    const { repositoryId } = repositoryIdParamsSchema.parse(await params);
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return invalidJsonResponse();
    }

    const input = branchRequestSchema.parse(payload);
    const service = new CaseRepositoryService(db);
    const branch = await service.createBranch({
      repositoryId,
      name: input.name,
      actor: createDemoActor(input.actor),
      fromSha: input.fromSha,
    });

    return NextResponse.json({ branch }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
