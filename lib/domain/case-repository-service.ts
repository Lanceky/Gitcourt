import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { lintCitation } from "@/lib/ai/citation-lint";
import {
  generateSummary,
  type SummaryGenerationInput,
  type SummaryGenerationResult,
  type SummaryProvider,
} from "@/lib/ai/summary-service";
import { DomainError } from "@/lib/domain/errors";
import {
  assertCanAppendCommit,
  assertCanForkRepository,
  assertCanMergePullRequest,
  assertCanReviewPullRequest,
  assertCanWriteRepository,
  assertForkIsolation,
  assertPublicRecordProvenance,
} from "@/lib/domain/policies";
import type {
  Actor,
  AppendCommitInput,
  AppendDocketEntryInput,
  CreateBranchInput,
  CreateRepositoryInput,
  ForkRepositoryInput,
  MergeBranchInput,
  MergePullRequestInput,
  ReviewPullRequestInput,
  CreatePullRequestInput,
  PullRequestSummary,
  AuditEventSummary,
  BlameSummaryLine,
  CommitSummary,
  RepositoryPolicyRecord,
} from "@/lib/domain/types";
export type { CommitSummary } from "@/lib/domain/types";
import { GitRepositoryError } from "@/lib/git/errors";
import {
  argumentDocumentPath,
  docketDocumentPath,
  renderCommitDocument,
} from "@/lib/git/markdown";
import { assertBranchName, assertRepositoryFilePath } from "@/lib/git/paths";
import { IsomorphicGitRepositoryAdapter } from "@/lib/git/isomorphic-git-adapter";
import type { FileDiff } from "@/lib/git/diff";
import type {
  GitBlameLine,
  GitCommitRecord,
  RepositoryAdapter,
} from "@/lib/git/repository-adapter";

export type PublicCaseImportInput = {
  slug: string;
  title: string;
  court: string;
  docketNumber: string;
  jurisdiction: string;
  summary: string;
  sourceUrl: string;
  sourceAttribution: string;
  entries: Array<{
    date: string;
    type: string;
    title: string;
    sourceText: string;
    summary: string;
    author: string;
    sourceUrl: string;
    citation: string;
    attribution: string;
    isPublicRecord: true;
  }>;
};

export type RepositorySummary = {
  id: string;
  slug: string;
  title: string;
  court: string;
  docketNumber: string;
  jurisdiction: string;
  status: string;
  isPublic: boolean;
  isCanonicalSource: boolean;
  parentRepositoryId: string | null;
  sourceUrl: string | null;
  sourceAttribution: string | null;
};

export type BranchSummary = {
  id: string;
  repositoryId: string;
  name: string;
  headSha: string | null;
  isProtected: boolean;
};

export type CommitResult = {
  id: string;
  sha: string;
  parentSha: string | null;
  parentShas: string[];
  documentPath: string;
};

export type BlameLine = GitBlameLine;

type PullRequestWithRelations = Prisma.PullRequestGetPayload<{
  include: {
    sourceBranch: true;
    targetBranch: true;
    author: true;
    reviewer: true;
    reviews: {
      include: { reviewer: true };
      orderBy: { createdAt: "asc" };
    };
  };
}>;

const repositorySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function actorEmail(actor: Actor): string {
  if (actor.email?.trim()) {
    return actor.email.trim();
  }

  const safeId = actor.id.replace(/[^A-Za-z0-9_-]/g, "-");
  return `${safeId || "actor"}@gitcourt.local`;
}

function assertRepositorySlug(slug: string): void {
  if (!repositorySlugPattern.test(slug)) {
    throw new DomainError(
      "INVALID_REPOSITORY_SLUG",
      "Repository slugs must contain lowercase letters, numbers, and hyphens.",
    );
  }
}

function assertServiceBranchName(branchName: string): void {
  try {
    assertBranchName(branchName);
  } catch {
    throw new DomainError(
      "INVALID_BRANCH_NAME",
      "Branch names must be safe Git references.",
    );
  }
}

function parseParentShas(
  parentShas: string | null,
  parentSha: string | null,
): string[] {
  if (parentShas !== null) {
    try {
      const parsed = JSON.parse(parentShas) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every((value): value is string => typeof value === "string")
      ) {
        return parsed;
      }
    } catch {
      // Fall back to the legacy single-parent field below.
    }
  }

  return parentSha === null ? [] : [parentSha];
}

function parseJsonStringArray(value: string | null): string[] {
  if (value === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseCitationWarnings(
  value: string | null,
): Array<{ code: string; message: string }> {
  if (value === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("code" in item) ||
        !("message" in item) ||
        typeof item.code !== "string" ||
        typeof item.message !== "string"
      ) {
        return [];
      }
      return [{ code: item.code, message: item.message }];
    });
  } catch {
    return [];
  }
}

function repositoryPolicy(
  repository: Pick<
    RepositoryPolicyRecord,
    "id" | "status" | "isPublic" | "isCanonicalSource" | "parentRepositoryId"
  >,
): RepositoryPolicyRecord {
  return repository;
}

export class CaseRepositoryService {
  constructor(
    private readonly database: PrismaClient,
    private readonly git: RepositoryAdapter = new IsomorphicGitRepositoryAdapter(),
    private readonly summaryProvider?: SummaryProvider | null,
  ) {}

  async createRepository(
    input: CreateRepositoryInput,
  ): Promise<RepositorySummary> {
    return this.execute(async () => {
      assertRepositorySlug(input.slug);
      const repositoryId = randomUUID();
      let gitInitialized = false;

      try {
        return await this.database.$transaction(async (transaction) => {
          const actor = await this.ensureActor(transaction, input.actor);
          const repository = await transaction.caseRepository.create({
            data: {
              id: repositoryId,
              slug: input.slug,
              title: input.title,
              court: input.court,
              docketNumber: input.docketNumber,
              jurisdiction: input.jurisdiction,
              status: input.status ?? "public",
              isPublic: input.isPublic ?? true,
              isCanonicalSource: input.isCanonicalSource ?? false,
              sourceUrl: input.sourceUrl ?? undefined,
              sourceAttribution: input.sourceAttribution ?? undefined,
            },
          });

          await transaction.branch.create({
            data: {
              repositoryId,
              name: "main",
              ownerId: actor.id,
              isProtected: input.isCanonicalSource ?? false,
            },
          });

          await this.git.initialize(repositoryId, "main");
          gitInitialized = true;

          await transaction.auditEvent.create({
            data: {
              repositoryId,
              actorId: actor.id,
              eventType: "repository.created",
              entityType: "case_repository",
              entityId: repositoryId,
              details: JSON.stringify({ slug: input.slug }),
            },
          });

          return this.toRepositorySummary(repository);
        });
      } catch (error) {
        if (gitInitialized) {
          await this.cleanupRepositoryStorage(repositoryId);
        }
        throw error;
      }
    });
  }

