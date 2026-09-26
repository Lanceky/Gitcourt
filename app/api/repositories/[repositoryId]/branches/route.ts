import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, invalidJsonResponse } from "@/lib/api-errors";
import { createDemoActor, demoIdentityInputSchema } from "@/lib/demo-identity";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const branchRequestSchema = z.object({
  actor: demoIdentityInputSchema,
  name: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use a safe Git branch name."),
  fromSha: z.string().regex(/^[0-9a-f]{40}$/i),
});

type BranchRouteProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function POST(request: Request, { params }: BranchRouteProps) {
  try {
    const { repositoryId } = await params;
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
