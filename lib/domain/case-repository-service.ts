import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { DomainError } from "@/lib/domain/errors";
import {
  assertCanAppendCommit,
  assertCanForkRepository,
  assertCanWriteRepository,
  assertForkIsolation,
} from "@/lib/domain/policies";
import type {
  Actor,
  AppendCommitInput,
  AppendDocketEntryInput,
  CreateBranchInput,
  CreateRepositoryInput,
  ForkRepositoryInput,
  MergeBranchInput,
  RepositoryPolicyRecord,
} from "@/lib/domain/types";
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

export type CommitSummary = {
  id: string;
  sha: string;
  parentSha: string | null;
  parentShas: string[];
  authorName: string;
  entryType: string;
  title: string;
  content: string;
  documentPath: string | null;
  sourceReference: string | null;
  sourceUrl: string | null;
  attribution: string;
  publishedAt: Date;
  createdAt: Date;
  docketLabel: string;
};

export type CommitResult = {
  id: string;
  sha: string;
  parentSha: string | null;
  parentShas: string[];
  documentPath: string;
};

export type BlameLine = GitBlameLine;

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
                aiModel: sourceCommit.aiModel,
                aiPromptVersion: sourceCommit.aiPromptVersion,
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
              aiSummary: input.summary,
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
    attribution: string;
    publishedAt: Date;
    createdAt: Date;
  }): CommitSummary {
    return {
      ...commit,
      parentShas: parseParentShas(commit.parentShas, commit.parentSha),
      docketLabel: `${commit.entryType}: ${commit.title}`,
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