  async createBranch(input: CreateBranchInput): Promise<BranchSummary> {
    return this.execute(async () => {
      assertServiceBranchName(input.name);

      let gitBranchCreated = false;
      try {
        return await this.database.$transaction(async (transaction) => {
          const repository = await transaction.caseRepository.findUnique({
            where: { id: input.repositoryId },
          });

          if (repository === null) {
            throw new DomainError(
              "REPOSITORY_NOT_FOUND",
              "The target repository does not exist.",
            );
          }

          assertCanWriteRepository(repositoryPolicy(repository));

          const existingBranch = await transaction.branch.findUnique({
            where: {
              repositoryId_name: {
                repositoryId: input.repositoryId,
                name: input.name,
              },
            },
          });
          if (existingBranch !== null) {
            throw new DomainError(
              "BRANCH_EXISTS",
              "A branch with that name already exists.",
            );
          }

          const sourceBranchName = input.fromBranchName ?? "main";
          const sourceBranch = await transaction.branch.findUnique({
            where: {
              repositoryId_name: {
                repositoryId: input.repositoryId,
                name: sourceBranchName,
              },
            },
            include: { headCommit: { select: { sha: true } } },
          });

          if (sourceBranch === null) {
            throw new DomainError(
              "BRANCH_NOT_FOUND",
              "The source branch does not exist.",
            );
          }

          const fromSha = input.fromSha ?? sourceBranch.headCommit?.sha ?? null;
          if (input.fromSha !== undefined && input.fromSha !== null) {
            const sourceCommit = await transaction.docketCommit.findFirst({
              where: {
                repositoryId: input.repositoryId,
                sha: input.fromSha,
              },
              select: { sha: true },
            });
            if (sourceCommit === null) {
              throw new DomainError(
                "COMMIT_NOT_FOUND",
                "The requested branch starting commit does not exist.",
              );
            }
          }

          const actor = await this.ensureActor(transaction, input.actor);
          await this.git.createBranch(input.repositoryId, input.name, fromSha);
          gitBranchCreated = fromSha !== null;

          const branch = await transaction.branch.create({
            data: {
              repositoryId: input.repositoryId,
              name: input.name,
              ownerId: actor.id,
              headCommitId:
                fromSha === null
                  ? null
                  : (
                      await transaction.docketCommit.findUnique({
                        where: {
                          repositoryId_sha: {
                            repositoryId: input.repositoryId,
                            sha: fromSha,
                          },
                        },
                        select: { id: true },
                      })
                    )?.id,
              isProtected: input.isProtected ?? false,
            },
            include: { headCommit: { select: { sha: true } } },
          });

          await transaction.auditEvent.create({
            data: {
              repositoryId: input.repositoryId,
              actorId: actor.id,
              eventType: "branch.created",
              entityType: "branch",
              entityId: branch.id,
              details: JSON.stringify({
                name: branch.name,
                fromSha,
              }),
            },
          });

          return this.toBranchSummary(branch);
        });
      } catch (error) {
        if (gitBranchCreated) {
          await this.cleanupBranch(input.repositoryId, input.name);
        }
        throw error;
      }
    });
  }

  async forkRepository(input: ForkRepositoryInput): Promise<RepositorySummary> {
    return this.execute(async () => {
      assertRepositorySlug(input.slug);
      const source = await this.database.caseRepository.findUnique({
        where: { id: input.sourceRepositoryId },
        include: {
          commits: {
            include: { sourceRecords: true },
            orderBy: { createdAt: "asc" },
          },
          branches: {
            include: {
              headCommit: { select: { sha: true } },
            },
          },
        },
      });

      if (source === null) {
        throw new DomainError(
          "REPOSITORY_NOT_FOUND",
          "The source repository does not exist.",
        );
      }

      assertCanForkRepository(repositoryPolicy(source));

      const sourceMainBranch = source.branches.find(
        (branch) => branch.name === "main",
      );
      const sourceHeadSha = sourceMainBranch?.headCommit?.sha ?? null;
      const startingSha = input.fromSha ?? sourceHeadSha;
      if (
        startingSha !== null &&
        !source.commits.some((commit) => commit.sha === startingSha)
      ) {
        throw new DomainError(
          "COMMIT_NOT_FOUND",
          "The requested fork starting commit does not belong to the source case.",
        );
      }

      const repositoryId = randomUUID();
      let cloned = false;
      try {
        await this.git.clone(source.id, repositoryId);
        cloned = true;
        if (startingSha !== sourceHeadSha) {
          await this.git.restoreBranch(repositoryId, "main", startingSha);
        }

        return await this.database.$transaction(async (transaction) => {
          const actor = await this.ensureActor(transaction, input.actor);
          const fork = await transaction.caseRepository.create({
            data: {
              id: repositoryId,
              slug: input.slug,
              title: input.title ?? `${source.title} (fork)`,
              court: source.court,
              docketNumber: source.docketNumber,
              jurisdiction: source.jurisdiction,
              status: "fork",
              isPublic: input.isPublic ?? false,
              isCanonicalSource: false,
              sourceUrl: source.sourceUrl ?? undefined,
              sourceAttribution: source.sourceAttribution ?? undefined,
              parentRepositoryId: source.id,
            },
          });

          const commitIdBySha = new Map<string, string>();
          for (const sourceCommit of source.commits) {
            const forkCommit = await transaction.docketCommit.create({
              data: {
                repositoryId,
                sha: sourceCommit.sha,
                parentSha: sourceCommit.parentSha,
                parentShas: sourceCommit.parentShas,
                authorId: sourceCommit.authorId,
                authorName: sourceCommit.authorName,
                entryType: sourceCommit.entryType,
                title: sourceCommit.title,
                content: sourceCommit.content,
                documentPath: sourceCommit.documentPath,
                sourceReference: sourceCommit.sourceReference,
                sourceUrl: sourceCommit.sourceUrl,
                attribution: sourceCommit.attribution,
                aiSummary: sourceCommit.aiSummary,
                aiKeyIssue: sourceCommit.aiKeyIssue,
                aiOutcome: sourceCommit.aiOutcome,
                aiSourceReferences: sourceCommit.aiSourceReferences,
                aiSourceCommitSha: sourceCommit.aiSourceCommitSha,
                aiModel: sourceCommit.aiModel,
                aiPromptVersion: sourceCommit.aiPromptVersion,
                aiStatus: sourceCommit.aiStatus,
                aiCitationWarnings: sourceCommit.aiCitationWarnings,
                aiError: sourceCommit.aiError,
                aiGeneratedAt: sourceCommit.aiGeneratedAt,
                publishedAt: sourceCommit.publishedAt,
                createdAt: sourceCommit.createdAt,
              },
            });
            commitIdBySha.set(forkCommit.sha, forkCommit.id);

            for (const sourceRecord of sourceCommit.sourceRecords) {
              await transaction.sourceRecord.create({
                data: {
                  repositoryId,
                  commitId: forkCommit.id,
                  kind: sourceRecord.kind,
                  url: sourceRecord.url,
                  citation: sourceRecord.citation,
                  documentHash: sourceRecord.documentHash,
                  attribution: sourceRecord.attribution,
                  createdAt: sourceRecord.createdAt,
                },
              });
            }
          }

          for (const sourceBranch of source.branches) {
            const branchHeadSha =
              sourceBranch.name === "main"
                ? startingSha
                : (sourceBranch.headCommit?.sha ?? null);
            await transaction.branch.create({
              data: {
                repositoryId,
                name: sourceBranch.name,
                ownerId: actor.id,
                headCommitId:
                  branchHeadSha === null
                    ? null
                    : (commitIdBySha.get(branchHeadSha) ?? null),
                isProtected: sourceBranch.isProtected,
                createdAt: sourceBranch.createdAt,
                updatedAt: sourceBranch.updatedAt,
              },
            });
          }

          await transaction.auditEvent.create({
            data: {
              repositoryId,
              actorId: actor.id,
              eventType: "repository.forked",
              entityType: "case_repository",
              entityId: repositoryId,
              details: JSON.stringify({
                parentRepositoryId: source.id,
                parentSlug: source.slug,
                startingSha,
              }),
            },
          });

          assertForkIsolation(repositoryPolicy(source), repositoryPolicy(fork));
          return this.toRepositorySummary(fork);
        });
      } catch (error) {
        if (cloned) {
          await this.cleanupRepositoryStorage(repositoryId);
        }
        throw error;
      }
    });
  }

