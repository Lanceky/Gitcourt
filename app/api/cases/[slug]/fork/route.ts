import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, invalidJsonResponse } from "@/lib/api-errors";
import { db } from "@/lib/db";
import { demoCase, getDemoDocketEntries } from "@/lib/demo-case";
import { createDemoActor, demoIdentityInputSchema } from "@/lib/demo-identity";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { importPublicCase } from "@/lib/import/public-case";

export const runtime = "nodejs";

const forkRequestSchema = z.object({
  actor: demoIdentityInputSchema,
  slug: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers, and hyphens for the fork slug.",
    ),
  title: z.string().trim().min(3).max(120),
  fromSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i),
});

type ForkRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function POST(request: Request, { params }: ForkRouteProps) {
  try {
    const { slug } = await params;
    if (slug !== demoCase.slug) {
      return NextResponse.json(
        {
          code: "REPOSITORY_NOT_FOUND",
          error: "The public case was not found.",
        },
        { status: 404 },
      );
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return invalidJsonResponse();
    }

    const input = forkRequestSchema.parse(payload);
    const imported = await importPublicCase(db, demoCase);
    const service = new CaseRepositoryService(db);
    const selectedFixtureEntry = getDemoDocketEntries().find(
      (entry) => entry.sha === input.fromSha,
    );
    const sourceHistory =
      selectedFixtureEntry === undefined
        ? null
        : await service.getHistory(imported.repositoryId, "main");
    const startingCommit =
      selectedFixtureEntry === undefined
        ? input.fromSha
        : sourceHistory?.find(
            (commit) =>
              commit.title === selectedFixtureEntry.title &&
              commit.publishedAt
                .toISOString()
                .startsWith(selectedFixtureEntry.date),
          )?.sha;

    if (startingCommit === undefined) {
      return NextResponse.json(
        {
          code: "COMMIT_NOT_FOUND",
          error:
            "The selected public milestone is not available in the repository.",
        },
        { status: 404 },
      );
    }

    const repository = await service.forkRepository({
      sourceRepositoryId: imported.repositoryId,
      slug: input.slug,
      title: input.title,
      actor: createDemoActor(input.actor),
      fromSha: startingCommit,
      isPublic: false,
    });
    const branch = await db.branch.findUnique({
      where: {
        repositoryId_name: {
          repositoryId: repository.id,
          name: "main",
        },
      },
      include: { headCommit: { select: { sha: true } } },
    });

    return NextResponse.json({
      repository,
      branch:
        branch === null
          ? null
          : {
              name: branch.name,
              headSha: branch.headCommit?.sha ?? null,
              isProtected: branch.isProtected,
            },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
