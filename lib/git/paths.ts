import path from "node:path";

import { GitRepositoryError } from "@/lib/git/errors";

const repositoryIdPattern = /^[A-Za-z0-9_-]+$/;
const repositoryFilePattern =
  /^(?:docket|arguments|notes)\/[A-Za-z0-9][A-Za-z0-9._/-]*\.md$/;
const branchNamePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function assertRepositoryId(repositoryId: string): void {
  if (!repositoryIdPattern.test(repositoryId)) {
    throw new GitRepositoryError(
      "GIT_OPERATION_FAILED",
      "Repository storage requires an internal repository identifier.",
    );
  }
}

export function assertRepositoryFilePath(filepath: string): string {
  const normalized = path.posix.normalize(filepath);

  if (
    normalized !== filepath ||
    filepath.includes("\\") ||
    filepath.startsWith("/") ||
    filepath.startsWith(".git") ||
    !repositoryFilePattern.test(filepath)
  ) {
    throw new GitRepositoryError(
      "INVALID_DOCUMENT_PATH",
      "Repository documents must be Markdown files under docket/, arguments/, or notes/.",
    );
  }

  return filepath;
}

export function assertBranchName(branchName: string): string {
  if (
    !branchNamePattern.test(branchName) ||
    branchName.includes("..") ||
    branchName.endsWith("/") ||
    branchName.endsWith(".") ||
    branchName.includes("@{")
  ) {
    throw new GitRepositoryError(
      "GIT_OPERATION_FAILED",
      "Branch names must be safe Git references.",
    );
  }

  return branchName;
}

export function slugifyDocumentPart(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "-");

  return slug || "untitled";
}