  async appendDocketEntry(
    input: AppendDocketEntryInput,
  ): Promise<CommitResult> {
    const identity = createHash("sha256")
      .update(
        [
          input.publishedAt.toISOString(),
          input.entryType,
          input.title,
          input.sourceText,
          input.provenance.url,
        ].join("\u0000"),
        "utf8",
      )
      .digest("hex");

    return this.appendCommit({
      repositoryId: input.repositoryId,
      branchName: input.branchName,
      actor: input.actor,
      parentSha: await this.getBranchHeadFromDatabase(
        input.repositoryId,
        input.branchName,
      ),
      entryType: input.entryType,
      title: input.title,
      content: input.sourceText,
      provenance: input.provenance,
      documentPath:
        input.documentPath ?? docketDocumentPath(input.title, identity),
      summary: input.summary,
      publishedAt: input.publishedAt,
    });
  }

  private async appendImportedDocketEntry(
    input: AppendDocketEntryInput,
  ): Promise<CommitResult> {
    const identity = createHash("sha256")
      .update(
        [
          input.publishedAt.toISOString(),
          input.entryType,
          input.title,
          input.sourceText,
          input.provenance.url,
        ].join("\u0000"),
        "utf8",
      )
      .digest("hex");

    return this.appendCommitInternal(
      {
        repositoryId: input.repositoryId,
        branchName: input.branchName,
        actor: input.actor,
        parentSha: await this.getBranchHeadFromDatabase(
          input.repositoryId,
          input.branchName,
        ),
        entryType: input.entryType,
        title: input.title,
        content: input.sourceText,
        provenance: input.provenance,
        documentPath:
          input.documentPath ?? docketDocumentPath(input.title, identity),
        summary: input.summary,
        publishedAt: input.publishedAt,
      },
      { allowCanonicalImport: true },
    );
  }

  async appendCommit(input: AppendCommitInput): Promise<CommitResult> {
    return this.appendCommitInternal(input);
  }

  async getHistory(
    repositoryId: string,
    ref: string,
  ): Promise<CommitSummary[]> {
    return this.execute(async () => {
      await this.requireRepository(repositoryId);
      const gitHistory = await this.git.getHistory(repositoryId, ref);
      const commits = await this.database.docketCommit.findMany({
        where: {
          repositoryId,
          sha: { in: gitHistory.map((commit) => commit.sha) },
        },
        include: { sourceRecords: true },
      });
      const metadataBySha = new Map(
        commits.map((commit) => [commit.sha, commit]),
      );

      return gitHistory.map((gitCommit) => {
        const commit = metadataBySha.get(gitCommit.sha);
        if (commit === undefined) {
          throw new DomainError(
            "COMMIT_METADATA_MISSING",
            `Git commit ${gitCommit.sha} has no Git Court metadata.`,
          );
        }

        return this.toCommitSummary(commit);
      });
    });
  }

  async getDiff(
    repositoryId: string,
    fromRef: string | null,
    toRef: string,
  ): Promise<FileDiff[]> {
    return this.execute(async () => {
      await this.requireRepository(repositoryId);
      return this.git.getDiff(repositoryId, fromRef, toRef);
    });
  }

  async getCommitSummary(
    repositoryId: string,
    sha: string,
  ): Promise<CommitSummary> {
    return this.execute(async () => {
      await this.requireRepository(repositoryId);
      const commit = await this.database.docketCommit.findUnique({
        where: {
          repositoryId_sha: {
            repositoryId,
            sha,
          },
        },
        include: { sourceRecords: true },
      });
      if (commit === null) {
        throw new DomainError(
          "COMMIT_NOT_FOUND",
          "The requested commit does not exist.",
        );
      }

      return this.toCommitSummary(commit);
    });
  }

  async generateCommitSummary(
    repositoryId: string,
    sha: string,
  ): Promise<CommitSummary> {
    return this.execute(async () => {
      await this.requireRepository(repositoryId);
      const commit = await this.database.docketCommit.findUnique({
        where: {
          repositoryId_sha: {
            repositoryId,
            sha,
          },
        },
        include: { sourceRecords: true },
      });
      if (commit === null) {
        throw new DomainError(
          "COMMIT_NOT_FOUND",
          "The requested commit does not exist.",
        );
      }

      const sourceRecord = commit.sourceRecords[0];
      const sourceUrl = sourceRecord?.url ?? commit.sourceUrl;
      const citation = sourceRecord?.citation;
      if (sourceUrl === null || citation === null) {
        throw new DomainError(
          "PROVENANCE_REQUIRED",
          "An AI summary requires a public source URL and citation.",
        );
      }

      const result = await this.generateSummaryForCommit({
        sourceCommitSha: commit.sha,
        title: commit.title,
        entryType: commit.entryType,
        publishedAt: commit.publishedAt,
        sourceText: commit.content,
        manualSummary: commit.aiSummary ?? undefined,
        sourceUrl,
        citation,
      });
      const updated = await this.database.$transaction(async (transaction) => {
        const saved = await transaction.docketCommit.update({
          where: { id: commit.id },
          data: this.aiSummaryData(result, commit.sha),
          include: { sourceRecords: true },
        });
        await transaction.auditEvent.create({
          data: {
            repositoryId,
            actorId: commit.authorId,
            eventType:
              result.status === "generated"
                ? "ai.summary.generated"
                : result.status === "rejected"
                  ? "ai.summary.rejected"
                  : "ai.summary.fallback",
            entityType: "docket_commit",
            entityId: commit.id,
            details: JSON.stringify({
              status: result.status,
              model: result.model,
              promptVersion: result.promptVersion,
              sourceCommitSha: commit.sha,
              citationIssues: result.citationIssues,
              error: result.error,
            }),
          },
        });
        return saved;
      });

      return this.toCommitSummary(updated);
    });
  }

