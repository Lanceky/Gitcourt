import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { demoCase, getDemoDocketEntries } from "@/lib/demo-case";

type JsonResponse = Record<string, unknown>;
const integrationDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function buildDatabaseUrl(baseUrl: string, schema: string): string {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}schema=${encodeURIComponent(schema)}`;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function request(body: unknown): Request {
  return new Request("https://example.test/api/workflow", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.42",
    },
    body: JSON.stringify(body),
  });
}

async function expectJson(
  response: Response,
  status: number,
): Promise<JsonResponse> {
  assert.equal(response.status, status);
  return (await response.json()) as JsonResponse;
}

test(
  "route-level demo workflow completes from case page through merge",
  { timeout: 120_000, skip: !integrationDatabaseUrl },
  async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "gitcourt-demo-workflow-"),
    );
    const databaseUrl = buildDatabaseUrl(
      integrationDatabaseUrl!,
      `gitcourt_workflow_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    );
    const repositoryRoot = path.join(tempRoot, "repositories");
    const previousEnvironment = {
      DATABASE_URL: process.env.DATABASE_URL,
      GIT_REPOSITORIES_PATH: process.env.GIT_REPOSITORIES_PATH,
      AI_SUMMARY_ENABLED: process.env.AI_SUMMARY_ENABLED,
    };

    process.env.DATABASE_URL = databaseUrl;
    process.env.GIT_REPOSITORIES_PATH = repositoryRoot;
    process.env.AI_SUMMARY_ENABLED = "false";

    try {
      execFileSync(
        "npx",
        [
          "prisma",
          "db",
          "push",
          "--skip-generate",
          "--schema",
          "prisma/schema.prisma",
        ],
        {
          cwd: process.cwd(),
          env: process.env,
          stdio: "ignore",
        },
      );

      const [
        { GET: health },
        { GET: caseApi },
        { default: renderCasePage },
        { POST: fork },
      ] = await Promise.all([
        import("@/app/api/health/route"),
        import("@/app/api/cases/[slug]/route"),
        import("@/app/cases/[slug]/page"),
        import("@/app/api/cases/[slug]/fork/route"),
      ]);
      const [{ POST: createBranch }, { POST: createCommit }] =
        await Promise.all([
          import("@/app/api/repositories/[repositoryId]/branches/route"),
          import("@/app/api/repositories/[repositoryId]/commits/route"),
        ]);
      const [{ POST: createPullRequest }, { POST: reviewPullRequest }] =
        await Promise.all([
          import("@/app/api/repositories/[repositoryId]/pull-requests/route"),
          import("@/app/api/pull-requests/[pullRequestId]/reviews/route"),
        ]);
      const { POST: mergePullRequest } =
        await import("@/app/api/pull-requests/[pullRequestId]/merge/route");

      const healthResponse = await health();
      const healthPayload = await expectJson(healthResponse, 200);
      assert.equal(healthPayload.status, "ok");

      const page = await renderCasePage({
        params: Promise.resolve({ slug: demoCase.slug }),
      });
      assert.ok(page);

      const caseApiResponse = await caseApi(
        new Request(`https://example.test/api/cases/${demoCase.slug}`),
        { params: Promise.resolve({ slug: demoCase.slug }) },
      );
      const caseApiPayload = await expectJson(caseApiResponse, 200);
      assert.equal(
        (caseApiPayload.history as unknown[]).length,
        getDemoDocketEntries().length,
      );

      const startingEntry = getDemoDocketEntries().at(-1);
      assert.ok(startingEntry);
      const actor = {
        displayName: "Route Test Student",
        email: "route.student@gitcourt.test",
      };
      const reviewer = {
        displayName: "Route Test Reviewer",
        email: "route.reviewer@gitcourt.test",
      };
      const forkResponse = await fork(
        request({
          actor,
          slug: `route-test-${Date.now()}`,
          title: `${demoCase.title} Route Test Fork`,
          fromSha: startingEntry.sha,
        }),
        { params: Promise.resolve({ slug: demoCase.slug }) },
      );
      const forkPayload = await expectJson(forkResponse, 200);
      const repository = forkPayload.repository as {
        id: string;
      };
      const forkBranch = forkPayload.branch as {
        headSha: string;
      };
      assert.match(repository.id, /^[A-Za-z0-9_-]+$/);
      assert.match(forkBranch.headSha, /^[0-9a-f]{40}$/);

      const branchResponse = await createBranch(
        request({
          actor,
          name: "route-test-theory",
          fromSha: forkBranch.headSha,
        }),
        { params: Promise.resolve({ repositoryId: repository.id }) },
      );
      const branchPayload = await expectJson(branchResponse, 201);
      const branch = branchPayload.branch as {
        name: string;
        headSha: string;
      };
      assert.equal(branch.name, "route-test-theory");

      const commitResponse = await createCommit(
        request({
          actor,
          branchName: branch.name,
          parentSha: branch.headSha,
          title: "Route test alternate theory",
          content:
            "The route-level exercise tests an alternate reading of the public record.",
          summary: "A route-level student theory.",
          sourceUrl: demoCase.sourceUrl,
          citation: `${demoCase.title}, No. ${demoCase.docketNumber}`,
          sourceExcerpt:
            "The Court considered the public-record issue in this exercise.",
          attribution: demoCase.sourceAttribution,
        }),
        { params: Promise.resolve({ repositoryId: repository.id }) },
      );
      const commitPayload = await expectJson(commitResponse, 201);
      const commit = commitPayload.commit as { sha: string };
      assert.match(commit.sha, /^[0-9a-f]{40}$/);

      const pullRequestResponse = await createPullRequest(
        request({
          actor,
          reviewer,
          sourceBranchName: branch.name,
          targetBranchName: "main",
          title: "Review route test theory",
          description:
            "Review the route-level student interpretation against the source.",
          sourceUrl: demoCase.sourceUrl,
          citation: `${demoCase.title}, No. ${demoCase.docketNumber}`,
          sourceExcerpt:
            "The Court considered the public-record issue in this exercise.",
          attribution: demoCase.sourceAttribution,
        }),
        { params: Promise.resolve({ repositoryId: repository.id }) },
      );
      const pullRequestPayload = await expectJson(pullRequestResponse, 201);
      const pullRequest = pullRequestPayload.pullRequest as {
        id: string;
        status: string;
        citationCheck: { valid: boolean };
      };
      assert.match(pullRequest.id, /^[A-Za-z0-9_-]+$/);
      assert.equal(pullRequest.status, "open");
      assert.equal(pullRequest.citationCheck.valid, true);

      const reviewResponse = await reviewPullRequest(
        request({
          actor: reviewer,
          decision: "approve",
          comment: "The route-level source citation is present.",
        }),
        { params: Promise.resolve({ pullRequestId: pullRequest.id }) },
      );
      const reviewPayload = await expectJson(reviewResponse, 200);
      assert.equal(
        (
          reviewPayload.pullRequest as { reviews: Array<{ decision: string }> }
        ).reviews.at(-1)?.decision,
        "approve",
      );

      const mergeResponse = await mergePullRequest(
        request({ actor: reviewer }),
        { params: Promise.resolve({ pullRequestId: pullRequest.id }) },
      );
      const mergePayload = await expectJson(mergeResponse, 200);
      assert.equal(
        (mergePayload.pullRequest as { status: string }).status,
        "merged",
      );
      assert.match(
        (mergePayload.mergeCommit as { sha: string }).sha,
        /^[0-9a-f]{40}$/,
      );

      const { db } = await import("@/lib/db");
      await db.$disconnect();
    } finally {
      restoreEnvironment("DATABASE_URL", previousEnvironment.DATABASE_URL);
      restoreEnvironment(
        "GIT_REPOSITORIES_PATH",
        previousEnvironment.GIT_REPOSITORIES_PATH,
      );
      restoreEnvironment(
        "AI_SUMMARY_ENABLED",
        previousEnvironment.AI_SUMMARY_ENABLED,
      );
      await rm(tempRoot, { recursive: true, force: true });
    }
  },
);
