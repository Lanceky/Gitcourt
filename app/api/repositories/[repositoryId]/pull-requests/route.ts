import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, invalidJsonResponse } from "@/lib/api-errors";
import { createDemoActor, demoIdentityInputSchema } from "@/lib/demo-identity";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const publicHttpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Public sources must use HTTPS URLs.",
  });

const pullRequestRequestSchema = z.object({
  actor: demoIdentityInputSchema,
  reviewer: demoIdentityInputSchema.optional(),
  sourceBranchName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use a safe Git branch name."),
  targetBranchName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use a safe Git branch name."),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000),
  sourceUrl: publicHttpsUrl,
  citation: z.string().trim().min(3).max(500),
  sourceExcerpt: z.string().trim().min(3).max(5000),
  attribution: z.string().trim().min(3).max(300),
});

type PullRequestRouteProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function GET(
  _request: Request,
  { params }: PullRequestRouteProps,
) {
  try {
    const { repositoryId } = await params;
    const service = new CaseRepositoryService(db);
    const pullRequests = await service.listPullRequests(repositoryId);
    return NextResponse.json({ pullRequests });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: PullRequestRouteProps,
) {
  try {
    const { repositoryId } = await params;
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return invalidJsonResponse();
    }

    const input = pullRequestRequestSchema.parse(payload);
    const service = new CaseRepositoryService(db);
    const pullRequest = await service.createPullRequest({
      repositoryId,
      sourceBranchName: input.sourceBranchName,
      targetBranchName: input.targetBranchName,
      actor: createDemoActor(input.actor),
      reviewer:
        input.reviewer === undefined
          ? undefined
          : createDemoActor(input.reviewer, "reviewer"),
      title: input.title,
      description: input.description,
      provenance: {
        kind: "student-argument",
        url: input.sourceUrl,
        citation: input.citation,
        documentHash: `sha256:${createHash("sha256")
          .update(input.sourceExcerpt, "utf8")
          .digest("hex")}`,
        attribution: input.attribution,
        isPublicRecord: true,
      },
    });

    return NextResponse.json({ pullRequest }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
