import type { PrismaClient } from "@prisma/client";

import { createCommitHash } from "@/lib/domain/commit-hash";
import { DomainError } from "@/lib/domain/errors";
import {
  assertCanAppendCommit,
  assertCommitHashMatches,
} from "@/lib/domain/policies";
import type { AppendCommitInput } from "@/lib/domain/types";

export class CaseRepositoryService {
  constructor(private readonly database: PrismaClient) {}

  async appendCommit(
    input: AppendCommitInput,
  ): Promise<{ id: string; sha: string }> {
    return this.database.$transaction(async (transaction) => {
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
          "INVALID_FORK_PARENT",
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
        select: { id: true, headCommitId: true },
      });

      if (branch === null) {
        throw new DomainError(
          "STALE_BRANCH",
          "The target branch does not exist.",
        );
      }

      const provenance = input.provenance;
      let currentHeadSha: string | null = null;
      if (branch.headCommitId !== null) {
        const headCommit = await transaction.docketCommit.findUnique({
          where: { id: branch.headCommitId },
          select: { sha: true },
        });

        if (headCommit === null) {
          throw new DomainError(
            "STALE_BRANCH",
            "The target branch points to a missing commit.",
          );
        }

        currentHeadSha = headCommit.sha;
      }

      assertCanAppendCommit(repository, currentHeadSha, {
        ...input,
        provenance,
      });

      if (provenance === null) {
        throw new DomainError(
          "PROVENANCE_REQUIRED",
          "Every imported or generated statement must retain public provenance.",
        );
      }

      const sourceReference = provenance.citation;
      const hashInput = {
        parentSha: input.parentSha,
        authorName: input.actor.displayName,
        entryType: input.entryType,
        title: input.title,
        content: input.content,
        sourceReference,
      };
      const sha = createCommitHash(hashInput);
      assertCommitHashMatches(hashInput, sha);

      const commit = await transaction.docketCommit.create({
        data: {
          repositoryId: input.repositoryId,
          sha,
          parentSha: input.parentSha,
          authorId: input.actor.id,
          authorName: input.actor.displayName,
          entryType: input.entryType,
          title: input.title,
          content: input.content,
          sourceReference,
        },
        select: { id: true, sha: true },
      });

      await transaction.branch.update({
        where: { id: branch.id },
        data: { headCommitId: commit.id },
      });

      await transaction.sourceRecord.create({
        data: {
          repositoryId: input.repositoryId,
          commitId: commit.id,
          kind: provenance.kind,
          url: provenance.url,
          citation: provenance.citation,
          documentHash: provenance.documentHash,
        },
      });

      await transaction.auditEvent.create({
        data: {
          repositoryId: input.repositoryId,
          actorId: input.actor.id,
          eventType: "commit.created",
          entityType: "docket_commit",
          entityId: commit.id,
          details: JSON.stringify({
            branch: input.branchName,
            sha: commit.sha,
          }),
        },
      });

      return commit;
    });
  }
}