  async createPullRequest(
    input: CreatePullRequestInput,
  ): Promise<PullRequestSummary> {
    return this.execute(async () => {
      assertServiceBranchName(input.sourceBranchName);
      assertServiceBranchName(input.targetBranchName);
      if (input.sourceBranchName === input.targetBranchName) {
        throw new DomainError(
          "MERGE_FORBIDDEN",
          "A pull request must compare two different branches.",
        );
      }
      assertPublicRecordProvenance(input.provenance);

      const repository = await this.requireRepository(input.repositoryId);
      assertCanWriteRepository(repositoryPolicy(repository));
      const [sourceBranch, targetBranch] = await Promise.all([
        this.database.branch.findUnique({
          where: {
            repositoryId_name: {
              repositoryId: input.repositoryId,
              name: input.sourceBranchName,
            },
          },
          include: { headCommit: { select: { sha: true } } },
        }),
        this.database.branch.findUnique({
          where: {
            repositoryId_name: {
              repositoryId: input.repositoryId,
              name: input.targetBranchName,
            },
          },
          include: { headCommit: { select: { sha: true } } },
        }),
      ]);

      if (sourceBranch === null || targetBranch === null) {
        throw new DomainError(
          "BRANCH_NOT_FOUND",
          "Both pull request branches must exist.",
        );
      }
      if (
        sourceBranch.headCommit === null ||
        targetBranch.headCommit === null
      ) {
        throw new DomainError(
          "COMMIT_NOT_FOUND",
          "Both pull request branches must have commits.",
        );
      }

      const existing = await this.database.pullRequest.findFirst({
        where: {
          repositoryId: input.repositoryId,
          sourceBranchId: sourceBranch.id,
          targetBranchId: targetBranch.id,
          status: "open",
        },
      });
      if (existing !== null) {
        throw new DomainError(
          "PULL_REQUEST_EXISTS",
          "An open pull request already compares these branches.",
        );
      }

      const [author, reviewer] = await Promise.all([
        this.findOrCreateActor(input.actor),
        input.reviewer === undefined
          ? Promise.resolve(null)
          : this.findOrCreateActor(input.reviewer),
      ]);
      const mergePreview = await this.git.previewMergeBranches({
        repositoryId: input.repositoryId,
        targetBranchName: input.targetBranchName,
        sourceBranchName: input.sourceBranchName,
      });

      const pullRequest = await this.database.$transaction(
        async (transaction) => {
          const created = await transaction.pullRequest.create({
            data: {
              repositoryId: input.repositoryId,
              sourceBranchId: sourceBranch.id,
              targetBranchId: targetBranch.id,
              authorId: author.id,
              reviewerId: reviewer?.id,
              title: input.title,
              description: input.description,
              sourceHeadSha: sourceBranch.headCommit?.sha ?? "",
              targetHeadSha: targetBranch.headCommit?.sha ?? "",
              hasConflicts: mergePreview.hasConflicts,
              sourceUrl: input.provenance.url,
              sourceCitation: input.provenance.citation,
              sourceDocumentHash: input.provenance.documentHash,
              sourceAttribution: input.provenance.attribution,
            },
            include: {
              sourceBranch: true,
              targetBranch: true,
              author: true,
              reviewer: true,
              reviews: {
                include: { reviewer: true },
                orderBy: { createdAt: "asc" },
              },
            },
          });

          await transaction.auditEvent.create({
            data: {
              repositoryId: input.repositoryId,
              actorId: author.id,
              eventType: "pull_request.created",
              entityType: "pull_request",
              entityId: created.id,
              details: JSON.stringify({
                sourceBranch: input.sourceBranchName,
                targetBranch: input.targetBranchName,
                sourceHeadSha: sourceBranch.headCommit?.sha,
                targetHeadSha: targetBranch.headCommit?.sha,
                hasConflicts: mergePreview.hasConflicts,
              }),
            },
          });
          if (mergePreview.hasConflicts) {
            await transaction.auditEvent.create({
              data: {
                repositoryId: input.repositoryId,
                actorId: author.id,
                eventType: "pull_request.conflict",
                entityType: "pull_request",
                entityId: created.id,
                details: JSON.stringify({
                  sourceBranch: input.sourceBranchName,
                  targetBranch: input.targetBranchName,
                  reason: "conflicting document changes",
                }),
              },
            });
          }

          return created;
        },
      );
      const diff = await this.git.getDiff(
        input.repositoryId,
        targetBranch.headCommit.sha,
        sourceBranch.headCommit.sha,
      );

      return this.toPullRequestSummary(pullRequest, diff);
    });
  }

  async getPullRequest(pullRequestId: string): Promise<PullRequestSummary> {
    return this.execute(async () => {
      const pullRequest = await this.findPullRequest(pullRequestId);
      const diff = await this.git.getDiff(
        pullRequest.repositoryId,
        pullRequest.targetHeadSha,
        pullRequest.sourceHeadSha,
      );
      return this.toPullRequestSummary(pullRequest, diff);
    });
  }

