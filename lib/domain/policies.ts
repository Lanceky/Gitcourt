import { createCommitHash } from "@/lib/domain/commit-hash";
import { DomainError } from "@/lib/domain/errors";
import type {
  Actor,
  CommitHashInput,
  CommitProvenance,
  PullRequestPolicyRecord,
  RepositoryPolicyRecord,
} from "@/lib/domain/types";

export function assertCanWriteRepository(
  repository: RepositoryPolicyRecord,
  options: { allowCanonicalImport?: boolean } = {},
): void {
  if (repository.isCanonicalSource && !options.allowCanonicalImport) {
    throw new DomainError(
      "CANONICAL_REPOSITORY_READ_ONLY",
      "The canonical public case record is read-only.",
    );
  }

  if (repository.status === "archived") {
    throw new DomainError(
      "REPOSITORY_ARCHIVED",
      "Archived repositories cannot receive new changes.",
    );
  }
}

export function assertCanForkRepository(
  repository: RepositoryPolicyRecord,
): void {
  if (!repository.isPublic) {
    throw new DomainError(
      "REPOSITORY_NOT_PUBLIC",
      "Only public case records can be forked.",
    );
  }
}

export function assertForkIsolation(
  source: RepositoryPolicyRecord,
  fork: RepositoryPolicyRecord,
): void {
  if (
    source.id === fork.id ||
    fork.parentRepositoryId !== source.id ||
    fork.isCanonicalSource
  ) {
    throw new DomainError(
      "INVALID_FORK_PARENT",
      "A fork must point to its source and cannot become the canonical record.",
    );
  }
}

export function assertCanAppendCommit(
  repository: RepositoryPolicyRecord,
  currentHeadSha: string | null,
  input: Pick<
    CommitHashInput,
    "parentSha" | "entryType" | "title" | "content"
  > & {
    provenance: CommitProvenance | null;
  },
  options: { allowCanonicalImport?: boolean } = {},
): void {
  assertCanWriteRepository(repository, options);

  if (input.parentSha !== currentHeadSha) {
    throw new DomainError(
      "STALE_BRANCH",
      "The branch changed before this commit was created.",
    );
  }

  if (
    input.entryType.trim().length === 0 ||
    input.title.trim().length === 0 ||
    input.content.trim().length === 0
  ) {
    throw new DomainError(
      "INVALID_COMMIT_CONTENT",
      "A commit requires an entry type, title, and content.",
    );
  }

  if (input.provenance === null) {
    throw new DomainError(
      "PROVENANCE_REQUIRED",
      "Every imported or generated statement must retain public provenance.",
    );
  }

  assertPublicRecordProvenance(input.provenance);
}

export function assertCommitHashMatches(
  input: CommitHashInput,
  actualSha: string,
): void {
  if (createCommitHash(input) !== actualSha) {
    throw new DomainError(
      "INVALID_COMMIT_HASH",
      "The commit hash does not match its immutable content and parent.",
    );
  }
}

export function assertCanMergePullRequest(
  pullRequest: PullRequestPolicyRecord,
  actor: Actor,
): void {
  if (pullRequest.status !== "open") {
    throw new DomainError(
      "PULL_REQUEST_NOT_OPEN",
      "Only open pull requests can be merged.",
    );
  }

  if (pullRequest.sourceBranchId === pullRequest.targetBranchId) {
    throw new DomainError(
      "MERGE_FORBIDDEN",
      "A pull request must compare two different branches.",
    );
  }

  if (pullRequest.hasConflicts) {
    throw new DomainError(
      "MERGE_CONFLICT",
      "Resolve the legal-theory conflict before merging.",
    );
  }

  const isAssignedReviewer =
    actor.role === "reviewer" && pullRequest.reviewerId === actor.id;
  const isAdministrator = actor.role === "admin";

  if (!isAssignedReviewer && !isAdministrator) {
    throw new DomainError(
      "MERGE_FORBIDDEN",
      "Only the assigned reviewer or an administrator can merge.",
    );
  }
}

export function assertPublicRecordProvenance(
  provenance: CommitProvenance,
): void {
  if (!provenance.isPublicRecord) {
    throw new DomainError(
      "PROVENANCE_NOT_PUBLIC",
      "Git Court accepts public records only.",
    );
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(provenance.url);
  } catch {
    throw new DomainError(
      "PROVENANCE_URL_INVALID",
      "A provenance record must contain a valid HTTPS URL.",
    );
  }

  if (
    sourceUrl.protocol !== "https:" ||
    provenance.documentHash.trim() === "" ||
    provenance.attribution.trim() === ""
  ) {
    throw new DomainError(
      "PROVENANCE_URL_INVALID",
      "A provenance record must contain a valid HTTPS URL, document hash, and attribution.",
    );
  }
}
