import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { demoCase } from "@/lib/demo-case";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { DomainError } from "@/lib/domain/errors";
import type { Actor, CommitProvenance } from "@/lib/domain/types";
import { IsomorphicGitRepositoryAdapter } from "@/lib/git/isomorphic-git-adapter";

const student: Actor = {
  id: "step-five-student",
  displayName: "Step Five Student",
  email: "student@gitcourt.test",
  role: "student",
};

const reviewer: Actor = {
  id: "step-five-reviewer",
  displayName: "Step Five Reviewer",
  email: "reviewer@gitcourt.test",
  role: "reviewer",
};

const provenance: CommitProvenance = {
  kind: "student-argument",
  url: "https://example.test/public-case",
  citation: "Example v. Example, No. TEST-5, Public case fixture",
  documentHash: "sha256:step-five",
  attribution: "Public case fixture source",
  isPublicRecord: true,
};

function expectDomainError(code: string, callback: () => Promise<unknown>) {
  return assert.rejects(callback, (error: unknown) => {
    return error instanceof DomainError && error.code === code;
  });
}

test("Git Court service keeps Prisma metadata and Git history synchronized", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gitcourt-step-five-"));
  const databasePath = path.join(tempRoot, "service.db");
  const repositoryRoot = path.join(tempRoot, "repositories");
  const database = new PrismaClient({
    datasourceUrl: `file:${databasePath}`,
  });

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
        env: {
          ...process.env,
          DATABASE_URL: `file:${databasePath}`,
        },
        stdio: "ignore",
      },
    );

    const adapter = new IsomorphicGitRepositoryAdapter(repositoryRoot);
    const service = new CaseRepositoryService(database, adapter, null);
    const repository = await service.createRepository({
      slug: "step-five-service",
      title: "Step Five Service Case",
      court: "Test Court",
      docketNumber: "TEST-5",
      jurisdiction: "Test",
      actor: student,
      isPublic: true,
    });

    const initial = await service.appendCommit({
      repositoryId: repository.id,
      branchName: "main",
      actor: student,
      parentSha: null,
      entryType: "argument",
      title: "Initial standing theory",
      content: "The public record supports the initial theory.",
      documentPath: "arguments/standing.md",
      summary: "Initial student theory",
      provenance,
    });

    assert.match(initial.sha, /^[0-9a-f]{40}$/);
    assert.deepEqual(
      await adapter.getBranchHead(repository.id, "main"),
      initial.sha,
    );
    assert.match(
      (await adapter.readFile(
        repository.id,
        initial.sha,
        initial.documentPath,
      )) ?? "",
      /entryType: "argument"/,
    );
    const initialSummary = await service.getCommitSummary(
      repository.id,
      initial.sha,
    );
    assert.equal(initialSummary.aiStatus, "manual-fallback");
    assert.equal(initialSummary.aiSourceCommitSha, initial.sha);
    assert.equal(initialSummary.aiSummary, "Initial student theory");

    const feature = await service.createBranch({
      repositoryId: repository.id,
      name: "alternate-standing",
      actor: student,
    });
    assert.equal(feature.headSha, initial.sha);

    const alternate = await service.appendCommit({
      repositoryId: repository.id,
      branchName: "alternate-standing",
      actor: student,
      parentSha: initial.sha,
      entryType: "argument",
      title: "Initial standing theory",
      content: "The alternate public-record theory supports standing.",
      documentPath: "arguments/standing.md",
      summary: "Alternate student theory",
      provenance,
    });

    const history = await service.getHistory(
      repository.id,
      "alternate-standing",
    );
    assert.equal(history.length, 2);
    assert.equal(history[0].sha, alternate.sha);
    assert.equal(history[0].docketLabel, "argument: Initial standing theory");

    const diff = await service.getDiff(
      repository.id,
      initial.sha,
      alternate.sha,
    );
    assert.equal(diff.length, 1);
    assert.ok(diff[0].lines.some((line) => line.type === "addition"));
    assert.ok(diff[0].lines.some((line) => line.type === "deletion"));

    const blame = await service.blame(
      repository.id,
      "alternate-standing",
      "arguments/standing.md",
    );
    assert.ok(blame.some((line) => line.commit.sha === alternate.sha));
    assert.ok(blame.every((line, index) => line.lineNumber === index + 1));

    await expectDomainError("STALE_BRANCH", () =>
      service.appendCommit({
        repositoryId: repository.id,
        branchName: "alternate-standing",
        actor: student,
        parentSha: initial.sha,
        entryType: "argument",
        title: "Stale theory",
        content: "This must not overwrite the newer branch.",
        documentPath: "arguments/standing.md",
        provenance,
      }),
    );

    await service.createBranch({
      repositoryId: repository.id,
      name: "competing-standing",
      actor: student,
    });
    const competing = await service.appendCommit({
      repositoryId: repository.id,
      branchName: "competing-standing",
      actor: student,
      parentSha: initial.sha,
      entryType: "argument",
      title: "Initial standing theory",
      content: "A competing theory changes the same clause.",
      documentPath: "arguments/standing.md",
      provenance,
    });

    await expectDomainError("MERGE_CONFLICT", () =>
      service.mergeBranch({
        repositoryId: repository.id,
        targetBranchName: "alternate-standing",
        sourceBranchName: "competing-standing",
        actor: reviewer,
        expectedTargetHeadSha: alternate.sha,
        message: "Merge competing standing theory",
        provenance,
      }),
    );

    const merged = await service.mergeBranch({
      repositoryId: repository.id,
      targetBranchName: "main",
      sourceBranchName: "alternate-standing",
      actor: reviewer,
      expectedTargetHeadSha: initial.sha,
      message: "Merge alternate standing theory",
      provenance,
    });
    assert.match(merged.sha, /^[0-9a-f]{40}$/);
    assert.notEqual(merged.sha, initial.sha);

    const fork = await service.forkRepository({
      sourceRepositoryId: repository.id,
      slug: "step-five-service-fork",
      actor: student,
      fromSha: initial.sha,
    });
    const forkHistory = await service.getHistory(fork.id, "main");
    assert.deepEqual(
      forkHistory.map((commit) => commit.sha),
      [initial.sha],
    );
    assert.equal(
      await adapter.getBranchHead(repository.id, "main"),
      merged.sha,
    );
    assert.equal(await adapter.getBranchHead(fork.id, "main"), initial.sha);
    const forkedInitialSummary = await service.getCommitSummary(
      fork.id,
      initial.sha,
    );
    assert.equal(forkedInitialSummary.aiSourceCommitSha, initial.sha);
    assert.equal(forkedInitialSummary.aiStatus, "manual-fallback");
    assert.equal(competing.parentSha, initial.sha);

    const forkBranch = await service.createBranch({
      repositoryId: fork.id,
      name: "alternate-standing-argument",
      actor: student,
      fromSha: initial.sha,
    });
    assert.equal(forkBranch.headSha, initial.sha);

    const forkArgument = await service.appendCommit({
      repositoryId: fork.id,
      branchName: forkBranch.name,
      actor: student,
      parentSha: initial.sha,
      entryType: "student-argument",
      title: "Alternate standing argument",
      content: "The fork explores a separate interpretation of standing.",
      summary: "A student-authored moot-court theory.",
      documentPath: "arguments/alternate-standing-argument.md",
      provenance,
    });
    assert.equal(forkArgument.parentSha, initial.sha);
    assert.equal(
      await adapter.getBranchHead(fork.id, forkBranch.name),
      forkArgument.sha,
    );
    assert.equal(
      await adapter.getBranchHead(repository.id, "main"),
      merged.sha,
    );

    const forkPullRequest = await service.createPullRequest({
      repositoryId: fork.id,
      sourceBranchName: forkBranch.name,
      targetBranchName: "main",
      actor: student,
      reviewer,
      title: "Review alternate standing argument",
      description:
        "Ask a reviewer to evaluate the forked argument before it is merged.",
      provenance,
    });
    assert.equal(forkPullRequest.status, "open");
    assert.equal(forkPullRequest.hasConflicts, false);
    assert.equal(forkPullRequest.diff.length, 1);
    assert.ok(
      forkPullRequest.diff[0].lines.some((line) => line.type === "addition"),
    );

    await expectDomainError("REVIEW_REQUIRED", () =>
      service.mergePullRequest({
        pullRequestId: forkPullRequest.id,
        actor: reviewer,
      }),
    );
    const reviewedPullRequest = await service.reviewPullRequest({
      pullRequestId: forkPullRequest.id,
      actor: reviewer,
      decision: "approve",
      comment: "The public source is clearly cited.",
    });
    assert.equal(reviewedPullRequest.reviews[0].decision, "approve");

    const mergedPullRequest = await service.mergePullRequest({
      pullRequestId: forkPullRequest.id,
      actor: reviewer,
    });
    assert.equal(mergedPullRequest.pullRequest.status, "merged");
    assert.equal(
      mergedPullRequest.pullRequest.reviews[0].reviewerName,
      reviewer.displayName,
    );
    assert.equal(
      await adapter.getBranchHead(fork.id, "main"),
      mergedPullRequest.mergeCommit.sha,
    );
    const blamedArgument = await service.getBlameDetails(
      fork.id,
      "main",
      forkArgument.documentPath,
    );
    assert.ok(
      blamedArgument.some((line) => line.commit.sha === forkArgument.sha),
    );
    const forkAudit = await service.listAuditEvents(fork.id);
    assert.ok(
      forkAudit.some((event) => event.eventType === "pull_request.created"),
    );
    assert.ok(
      forkAudit.some((event) => event.eventType === "pull_request.reviewed"),
    );
    assert.ok(
      forkAudit.some((event) => event.eventType === "pull_request.merged"),
    );

    const malformedCitationPullRequest = await service.createPullRequest({
      repositoryId: fork.id,
      sourceBranchName: forkBranch.name,
      targetBranchName: "main",
      actor: student,
      reviewer,
      title: "Reject malformed citation",
      description: "This pull request intentionally omits a case citation.",
      provenance: {
        ...provenance,
        citation: "Public source fixture without a case citation",
      },
    });
    assert.equal(malformedCitationPullRequest.citationCheck.valid, false);
    await expectDomainError("CITATION_CHECK_FAILED", () =>
      service.reviewPullRequest({
        pullRequestId: malformedCitationPullRequest.id,
        actor: reviewer,
        decision: "approve",
      }),
    );

    const conflictPullRequest = await service.createPullRequest({
      repositoryId: repository.id,
      sourceBranchName: "competing-standing",
      targetBranchName: "alternate-standing",
      actor: student,
      reviewer,
      title: "Compare competing standing theory",
      description: "This comparison intentionally changes the same document.",
      provenance,
    });
    assert.equal(conflictPullRequest.hasConflicts, true);
    const conflictAudit = await service.listAuditEvents(repository.id);
    assert.ok(
      conflictAudit.some(
        (event) => event.eventType === "pull_request.conflict",
      ),
    );
    await expectDomainError("MERGE_CONFLICT", () =>
      service
        .reviewPullRequest({
          pullRequestId: conflictPullRequest.id,
          actor: reviewer,
          decision: "approve",
        })
        .then(() =>
          service.mergePullRequest({
            pullRequestId: conflictPullRequest.id,
            actor: reviewer,
          }),
        ),
    );

    const staleBranch = await service.createBranch({
      repositoryId: repository.id,
      name: "stale-review-branch",
      actor: student,
      fromSha: initial.sha,
    });
    const staleArgument = await service.appendCommit({
      repositoryId: repository.id,
      branchName: staleBranch.name,
      actor: student,
      parentSha: initial.sha,
      entryType: "student-argument",
      title: "Stale review theory",
      content: "This theory is intentionally made stale before merge.",
      documentPath: "arguments/stale-review.md",
      provenance,
    });
    const stalePullRequest = await service.createPullRequest({
      repositoryId: repository.id,
      sourceBranchName: staleBranch.name,
      targetBranchName: "main",
      actor: student,
      reviewer,
      title: "Stale review example",
      description: "The target branch will move after this review opens.",
      provenance,
    });
    const currentMainHead = await adapter.getBranchHead(repository.id, "main");
    assert.equal(currentMainHead, merged.sha);
    await service.appendCommit({
      repositoryId: repository.id,
      branchName: "main",
      actor: student,
      parentSha: currentMainHead,
      entryType: "annotation",
      title: "Target branch moved",
      content: "A later public-record annotation changed the target head.",
      documentPath: "arguments/target-note.md",
      provenance,
    });
    await service.reviewPullRequest({
      pullRequestId: stalePullRequest.id,
      actor: reviewer,
      decision: "approve",
    });
    await expectDomainError("PULL_REQUEST_STALE", () =>
      service.mergePullRequest({
        pullRequestId: stalePullRequest.id,
        actor: reviewer,
      }),
    );
    assert.equal(staleArgument.parentSha, initial.sha);

    const firstImport = await service.importPublicCase(demoCase);
    const secondImport = await service.importPublicCase(demoCase);
    assert.equal(firstImport.entriesImported, demoCase.entries.length);
    assert.equal(secondImport.headSha, firstImport.headSha);

    const importedRepository = await database.caseRepository.findUnique({
      where: { id: firstImport.repositoryId },
      include: {
        commits: { include: { sourceRecords: true } },
        branches: { include: { headCommit: { select: { sha: true } } } },
        _count: { select: { sourceRecords: true } },
      },
    });
    assert.ok(importedRepository);
    assert.equal(importedRepository.commits.length, demoCase.entries.length);
    assert.equal(
      importedRepository._count.sourceRecords,
      demoCase.entries.length,
    );
    assert.equal(importedRepository.branches.length, 1);
    assert.equal(importedRepository.branches[0].name, "main");
    assert.equal(
      importedRepository.branches[0].headCommit?.sha,
      firstImport.headSha,
    );
    const importedGitHistory = await adapter.getHistory(
      firstImport.repositoryId,
      "main",
    );
    assert.deepEqual(
      new Set(importedGitHistory.map((commit) => commit.sha)),
      new Set(importedRepository.commits.map((commit) => commit.sha)),
    );

    const generatedService = new CaseRepositoryService(database, adapter, {
      model: "integration-model",
      async generate() {
        return {
          summary: "The public record reached a judgment.",
          keyIssue: "The case presented a constitutional question.",
          outcome: "The Court issued a judgment on the question.",
          sourceReferences: [demoCase.sourceUrl],
        };
      },
    });
    const generatedSummary = await generatedService.generateCommitSummary(
      firstImport.repositoryId,
      firstImport.headSha ?? "",
    );
    assert.equal(generatedSummary.aiStatus, "generated");
    assert.equal(generatedSummary.aiModel, "integration-model");
    assert.equal(generatedSummary.aiSourceCommitSha, generatedSummary.sha);
    assert.equal(generatedSummary.aiCitationWarnings.length, 0);
    assert.ok(
      (await generatedService.listAuditEvents(firstImport.repositoryId)).some(
        (event) => event.eventType === "ai.summary.generated",
      ),
    );
  } finally {
    await database.$disconnect();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
