import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, invalidJsonResponse } from "@/lib/api-errors";
import { rateLimitResponse } from "@/lib/api-rate-limit";
import {
  branchNameSchema,
  gitShaSchema,
  publicHttpsUrlSchema,
  repositoryIdParamsSchema,
} from "@/lib/api-validation";
import { createDemoActor, demoIdentityInputSchema } from "@/lib/demo-identity";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const commitRequestSchema = z.object({
  actor: demoIdentityInputSchema,
  branchName: branchNameSchema,
  parentSha: gitShaSchema.nullable(),
  title: z.string().trim().min(3).max(160),
  content: z.string().trim().min(10).max(20000),
  summary: z.string().trim().min(10).max(500),
  sourceUrl: publicHttpsUrlSchema,
  citation: z.string().trim().min(3).max(500),
  sourceExcerpt: z.string().trim().min(3).max(5000),
  attribution: z.string().trim().min(3).max(300),
});

type CommitRouteProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function POST(request: Request, { params }: CommitRouteProps) {
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

    const input = commitRequestSchema.parse(payload);
    const service = new CaseRepositoryService(db);
    const commit = await service.appendCommit({
      repositoryId,
      branchName: input.branchName,
      actor: createDemoActor(input.actor),
      parentSha: input.parentSha,
      entryType: "student-argument",
      title: input.title,
      content: input.content,
      summary: input.summary,
      publishedAt: new Date(),
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

    return NextResponse.json({ commit }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