  async listPullRequests(repositoryId: string): Promise<PullRequestSummary[]> {
    return this.execute(async () => {
      await this.requireRepository(repositoryId);
      const pullRequests = await this.database.pullRequest.findMany({
        where: { repositoryId },
        include: {
          sourceBranch: true,
          targetBranch: true,
          author: true,
          reviewer: true,
          reviews: {
            include: { reviewer: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return Promise.all(
        pullRequests.map(async (pullRequest) => {
          const diff = await this.git.getDiff(
            repositoryId,
            pullRequest.targetHeadSha,
            pullRequest.sourceHeadSha,
          );
          return this.toPullRequestSummary(pullRequest, diff);
        }),
      );
    });
  }

  async reviewPullRequest(
    input: ReviewPullRequestInput,
  ): Promise<PullRequestSummary> {
    return this.execute(async () => {
      if (
        input.decision !== "approve" &&
        input.decision !== "request_changes" &&
        input.decision !== "comment"
      ) {
        throw new DomainError(
          "INVALID_REVIEW_DECISION",
          "Review decisions must approve, request changes, or comment.",
        );
      }

      const pullRequest = await this.findPullRequest(input.pullRequestId);
      const actorRecord = await this.findOrCreateActor(input.actor);
      assertCanReviewPullRequest(
        {
          status: pullRequest.status,
          reviewerId: pullRequest.reviewerId,
        },
        { ...input.actor, id: actorRecord.id },
      );
      const sourceUrl = pullRequest.sourceUrl;
      const sourceCitation = pullRequest.sourceCitation;
      if (input.decision === "approve") {
        if (sourceUrl === null || sourceCitation === null) {
          throw new DomainError(
            "CITATION_CHECK_FAILED",
            "An approving review requires a complete public citation.",
          );
        }
        const citationCheck = lintCitation({
          citation: sourceCitation,
          sourceUrl,
          sourceReferences: [sourceUrl],
          requireSourceReference: true,
        });
        if (!citationCheck.valid) {
          throw new DomainError(
            "CITATION_CHECK_FAILED",
            `Citation formatting assistance found issues: ${citationCheck.issues
              .map((issue) => issue.message)
              .join(" ")}`,
          );
        }
      }

      await this.database.$transaction(async (transaction) => {
        await transaction.review.create({
          data: {
            pullRequestId: pullRequest.id,
            reviewerId: actorRecord.id,
            decision: input.decision,
            comment: input.comment?.trim() || undefined,
          },
        });
        await transaction.auditEvent.create({
          data: {
            repositoryId: pullRequest.repositoryId,
            actorId: actorRecord.id,
            eventType: "pull_request.reviewed",
            entityType: "pull_request",
            entityId: pullRequest.id,
            details: JSON.stringify({
              decision: input.decision,
              comment: input.comment?.trim() || null,
            }),
          },
        });
      });

      return this.getPullRequest(input.pullRequestId);
    });
  }

  async mergePullRequest(
    input: MergePullRequestInput,
  ): Promise<{ pullRequest: PullRequestSummary; mergeCommit: CommitResult }> {
    return this.execute(async () => {
      const pullRequest = await this.findPullRequest(input.pullRequestId);
      const actorRecord = await this.findOrCreateActor(input.actor);
      const actor = { ...input.actor, id: actorRecord.id };
      assertCanMergePullRequest(
        {
          status: pullRequest.status,
          sourceBranchId: pullRequest.sourceBranchId,
          targetBranchId: pullRequest.targetBranchId,
          reviewerId: pullRequest.reviewerId,
          hasConflicts: pullRequest.hasConflicts,
        },
        actor,
      );

      const latestReview = pullRequest.reviews.at(-1);
      const hasApproval = pullRequest.reviews.some(
        (review) =>
          review.decision === "approve" &&
          (pullRequest.reviewerId === null ||
            review.reviewerId === pullRequest.reviewerId),
      );
      if (!hasApproval || latestReview?.decision === "request_changes") {
        throw new DomainError(
          "REVIEW_REQUIRED",
          "An approving review is required before this pull request can merge.",
        );
      }

      const [sourceBranch, targetBranch] = await Promise.all([
        this.database.branch.findUnique({
          where: {
            repositoryId_name: {
              repositoryId: pullRequest.repositoryId,
              name: pullRequest.sourceBranch.name,
            },
          },
          include: { headCommit: { select: { sha: true } } },
        }),
        this.database.branch.findUnique({
          where: {
            repositoryId_name: {
              repositoryId: pullRequest.repositoryId,
              name: pullRequest.targetBranch.name,
            },
          },
          include: { headCommit: { select: { sha: true } } },
        }),
      ]);
      if (
        sourceBranch?.headCommit?.sha !== pullRequest.sourceHeadSha ||
        targetBranch?.headCommit?.sha !== pullRequest.targetHeadSha
      ) {
        throw new DomainError(
          "PULL_REQUEST_STALE",
          "The pull request branches changed; refresh the comparison before merging.",
        );
      }
      if (
        pullRequest.sourceUrl === null ||
        pullRequest.sourceCitation === null ||
        pullRequest.sourceDocumentHash === null ||
        pullRequest.sourceAttribution === null
      ) {
        throw new DomainError(
          "PROVENANCE_REQUIRED",
          "A pull request merge requires a source citation.",
        );
      }

      let mergeCommit: CommitResult;
      try {
        mergeCommit = await this.mergeBranch({
          repositoryId: pullRequest.repositoryId,
          targetBranchName: pullRequest.targetBranch.name,
          sourceBranchName: pullRequest.sourceBranch.name,
          actor,
          expectedTargetHeadSha: pullRequest.targetHeadSha,
          message: `Merge pull request: ${pullRequest.title}`,
          provenance: {
            kind: "student-argument",
            url: pullRequest.sourceUrl,
            citation: pullRequest.sourceCitation,
            documentHash: pullRequest.sourceDocumentHash,
            attribution: pullRequest.sourceAttribution,
            isPublicRecord: true,
          },
        });
      } catch (error) {
        if (error instanceof DomainError && error.code === "MERGE_CONFLICT") {
          await this.database.$transaction(async (transaction) => {
            await transaction.pullRequest.update({
              where: { id: pullRequest.id },
              data: { hasConflicts: true },
            });
            await transaction.auditEvent.create({
              data: {
                repositoryId: pullRequest.repositoryId,
                actorId: actorRecord.id,
                eventType: "pull_request.conflict",
                entityType: "pull_request",
                entityId: pullRequest.id,
                details: JSON.stringify({
                  sourceBranch: pullRequest.sourceBranch.name,
                  targetBranch: pullRequest.targetBranch.name,
                  reason: "merge conflict during review",
                }),
              },
            });
          });
        }
        throw error;
      }

      await this.database.$transaction(async (transaction) => {
        await transaction.pullRequest.update({
          where: { id: pullRequest.id },
          data: {
            status: "merged",
            mergeCommitId: mergeCommit.id,
            mergedAt: new Date(),
          },
        });
        await transaction.auditEvent.create({
          data: {
            repositoryId: pullRequest.repositoryId,
            actorId: actorRecord.id,
            eventType: "pull_request.merged",
            entityType: "pull_request",
            entityId: pullRequest.id,
            details: JSON.stringify({
              mergeSha: mergeCommit.sha,
              reviewer: actorRecord.id,
            }),
          },
        });
      });

      return {
        pullRequest: await this.getPullRequest(pullRequest.id),
        mergeCommit,
      };
    });
  }

  async getBlameDetails(
    repositoryId: string,
    ref: string,
    filepath: string,
  ): Promise<BlameSummaryLine[]> {
    return this.execute(async () => {
      const lines = await this.blame(repositoryId, ref, filepath);
      const commits = await this.database.docketCommit.findMany({
        where: {
          repositoryId,
          sha: { in: [...new Set(lines.map((line) => line.commit.sha))] },
        },
        include: { sourceRecords: true },
      });
      const commitBySha = new Map(
        commits.map((commit) => [commit.sha, this.toCommitSummary(commit)]),
      );

      return lines.map((line) => {
        const commit = commitBySha.get(line.commit.sha);
        if (commit === undefined) {
          throw new DomainError(
            "COMMIT_METADATA_MISSING",
            `Git commit ${line.commit.sha} has no Git Court metadata.`,
          );
        }
        return {
          lineNumber: line.lineNumber,
          text: line.text,
          commit,
        };
      });
    });
  }

  async listAuditEvents(repositoryId: string): Promise<AuditEventSummary[]> {
    return this.execute(async () => {
      await this.requireRepository(repositoryId);
      const events = await this.database.auditEvent.findMany({
        where: { repositoryId },
        include: { actor: { select: { displayName: true } } },
        orderBy: { createdAt: "desc" },
      });

      return events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        details: this.parseAuditDetails(event.details),
        actorName: event.actor?.displayName ?? null,
        createdAt: event.createdAt,
      }));
    });
  }

  async mergeBranch(input: MergeBranchInput): Promise<CommitResult> {
    return this.execute(async () => {
      const repository = await this.database.caseRepository.findUnique({
        where: { id: input.repositoryId },
      });
      if (repository === null) {
        throw new DomainError(
          "REPOSITORY_NOT_FOUND",
          "The target repository does not exist.",
        );
      }

      assertCanWriteRepository(repositoryPolicy(repository));
      if (input.actor.role !== "reviewer" && input.actor.role !== "admin") {
        throw new DomainError(
          "MERGE_FORBIDDEN",
          "Only a reviewer or administrator can merge branches.",
        );
      }
      assertPublicRecordProvenance(input.provenance);

      const [targetBranch, sourceBranch] = await Promise.all([
        this.database.branch.findUnique({
          where: {
            repositoryId_name: {
              repositoryId: input.repositoryId,
              name: input.targetBranchName,
            },
          },
          include: { headCommit: { select: { sha: true } } },
        }),
        this.database.branch.findUnique({
          where: {
            repositoryId_name: {
              repositoryId: input.repositoryId,
              name: input.sourceBranchName,
            },
          },
          include: { headCommit: { select: { sha: true } } },
        }),
      ]);

      if (targetBranch === null || sourceBranch === null) {
        throw new DomainError(
          "BRANCH_NOT_FOUND",
          "Both the target and source branches must exist.",
        );
      }
      if (
        targetBranch.headCommit?.sha === null ||
        targetBranch.headCommit === null
      ) {
        throw new DomainError(
          "COMMIT_NOT_FOUND",
          "The target branch has no commit to merge into.",
        );
      }
      if (
        sourceBranch.headCommit?.sha === null ||
        sourceBranch.headCommit === null
      ) {
        throw new DomainError(
          "COMMIT_NOT_FOUND",
          "The source branch has no commit to merge.",
        );
      }
      if (targetBranch.headCommit.sha !== input.expectedTargetHeadSha) {
        throw new DomainError(
          "STALE_BRANCH",
          "The target branch changed before the merge was created.",
        );
      }

      const actor = await this.findOrCreateActor(input.actor);
      let gitMerge: GitCommitRecord | null = null;
      try {
        const result = await this.git.mergeBranches({
          repositoryId: input.repositoryId,
          targetBranchName: input.targetBranchName,
          sourceBranchName: input.sourceBranchName,
          author: {
            name: input.actor.displayName,
            email: actor.email,
          },
          message: input.message,
          expectedTargetHeadSha: input.expectedTargetHeadSha,
        });
        gitMerge = result.commit;

        return await this.database.$transaction(async (transaction) => {
          const existing = await transaction.docketCommit.findUnique({
            where: {
              repositoryId_sha: {
                repositoryId: input.repositoryId,
                sha: result.commit.sha,
              },
            },
          });
          if (existing !== null) {
            return this.toCommitResult(existing);
          }

          const mergeCommit = await transaction.docketCommit.create({
            data: {
              repositoryId: input.repositoryId,
              sha: result.commit.sha,
              parentSha: result.commit.parentShas[0] ?? null,
              parentShas: JSON.stringify(result.commit.parentShas),
              authorId: actor.id,
              authorName: result.commit.author.name,
              entryType: "merge",
              title: input.message,
              content: `Merged ${input.sourceBranchName} into ${input.targetBranchName}.`,
              sourceReference: input.provenance.url,
              sourceUrl: input.provenance.url,
              attribution: input.provenance.attribution,
              publishedAt: result.commit.authoredAt,
            },
          });

          await transaction.branch.update({
            where: { id: targetBranch.id },
            data: { headCommitId: mergeCommit.id },
          });
          await transaction.sourceRecord.create({
            data: {
              repositoryId: input.repositoryId,
              commitId: mergeCommit.id,
              kind: input.provenance.kind,
              url: input.provenance.url,
              citation: input.provenance.citation,
              documentHash: input.provenance.documentHash,
              attribution: input.provenance.attribution,
            },
          });
          await transaction.auditEvent.create({
            data: {
              repositoryId: input.repositoryId,
              actorId: actor.id,
              eventType: "branch.merged",
              entityType: "docket_commit",
              entityId: mergeCommit.id,
              details: JSON.stringify({
                sourceBranch: input.sourceBranchName,
                targetBranch: input.targetBranchName,
                parentShas: result.commit.parentShas,
              }),
            },
          });

          return this.toCommitResult(mergeCommit);
        });
      } catch (error) {
        if (gitMerge !== null) {
          await this.restoreAfterFailure(
            input.repositoryId,
            input.targetBranchName,
            input.expectedTargetHeadSha,
            error,
          );
        }
        throw error;
      }
    });
  }

  async blame(
    repositoryId: string,
    ref: string,
    filepath: string,
  ): Promise<BlameLine[]> {
    return this.execute(async () => {
      await this.requireRepository(repositoryId);
      assertRepositoryFilePath(filepath);
      return this.git.blame(repositoryId, ref, filepath);
    });
  }

  async importPublicCase(input: PublicCaseImportInput): Promise<{
    repositoryId: string;
    slug: string;
    entriesImported: number;
    headSha: string | null;
  }> {
    return this.execute(async () => {
      const importer: Actor = {
        id: "public-records-importer",
        displayName: "Public records importer",
        email: "public-records@gitcourt.local",
        role: "admin",
      };
      const existingRepository = await this.database.caseRepository.findUnique({
        where: { slug: input.slug },
      });

      const repository: RepositorySummary =
        existingRepository === null
          ? await this.createRepository({
              slug: input.slug,
              title: input.title,
              court: input.court,
              docketNumber: input.docketNumber,
              jurisdiction: input.jurisdiction,
              actor: importer,
              status: "public",
              isPublic: true,
              isCanonicalSource: true,
              sourceUrl: input.sourceUrl,
              sourceAttribution: input.sourceAttribution,
            })
          : this.toRepositorySummary(existingRepository);

      for (const entry of input.entries) {
        const content = entry.sourceText.replace(/\s+/g, " ").trim();
        const existing = await this.database.docketCommit.findFirst({
          where: {
            repositoryId: repository.id,
            sourceUrl: entry.sourceUrl,
            content,
            title: entry.title,
          },
        });
        if (existing !== null) {
          continue;
        }

        await this.appendImportedDocketEntry({
          repositoryId: repository.id,
          branchName: "main",
          actor: importer,
          entryType: entry.type,
          title: entry.title,
          sourceText: content,
          summary: entry.summary,
          publishedAt: new Date(`${entry.date}T00:00:00.000Z`),
          provenance: {
            kind: entry.type as
              "filing" | "opinion" | "order" | "student-argument" | "other",
            url: entry.sourceUrl,
            citation: entry.citation,
            documentHash: `sha256:${createHash("sha256")
              .update(content, "utf8")
              .digest("hex")}`,
            attribution: entry.attribution,
            isPublicRecord: entry.isPublicRecord,
          },
        });
      }

      const headSha = await this.git.getBranchHead(repository.id, "main");
      return {
        repositoryId: repository.id,
        slug: repository.slug,
        entriesImported: input.entries.length,
        headSha,
      };
    });
  }

  private async appendCommitInternal(
    input: AppendCommitInput,
    options: { allowCanonicalImport?: boolean } = {},
  ): Promise<CommitResult> {
    return this.execute(async () => {
      const safeDocumentPath = assertRepositoryFilePath(
        input.documentPath ?? argumentDocumentPath(input.title),
      );
      let previousHeadSha: string | null = null;
      let gitCommit: GitCommitRecord | null = null;

      try {
        return await this.database.$transaction(async (transaction) => {
          const repository = await transaction.caseRepository.findUnique({
            where: { id: input.repositoryId },
            select: {
              id: true,
              status: true,
              isPublic: true,
              isCanonicalSource: true,
              parentRepositoryId: true,
            },
          });

          if (repository === null) {
            throw new DomainError(
              "REPOSITORY_NOT_FOUND",
              "The target repository does not exist.",
            );
          }

          const branch = await transaction.branch.findUnique({
            where: {
              repositoryId_name: {
                repositoryId: input.repositoryId,
                name: input.branchName,
              },
            },
            include: { headCommit: { select: { id: true, sha: true } } },
          });
          if (branch === null) {
            throw new DomainError(
              "BRANCH_NOT_FOUND",
              "The target branch does not exist.",
            );
          }

          previousHeadSha = branch.headCommit?.sha ?? null;
          assertCanAppendCommit(
            repositoryPolicy(repository),
            previousHeadSha,
            input,
            options,
          );
          if (input.provenance === null) {
            throw new DomainError(
              "PROVENANCE_REQUIRED",
              "Every imported or generated statement must retain public provenance.",
            );
          }

          const actor = await this.ensureActor(transaction, input.actor);
          const document = renderCommitDocument(
            {
              entryType: input.entryType,
              title: input.title,
              publishedAt: (input.publishedAt ?? new Date()).toISOString(),
              author: input.actor.displayName,
              sourceUrl: input.provenance.url,
              citation: input.provenance.citation,
              attribution: input.provenance.attribution,
              summary: input.summary,
            },
            input.content,
          );
          gitCommit = await this.git.commitFile({
            repositoryId: input.repositoryId,
            branchName: input.branchName,
            filepath: safeDocumentPath,
            content: document,
            message: `${input.entryType}: ${input.title}`,
            author: {
              name: input.actor.displayName,
              email: actor.email,
            },
            expectedParentSha: previousHeadSha,
          });
          const summaryResult = await this.generateSummaryForCommit({
            sourceCommitSha: gitCommit.sha,
            title: input.title,
            entryType: input.entryType,
            publishedAt: input.publishedAt ?? new Date(),
            sourceText: input.content,
            manualSummary: input.summary,
            sourceUrl: input.provenance.url,
            citation: input.provenance.citation,
          });

          const commit = await transaction.docketCommit.create({
            data: {
              repositoryId: input.repositoryId,
              sha: gitCommit.sha,
              parentSha: gitCommit.parentShas[0] ?? null,
              parentShas: JSON.stringify(gitCommit.parentShas),
              authorId: actor.id,
              authorName: input.actor.displayName,
              entryType: input.entryType,
              title: input.title,
              content: input.content,
              documentPath: safeDocumentPath,
              sourceReference: input.provenance.url,
              sourceUrl: input.provenance.url,
              attribution: input.provenance.attribution,
              ...this.aiSummaryData(summaryResult, gitCommit.sha),
              publishedAt: input.publishedAt ?? new Date(),
            },
          });

          await transaction.branch.update({
            where: { id: branch.id },
            data: { headCommitId: commit.id },
          });
          await transaction.sourceRecord.create({
            data: {
              repositoryId: input.repositoryId,
              commitId: commit.id,
              kind: input.provenance.kind,
              url: input.provenance.url,
              citation: input.provenance.citation,
              documentHash: input.provenance.documentHash,
              attribution: input.provenance.attribution,
            },
          });
          await transaction.auditEvent.create({
            data: {
              repositoryId: input.repositoryId,
              actorId: actor.id,
              eventType: "commit.created",
              entityType: "docket_commit",
              entityId: commit.id,
              details: JSON.stringify({
                branch: input.branchName,
                filepath: safeDocumentPath,
                sha: commit.sha,
              }),
            },
          });
          await transaction.auditEvent.create({
            data: {
              repositoryId: input.repositoryId,
              actorId: actor.id,
              eventType:
                summaryResult.status === "generated"
                  ? "ai.summary.generated"
                  : summaryResult.status === "rejected"
                    ? "ai.summary.rejected"
                    : "ai.summary.fallback",
              entityType: "docket_commit",
              entityId: commit.id,
              details: JSON.stringify({
                status: summaryResult.status,
                model: summaryResult.model,
                promptVersion: summaryResult.promptVersion,
                sourceCommitSha: gitCommit.sha,
                citationIssues: summaryResult.citationIssues,
                error: summaryResult.error,
              }),
            },
          });

          return this.toCommitResult(commit);
        });
      } catch (error) {
        if (gitCommit !== null) {
          await this.restoreAfterFailure(
            input.repositoryId,
            input.branchName,
            previousHeadSha,
            error,
          );
        }
        throw error;
      }
    });
  }

  private async getBranchHeadFromDatabase(
    repositoryId: string,
    branchName: string,
  ): Promise<string | null> {
    const branch = await this.database.branch.findUnique({
      where: {
        repositoryId_name: {
          repositoryId,
          name: branchName,
        },
      },
      include: { headCommit: { select: { sha: true } } },
    });
    if (branch === null) {
      throw new DomainError(
        "BRANCH_NOT_FOUND",
        "The target branch does not exist.",
      );
    }

    return branch.headCommit?.sha ?? null;
  }

  private async findPullRequest(
    pullRequestId: string,
  ): Promise<PullRequestWithRelations> {
    const pullRequest = await this.database.pullRequest.findUnique({
      where: { id: pullRequestId },
      include: {
        sourceBranch: true,
        targetBranch: true,
        author: true,
        reviewer: true,
        reviews: {
          include: { reviewer: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (pullRequest === null) {
      throw new DomainError(
        "PULL_REQUEST_NOT_FOUND",
        "The requested pull request does not exist.",
      );
    }

    return pullRequest;
  }

  private toPullRequestSummary(
    pullRequest: PullRequestWithRelations,
    diff: FileDiff[],
  ): PullRequestSummary {
    const citationCheck =
      pullRequest.sourceUrl !== null && pullRequest.sourceCitation !== null
        ? lintCitation({
            citation: pullRequest.sourceCitation,
            sourceUrl: pullRequest.sourceUrl,
            sourceReferences: [pullRequest.sourceUrl],
            requireSourceReference: true,
          })
        : {
            valid: false,
            issues: [
              {
                code: "MISSING_PROVENANCE",
                message: "This pull request has no complete public citation.",
              },
            ],
          };

    return {
      id: pullRequest.id,
      repositoryId: pullRequest.repositoryId,
      sourceBranchName: pullRequest.sourceBranch.name,
      targetBranchName: pullRequest.targetBranch.name,
      sourceHeadSha: pullRequest.sourceHeadSha,
      targetHeadSha: pullRequest.targetHeadSha,
      title: pullRequest.title,
      description: pullRequest.description,
      status: pullRequest.status,
      hasConflicts: pullRequest.hasConflicts,
      authorName: pullRequest.author.displayName,
      reviewerName: pullRequest.reviewer?.displayName ?? null,
      createdAt: pullRequest.createdAt,
      updatedAt: pullRequest.updatedAt,
      mergedAt: pullRequest.mergedAt,
      sourceUrl: pullRequest.sourceUrl,
      sourceCitation: pullRequest.sourceCitation,
      sourceAttribution: pullRequest.sourceAttribution,
      citationCheck,
      reviews: pullRequest.reviews.map((review) => ({
        id: review.id,
        reviewerName: review.reviewer.displayName,
        decision: review.decision,
        comment: review.comment,
        createdAt: review.createdAt,
      })),
      diff,
    };
  }

  private parseAuditDetails(details: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(details) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Preserve malformed legacy details as a visible value.
    }

    return { raw: details };
  }

  private async generateSummaryForCommit(
    input: SummaryGenerationInput,
  ): Promise<SummaryGenerationResult> {
    return generateSummary(input, this.summaryProvider);
  }

  private aiSummaryData(
    result: SummaryGenerationResult,
    sourceCommitSha: string,
  ): {
    aiSummary: string;
    aiKeyIssue: string;
    aiOutcome: string;
    aiSourceReferences: string;
    aiSourceCommitSha: string;
    aiModel: string;
    aiPromptVersion: string;
    aiStatus: string;
    aiCitationWarnings: string;
    aiError: string | null;
    aiGeneratedAt: Date;
  } {
    return {
      aiSummary: result.summary,
      aiKeyIssue: result.keyIssue,
      aiOutcome: result.outcome,
      aiSourceReferences: JSON.stringify(result.sourceReferences),
      aiSourceCommitSha: sourceCommitSha,
      aiModel: result.model,
      aiPromptVersion: result.promptVersion,
      aiStatus: result.status,
      aiCitationWarnings: JSON.stringify(result.citationIssues),
      aiError: result.error,
      aiGeneratedAt: result.generatedAt,
    };
  }

  private async requireRepository(repositoryId: string) {
    const repository = await this.database.caseRepository.findUnique({
      where: { id: repositoryId },
    });
    if (repository === null) {
      throw new DomainError(
        "REPOSITORY_NOT_FOUND",
        "The target repository does not exist.",
      );
    }

    return repository;
  }

  private async ensureActor(
    transaction: Prisma.TransactionClient,
    actor: Actor,
  ): Promise<{ id: string; email: string }> {
    const email = actorEmail(actor);
    const user = await transaction.user.upsert({
      where: { email },
      update: {
        displayName: actor.displayName,
        role: actor.role,
      },
      create: {
        email,
        displayName: actor.displayName,
        role: actor.role,
      },
      select: { id: true, email: true },
    });
    return user;
  }

  private async findOrCreateActor(
    actor: Actor,
  ): Promise<{ id: string; email: string }> {
    return this.database.$transaction((transaction) =>
      this.ensureActor(transaction, actor),
    );
  }

  private toRepositorySummary(repository: {
    id: string;
    slug: string;
    title: string;
    court: string;
    docketNumber: string;
    jurisdiction: string;
    status: string;
    isPublic: boolean;
    isCanonicalSource: boolean;
    parentRepositoryId: string | null;
    sourceUrl: string | null;
    sourceAttribution: string | null;
  }): RepositorySummary {
    return repository;
  }

  private toBranchSummary(branch: {
    id: string;
    repositoryId: string;
    name: string;
    isProtected: boolean;
    headCommit: { sha: string } | null;
  }): BranchSummary {
    return {
      id: branch.id,
      repositoryId: branch.repositoryId,
      name: branch.name,
      headSha: branch.headCommit?.sha ?? null,
      isProtected: branch.isProtected,
    };
  }

  private toCommitResult(commit: {
    id: string;
    sha: string;
    parentSha: string | null;
    parentShas: string | null;
    documentPath: string | null;
  }): CommitResult {
    return {
      id: commit.id,
      sha: commit.sha,
      parentSha: commit.parentSha,
      parentShas: parseParentShas(commit.parentShas, commit.parentSha),
      documentPath: commit.documentPath ?? "",
    };
  }

  private toCommitSummary(commit: {
    id: string;
    sha: string;
    parentSha: string | null;
    parentShas: string | null;
    authorName: string;
    entryType: string;
    title: string;
    content: string;
    documentPath: string | null;
    sourceReference: string | null;
    sourceUrl: string | null;
    sourceRecords?: Array<{
      citation: string | null;
      documentHash: string;
    }>;
    attribution: string;
    aiSummary: string | null;
    aiKeyIssue: string | null;
    aiOutcome: string | null;
    aiSourceReferences: string | null;
    aiSourceCommitSha: string | null;
    aiModel: string | null;
    aiPromptVersion: string | null;
    aiStatus: string | null;
    aiCitationWarnings: string | null;
    aiError: string | null;
    aiGeneratedAt: Date | null;
    publishedAt: Date;
    createdAt: Date;
  }): CommitSummary {
    return {
      id: commit.id,
      sha: commit.sha,
      parentSha: commit.parentSha,
      authorName: commit.authorName,
      entryType: commit.entryType,
      title: commit.title,
      content: commit.content,
      documentPath: commit.documentPath,
      sourceReference: commit.sourceReference,
      sourceUrl: commit.sourceUrl,
      sourceCitation: commit.sourceRecords?.[0]?.citation ?? null,
      sourceDocumentHash: commit.sourceRecords?.[0]?.documentHash ?? null,
      parentShas: parseParentShas(commit.parentShas, commit.parentSha),
      attribution: commit.attribution,
      publishedAt: commit.publishedAt,
      createdAt: commit.createdAt,
      docketLabel: `${commit.entryType}: ${commit.title}`,
      aiSummary: commit.aiSummary,
      aiKeyIssue: commit.aiKeyIssue,
      aiOutcome: commit.aiOutcome,
      aiSourceReferences: parseJsonStringArray(commit.aiSourceReferences),
      aiSourceCommitSha: commit.aiSourceCommitSha,
      aiModel: commit.aiModel,
      aiPromptVersion: commit.aiPromptVersion,
      aiStatus: commit.aiStatus,
      aiCitationWarnings: parseCitationWarnings(commit.aiCitationWarnings),
      aiError: commit.aiError,
      aiGeneratedAt: commit.aiGeneratedAt,
    };
  }

  private async restoreAfterFailure(
    repositoryId: string,
    branchName: string,
    previousHeadSha: string | null,
    originalError: unknown,
  ): Promise<void> {
    try {
      await this.git.restoreBranch(repositoryId, branchName, previousHeadSha);
    } catch (cleanupError) {
      throw new DomainError(
        "GIT_OPERATION_FAILED",
        `The Git branch could not be restored after a failed metadata transaction: ${
          cleanupError instanceof Error
            ? cleanupError.message
            : "unknown cleanup error"
        } (original error: ${
          originalError instanceof Error
            ? originalError.message
            : "unknown error"
        })`,
      );
    }
  }

  private async cleanupRepositoryStorage(repositoryId: string): Promise<void> {
    try {
      await this.git.remove(repositoryId);
    } catch (cleanupError) {
      throw new DomainError(
        "GIT_OPERATION_FAILED",
        `Repository storage cleanup failed: ${
          cleanupError instanceof Error ? cleanupError.message : "unknown error"
        }`,
      );
    }
  }

  private async cleanupBranch(
    repositoryId: string,
    branchName: string,
  ): Promise<void> {
    try {
      await this.git.restoreBranch(repositoryId, branchName, null);
    } catch (cleanupError) {
      throw new DomainError(
        "GIT_OPERATION_FAILED",
        `Branch cleanup failed: ${
          cleanupError instanceof Error ? cleanupError.message : "unknown error"
        }`,
      );
    }
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.toDomainError(error);
    }
  }

  private toDomainError(error: unknown): DomainError {
    if (error instanceof DomainError) {
      return error;
    }

    if (error instanceof GitRepositoryError) {
      const code =
        error.code === "MERGE_CONFLICT"
          ? "MERGE_CONFLICT"
          : error.code === "STALE_BRANCH"
            ? "STALE_BRANCH"
            : error.code === "BRANCH_NOT_FOUND"
              ? "BRANCH_NOT_FOUND"
              : error.code === "COMMIT_NOT_FOUND"
                ? "COMMIT_NOT_FOUND"
                : error.code === "INVALID_DOCUMENT_PATH"
                  ? "INVALID_DOCUMENT_PATH"
                  : error.code === "GIT_REPOSITORY_NOT_FOUND"
                    ? "GIT_REPOSITORY_NOT_FOUND"
                    : "GIT_OPERATION_FAILED";
      return new DomainError(code, error.message);
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return new DomainError(
        "REPOSITORY_EXISTS",
        "A repository or branch with that identifier already exists.",
      );
    }

    return new DomainError(
      "GIT_OPERATION_FAILED",
      error instanceof Error ? error.message : "Repository operation failed.",
    );
  }
}
