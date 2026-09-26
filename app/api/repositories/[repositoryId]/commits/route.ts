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

const commitRequestSchema = z.object({
  actor: demoIdentityInputSchema,
  branchName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use a safe Git branch name."),
  parentSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .nullable(),
  title: z.string().trim().min(3).max(160),
  content: z.string().trim().min(10).max(20000),
  summary: z.string().trim().min(10).max(500),
  sourceUrl: publicHttpsUrl,
  citation: z.string().trim().min(3).max(500),
  sourceExcerpt: z.string().trim().min(3).max(5000),
  attribution: z.string().trim().min(3).max(300),
});

type CommitRouteProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function POST(request: Request, { params }: CommitRouteProps) {
  try {
    const { repositoryId } = await params;
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
