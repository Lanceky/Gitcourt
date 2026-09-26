import type { FileDiff } from "@/lib/git/diff";

export type GitAuthor = {
  name: string;
  email: string;
};

export type GitCommitRecord = {
  sha: string;
  parentShas: string[];
  message: string;
  author: GitAuthor;
  authoredAt: Date;
};

export type GitBlameLine = {
  lineNumber: number;
  text: string;
  commit: GitCommitRecord;
};

export type GitMergeResult = {
  commit: GitCommitRecord;
  alreadyMerged: boolean;
};

export interface RepositoryAdapter {
  initialize(repositoryId: string, defaultBranch: string): Promise<void>;
  remove(repositoryId: string): Promise<void>;
  clone(sourceRepositoryId: string, targetRepositoryId: string): Promise<void>;
  createBranch(
    repositoryId: string,
    branchName: string,
    fromSha: string | null,
  ): Promise<void>;
  getBranchHead(
    repositoryId: string,
    branchName: string,
  ): Promise<string | null>;
  restoreBranch(
    repositoryId: string,
    branchName: string,
    previousHeadSha: string | null,
  ): Promise<void>;
  commitFile(input: {
    repositoryId: string;
    branchName: string;
    filepath: string;
    content: string;
    message: string;
    author: GitAuthor;
    expectedParentSha: string | null;
  }): Promise<GitCommitRecord>;
  getHistory(repositoryId: string, ref: string): Promise<GitCommitRecord[]>;
  readFile(
    repositoryId: string,
    ref: string,
    filepath: string,
  ): Promise<string | null>;
  getDiff(
    repositoryId: string,
    fromRef: string | null,
    toRef: string,
  ): Promise<FileDiff[]>;
  mergeBranches(input: {
    repositoryId: string;
    targetBranchName: string;
    sourceBranchName: string;
    author: GitAuthor;
    message: string;
    expectedTargetHeadSha: string;
  }): Promise<GitMergeResult>;
  blame(
    repositoryId: string,
    ref: string,
    filepath: string,
  ): Promise<GitBlameLine[]>;
}
