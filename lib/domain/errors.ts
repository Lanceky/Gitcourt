export type DomainErrorCode =
  | "CANONICAL_REPOSITORY_READ_ONLY"
  | "REPOSITORY_ARCHIVED"
  | "REPOSITORY_NOT_PUBLIC"
  | "INVALID_FORK_PARENT"
  | "STALE_BRANCH"
  | "INVALID_COMMIT_CONTENT"
  | "INVALID_COMMIT_HASH"
  | "MERGE_FORBIDDEN"
  | "PULL_REQUEST_NOT_OPEN"
  | "MERGE_CONFLICT"
  | "PROVENANCE_REQUIRED"
  | "PROVENANCE_NOT_PUBLIC"
  | "PROVENANCE_URL_INVALID";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
