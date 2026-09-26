export type GitRepositoryErrorCode =
  | "GIT_REPOSITORY_NOT_FOUND"
  | "BRANCH_NOT_FOUND"
  | "COMMIT_NOT_FOUND"
  | "STALE_BRANCH"
  | "INVALID_DOCUMENT_PATH"
  | "MERGE_CONFLICT"
  | "GIT_OPERATION_FAILED";

export class GitRepositoryError extends Error {
  constructor(
    readonly code: GitRepositoryErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GitRepositoryError";
  }
}
