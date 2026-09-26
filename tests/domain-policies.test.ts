import assert from "node:assert/strict";
import test from "node:test";

import { createCommitHash } from "@/lib/domain/commit-hash";
import { DomainError } from "@/lib/domain/errors";
import {
  assertCanAppendCommit,
  assertCanMergePullRequest,
  assertCanWriteRepository,
  assertCommitHashMatches,
  assertForkIsolation,
  assertPublicRecordProvenance,
} from "@/lib/domain/policies";
import type {
  Actor,
  CommitHashInput,
  CommitProvenance,
  RepositoryPolicyRecord,
} from "@/lib/domain/types";

const reviewer: Actor = {
  id: "reviewer-1",
  displayName: "Clinic reviewer",
  role: "reviewer",
};

const student: Actor = {
  id: "student-1",
  displayName: "Student builder",
  role: "student",
};

const canonicalRepository: RepositoryPolicyRecord = {
  id: "case-1",
  status: "public",
  isPublic: true,
  isCanonicalSource: true,
  parentRepositoryId: null,
};

const studentFork: RepositoryPolicyRecord = {
  id: "fork-1",
  status: "fork",
  isPublic: false,
  isCanonicalSource: false,
  parentRepositoryId: canonicalRepository.id,
};

const provenance: CommitProvenance = {
  kind: "student-argument",
  url: "https://example.test/public-case",
  citation: "Public case fixture",
  documentHash: "sha256:fixture",
  attribution: "Public case fixture source",
  isPublicRecord: true,
};

const commitInput = {
  parentSha: null,
  entryType: "argument",
  title: "Alternative theory",
  content: "The student proposes a different reading of the public record.",
  provenance,
};

function expectDomainError(code: string, callback: () => void): void {
  assert.throws(callback, (error: unknown) => {
    return error instanceof DomainError && error.code === code;
  });
}

test("canonical public repositories are read-only", () => {
  expectDomainError("CANONICAL_REPOSITORY_READ_ONLY", () =>
    assertCanWriteRepository(canonicalRepository),
  );
});

test("forks retain their source relationship and cannot replace the source", () => {
  assert.doesNotThrow(() =>
    assertForkIsolation(canonicalRepository, studentFork),
  );
  expectDomainError("INVALID_FORK_PARENT", () =>
    assertForkIsolation(canonicalRepository, {
      ...studentFork,
      parentRepositoryId: null,
    }),
  );
});

test("append policy rejects stale branches and accepts sourced fork commits", () => {
  expectDomainError("STALE_BRANCH", () =>
    assertCanAppendCommit(studentFork, "head-a", {
      ...commitInput,
      parentSha: "head-b",
    }),
  );
  assert.doesNotThrow(() =>
    assertCanAppendCommit(studentFork, null, commitInput),
  );
});

test("commit hashes are stable and content-sensitive", () => {
  const input: CommitHashInput = {
    parentSha: null,
    authorName: "Student builder",
    entryType: "argument",
    title: "Alternative theory",
    content: "A public-record argument.",
    sourceReference: "Public case fixture",
  };
  const sha = createCommitHash(input);

  assert.equal(createCommitHash(input), sha);
  assert.notEqual(
    createCommitHash({ ...input, content: "A changed argument." }),
    sha,
  );
  assert.doesNotThrow(() => assertCommitHashMatches(input, sha));
  expectDomainError("INVALID_COMMIT_HASH", () =>
    assertCommitHashMatches({ ...input, parentSha: "different-parent" }, sha),
  );
});

test("only the assigned reviewer or administrator can merge", () => {
  const pullRequest = {
    status: "open",
    sourceBranchId: "feature",
    targetBranchId: "main",
    reviewerId: reviewer.id,
    hasConflicts: false,
  };

  assert.doesNotThrow(() => assertCanMergePullRequest(pullRequest, reviewer));
  expectDomainError("MERGE_FORBIDDEN", () =>
    assertCanMergePullRequest(pullRequest, student),
  );
  expectDomainError("MERGE_CONFLICT", () =>
    assertCanMergePullRequest({ ...pullRequest, hasConflicts: true }, reviewer),
  );
});

test("provenance must identify a public HTTPS source", () => {
  assert.doesNotThrow(() => assertPublicRecordProvenance(provenance));
  expectDomainError("PROVENANCE_NOT_PUBLIC", () =>
    assertPublicRecordProvenance({ ...provenance, isPublicRecord: false }),
  );
  expectDomainError("PROVENANCE_URL_INVALID", () =>
    assertPublicRecordProvenance({ ...provenance, url: "http://private.test" }),
  );
});
