import fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";

import * as git from "isomorphic-git";

import { createLineDiff, type FileDiff } from "@/lib/git/diff";
import { GitRepositoryError } from "@/lib/git/errors";
import {
  assertBranchName,
  assertRepositoryFilePath,
  assertRepositoryId,
} from "@/lib/git/paths";
import type {
  GitAuthor,
  GitBlameLine,
  GitCommitRecord,
  GitMergeResult,
  RepositoryAdapter,
} from "@/lib/git/repository-adapter";

type FileSnapshot = {
  filepath: string;
  content: string;
};

class RepositoryLock {
  private readonly tails = new Map<string, Promise<void>>();

  async runMany<T>(keys: string[], operation: () => Promise<T>): Promise<T> {
    const uniqueKeys = [...new Set(keys)].sort();
    const runNext = (index: number): Promise<T> => {
      if (index === uniqueKeys.length) {
        return operation();
      }

      return this.run(uniqueKeys[index], () => runNext(index + 1));
    };

    return runNext(0);
  }

  async run<T>(repositoryId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(repositoryId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(repositoryId, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(repositoryId) === tail) {
        this.tails.delete(repositoryId);
      }
    }
  }
}

const repositoryLock = new RepositoryLock();

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function isNotFoundError(error: unknown): boolean {
  const code = errorCode(error);
  const name = errorName(error);
  return (
    code === "ENOENT" ||
    code === "NotFoundError" ||
    code === "NoRefFoundError" ||
    name === "NotFoundError" ||
    name === "NoRefFoundError"
  );
}

function toGitAuthor(author: GitAuthor): {
  name: string;
  email: string;
} {
  return { name: author.name, email: author.email };
}

function toCommitRecord(
  oid: string,
  commit: git.CommitObject,
): GitCommitRecord {
  return {
    sha: oid,
    parentShas: commit.parent,
    message: commit.message,
    author: {
      name: commit.author.name,
      email: commit.author.email,
    },
    authoredAt: new Date(commit.author.timestamp * 1000),
  };
}

export class IsomorphicGitRepositoryAdapter implements RepositoryAdapter {
  private readonly lock = repositoryLock;
  private readonly root: string;

  constructor(rootDirectory = process.env.GIT_REPOSITORIES_PATH) {
    const fallbackRoot =
      process.env.NODE_ENV === "production"
        ? path.join("/tmp", "gitcourt-repositories")
        : path.join(process.cwd(), ".data", "repositories");
    this.root = path.resolve(
      /* turbopackIgnore: true */ rootDirectory ?? fallbackRoot,
    );
  }

  async initialize(repositoryId: string, defaultBranch: string): Promise<void> {
    assertRepositoryId(repositoryId);

    await this.lock.run(this.lockKey(repositoryId), async () => {
      await fsPromises.mkdir(this.root, { recursive: true });
      const repositoryPath = this.repositoryPath(repositoryId);

      if (await this.exists(repositoryPath)) {
        if (await this.exists(path.join(repositoryPath, ".git"))) {
          return;
        }

        throw new GitRepositoryError(
          "GIT_OPERATION_FAILED",
          "Repository storage exists without a Git repository.",
        );
      }

      await fsPromises.mkdir(repositoryPath, { recursive: true });
      await git.init({
        fs,
        dir: repositoryPath,
        defaultBranch,
      });
    });
  }

  async remove(repositoryId: string): Promise<void> {
    assertRepositoryId(repositoryId);
    await this.lock.run(this.lockKey(repositoryId), () =>
      fsPromises.rm(this.repositoryPath(repositoryId), {
        recursive: true,
        force: true,
      }),
    );
  }

  async clone(
    sourceRepositoryId: string,
    targetRepositoryId: string,
  ): Promise<void> {
    assertRepositoryId(sourceRepositoryId);
    assertRepositoryId(targetRepositoryId);

    await this.lock.runMany(
      [this.lockKey(sourceRepositoryId), this.lockKey(targetRepositoryId)],
      async () => {
        const sourcePath = await this.requireRepository(sourceRepositoryId);
        const targetPath = this.repositoryPath(targetRepositoryId);

        if (await this.exists(targetPath)) {
          throw new GitRepositoryError(
            "GIT_OPERATION_FAILED",
            "The target repository storage already exists.",
          );
        }

        await fsPromises.cp(sourcePath, targetPath, { recursive: true });
      },
    );
  }

  async createBranch(
    repositoryId: string,
    branchName: string,
    fromSha: string | null,
  ): Promise<void> {
    assertBranchName(branchName);
    await this.lock.run(this.lockKey(repositoryId), async () => {
      const repositoryPath = await this.requireRepository(repositoryId);
      if (fromSha === null) {
        return;
      }

      try {
        await git.branch({
          fs,
          dir: repositoryPath,
          ref: branchName,
          object: fromSha,
        });
      } catch (error) {
        throw this.toGitError(error, "Unable to create the Git branch.");
      }
    });
  }

  async getBranchHead(
    repositoryId: string,
    branchName: string,
  ): Promise<string | null> {
    assertBranchName(branchName);
    const repositoryPath = await this.requireRepository(repositoryId);

    try {
      return await git.resolveRef({
        fs,
        dir: repositoryPath,
        ref: branchName,
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }

      throw this.toGitError(error, "Unable to resolve the Git branch head.");
    }
  }

  async restoreBranch(
    repositoryId: string,
    branchName: string,
    previousHeadSha: string | null,
  ): Promise<void> {
    assertBranchName(branchName);
    await this.lock.run(this.lockKey(repositoryId), async () => {
      const repositoryPath = await this.requireRepository(repositoryId);

      try {
        if (previousHeadSha === null) {
          await git.deleteBranch({
            fs,
            dir: repositoryPath,
            ref: branchName,
          });
          return;
        }

        await git.writeRef({
          fs,
          dir: repositoryPath,
          ref: branchName,
          value: previousHeadSha,
          force: true,
        });
        await git.checkout({
          fs,
          dir: repositoryPath,
          ref: branchName,
          force: true,
        });
      } catch (error) {
        if (previousHeadSha === null && isNotFoundError(error)) {
          return;
        }

        throw this.toGitError(error, "Unable to restore the Git branch head.");
      }
    });
  }

  async commitFile(input: {
    repositoryId: string;
    branchName: string;
    filepath: string;
    content: string;
    message: string;
    author: GitAuthor;
    expectedParentSha: string | null;
  }): Promise<GitCommitRecord> {
    const filepath = assertRepositoryFilePath(input.filepath);
    assertBranchName(input.branchName);

    return this.lock.run(this.lockKey(input.repositoryId), async () => {
      const repositoryPath = await this.requireRepository(input.repositoryId);
      const actualParentSha = await this.getBranchHead(
        input.repositoryId,
        input.branchName,
      );

      if (actualParentSha !== input.expectedParentSha) {
        throw new GitRepositoryError(
          "STALE_BRANCH",
          "The Git branch changed before this commit was created.",
        );
      }

      try {
        if (actualParentSha !== null) {
          await git.checkout({
            fs,
            dir: repositoryPath,
            ref: input.branchName,
            force: true,
          });
        }

        await fsPromises.mkdir(
          path.dirname(path.join(repositoryPath, filepath)),
          {
            recursive: true,
          },
        );
        await fsPromises.writeFile(
          path.join(repositoryPath, filepath),
          input.content,
          "utf8",
        );
        await git.add({
          fs,
          dir: repositoryPath,
          filepath,
        });

        const sha = await git.commit({
          fs,
          dir: repositoryPath,
          ref: input.branchName,
          parent: actualParentSha === null ? [] : [actualParentSha],
          message: input.message,
          author: toGitAuthor(input.author),
          committer: toGitAuthor(input.author),
        });
        const commit = await git.readCommit({
          fs,
          dir: repositoryPath,
          oid: sha,
        });

        return toCommitRecord(sha, commit.commit);
      } catch (error) {
        throw this.toGitError(error, "Unable to create the Git commit.");
      }
    });
  }

  async getHistory(
    repositoryId: string,
    ref: string,
  ): Promise<GitCommitRecord[]> {
    const repositoryPath = await this.requireRepository(repositoryId);

    try {
      const history = await git.log({
        fs,
        dir: repositoryPath,
        ref,
      });
      return history.map(({ oid, commit }) => toCommitRecord(oid, commit));
    } catch (error) {
      throw this.toGitError(error, "Unable to read the Git history.");
    }
  }

  async readFile(
    repositoryId: string,
    ref: string,
    filepath: string,
  ): Promise<string | null> {
    const safeFilepath = assertRepositoryFilePath(filepath);
    const repositoryPath = await this.requireRepository(repositoryId);

    try {
      const oid = await git.resolveRef({
        fs,
        dir: repositoryPath,
        ref,
      });
      const result = await git.readBlob({
        fs,
        dir: repositoryPath,
        oid,
        filepath: safeFilepath,
      });
      return Buffer.from(result.blob).toString("utf8");
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }

      throw this.toGitError(error, "Unable to read the Git document.");
    }
  }

  async getDiff(
    repositoryId: string,
    fromRef: string | null,
    toRef: string,
  ): Promise<FileDiff[]> {
    const repositoryPath = await this.requireRepository(repositoryId);
    const before =
      fromRef === null
        ? new Map<string, string>()
        : await this.listFiles(repositoryPath, fromRef);
    const after = await this.listFiles(repositoryPath, toRef);
    const filepaths = new Set([...before.keys(), ...after.keys()]);

    return [...filepaths].sort().flatMap((filepath) => {
      const beforeContent = before.get(filepath) ?? null;
      const afterContent = after.get(filepath) ?? null;

      if (beforeContent === afterContent) {
        return [];
      }

      return [
        {
          filepath,
          before: beforeContent,
          after: afterContent,
          lines: createLineDiff(beforeContent, afterContent),
        },
      ];
    });
  }

  async mergeBranches(input: {
    repositoryId: string;
    targetBranchName: string;
    sourceBranchName: string;
    author: GitAuthor;
    message: string;
    expectedTargetHeadSha: string;
  }): Promise<GitMergeResult> {
    assertBranchName(input.targetBranchName);
    assertBranchName(input.sourceBranchName);
    return this.lock.run(this.lockKey(input.repositoryId), async () => {
      const repositoryPath = await this.requireRepository(input.repositoryId);
      const actualTargetHeadSha = await this.getBranchHead(
        input.repositoryId,
        input.targetBranchName,
      );

      if (actualTargetHeadSha !== input.expectedTargetHeadSha) {
        throw new GitRepositoryError(
          "STALE_BRANCH",
          "The target Git branch changed before the merge was created.",
        );
      }

      try {
        await git.checkout({
          fs,
          dir: repositoryPath,
          ref: input.targetBranchName,
          force: true,
        });
        const result = await git.merge({
          fs,
          dir: repositoryPath,
          ours: input.targetBranchName,
          theirs: input.sourceBranchName,
          fastForward: false,
          abortOnConflict: true,
          message: input.message,
          author: toGitAuthor(input.author),
          committer: toGitAuthor(input.author),
        });

        if (result.oid === undefined) {
          throw new GitRepositoryError(
            "GIT_OPERATION_FAILED",
            "Git did not return a merge commit.",
          );
        }

        const mergeCommit = await git.readCommit({
          fs,
          dir: repositoryPath,
          oid: result.oid,
        });

        return {
          commit: toCommitRecord(result.oid, mergeCommit.commit),
          alreadyMerged: result.alreadyMerged === true,
        };
      } catch (error) {
        if (
          errorName(error) === "MergeConflictError" ||
          errorName(error) === "MergeNotSupportedError"
        ) {
          throw new GitRepositoryError(
            "MERGE_CONFLICT",
            "The Git branches contain conflicting document changes.",
            { cause: error },
          );
        }

        if (error instanceof GitRepositoryError) {
          throw error;
        }

        throw this.toGitError(error, "Unable to merge the Git branches.");
      }
    });
  }

  async previewMergeBranches(input: {
    repositoryId: string;
    targetBranchName: string;
    sourceBranchName: string;
  }): Promise<{ hasConflicts: boolean }> {
    assertBranchName(input.targetBranchName);
    assertBranchName(input.sourceBranchName);

    return this.lock.run(this.lockKey(input.repositoryId), async () => {
      const repositoryPath = await this.requireRepository(input.repositoryId);

      try {
        await git.checkout({
          fs,
          dir: repositoryPath,
          ref: input.targetBranchName,
          force: true,
        });
        await git.merge({
          fs,
          dir: repositoryPath,
          ours: input.targetBranchName,
          theirs: input.sourceBranchName,
          fastForward: false,
          dryRun: true,
          abortOnConflict: true,
          message: "Git Court merge preview",
          author: {
            name: "Git Court merge preview",
            email: "merge-preview@gitcourt.local",
          },
          committer: {
            name: "Git Court merge preview",
            email: "merge-preview@gitcourt.local",
          },
        });
        return { hasConflicts: false };
      } catch (error) {
        if (
          errorName(error) === "MergeConflictError" ||
          errorName(error) === "MergeNotSupportedError"
        ) {
          return { hasConflicts: true };
        }

        throw this.toGitError(error, "Unable to preview the Git merge.");
      }
    });
  }

  async blame(
    repositoryId: string,
    ref: string,
    filepath: string,
  ): Promise<GitBlameLine[]> {
    const safeFilepath = assertRepositoryFilePath(filepath);
    const history = await this.getHistory(repositoryId, ref);
    const chronologicalHistory = [...history].reverse();
    let previousLines: string[] = [];
    let origins: Array<GitCommitRecord | null> = [];

    for (const commit of chronologicalHistory) {
      const document = await this.readFile(
        repositoryId,
        commit.sha,
        safeFilepath,
      );
      if (document === null) {
        continue;
      }

      const currentLines = document.split("\n");
      if (origins.length === 0) {
        origins = currentLines.map(() => commit);
      } else {
        origins = this.carryLineOrigins(
          previousLines,
          currentLines,
          origins,
          commit,
        );
      }
      previousLines = currentLines;
    }

    if (origins.length === 0 || previousLines.length === 0) {
      throw new GitRepositoryError(
        "COMMIT_NOT_FOUND",
        "The requested document does not exist in the Git history.",
      );
    }

    return previousLines.map((text, index) => ({
      lineNumber: index + 1,
      text,
      commit: origins[index] ?? history[0],
    }));
  }

  private repositoryPath(repositoryId: string): string {
    assertRepositoryId(repositoryId);
    return path.join(this.root, repositoryId);
  }

  private lockKey(repositoryId: string): string {
    return `${this.root}\u0000${repositoryId}`;
  }

  private async requireRepository(repositoryId: string): Promise<string> {
    const repositoryPath = this.repositoryPath(repositoryId);

    if (!(await this.exists(path.join(repositoryPath, ".git")))) {
      throw new GitRepositoryError(
        "GIT_REPOSITORY_NOT_FOUND",
        "The Git repository storage does not exist.",
      );
    }

    return repositoryPath;
  }

  private async exists(targetPath: string): Promise<boolean> {
    try {
      await fsPromises.access(targetPath);
      return true;
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return false;
      }

      throw new GitRepositoryError(
        "GIT_OPERATION_FAILED",
        "Unable to inspect repository storage.",
        { cause: error },
      );
    }
  }

  private async listFiles(
    repositoryPath: string,
    ref: string,
  ): Promise<Map<string, string>> {
    try {
      const snapshots = await git.walk({
        fs,
        dir: repositoryPath,
        trees: [git.TREE({ ref })],
        map: async (filepath, entries) => {
          const entry = entries[0];
          if (entry === null || filepath === ".") {
            return undefined;
          }

          if ((await entry.type()) !== "blob") {
            return undefined;
          }

          const content = await entry.content();
          if (content === undefined) {
            return undefined;
          }

          return {
            filepath,
            content: Buffer.from(content).toString("utf8"),
          } satisfies FileSnapshot;
        },
        reduce: async (parent, children) => {
          const snapshots = children
            .flat(Infinity)
            .filter((child): child is FileSnapshot => child !== undefined);
          if (parent !== undefined) {
            snapshots.unshift(parent);
          }
          return snapshots;
        },
      });

      return new Map(
        snapshots.map((snapshot: FileSnapshot) => [
          snapshot.filepath,
          snapshot.content,
        ]),
      );
    } catch (error) {
      throw this.toGitError(error, "Unable to read the Git tree.");
    }
  }

  private carryLineOrigins(
    previousLines: string[],
    currentLines: string[],
    previousOrigins: Array<GitCommitRecord | null>,
    currentCommit: GitCommitRecord,
  ): Array<GitCommitRecord | null> {
    const rows = Array.from({ length: previousLines.length + 1 }, () =>
      Array<number>(currentLines.length + 1).fill(0),
    );

    for (
      let previousIndex = previousLines.length - 1;
      previousIndex >= 0;
      previousIndex -= 1
    ) {
      for (
        let currentIndex = currentLines.length - 1;
        currentIndex >= 0;
        currentIndex -= 1
      ) {
        rows[previousIndex][currentIndex] =
          previousLines[previousIndex] === currentLines[currentIndex]
            ? rows[previousIndex + 1][currentIndex + 1] + 1
            : Math.max(
                rows[previousIndex + 1][currentIndex],
                rows[previousIndex][currentIndex + 1],
              );
      }
    }

    const origins: Array<GitCommitRecord | null> = [];
    let previousIndex = 0;
    let currentIndex = 0;
    while (currentIndex < currentLines.length) {
      if (
        previousIndex < previousLines.length &&
        previousLines[previousIndex] === currentLines[currentIndex]
      ) {
        origins.push(previousOrigins[previousIndex] ?? currentCommit);
        previousIndex += 1;
        currentIndex += 1;
      } else if (
        previousIndex < previousLines.length &&
        (currentIndex === currentLines.length ||
          rows[previousIndex + 1][currentIndex] >=
            rows[previousIndex][currentIndex + 1])
      ) {
        previousIndex += 1;
      } else {
        origins.push(currentCommit);
        currentIndex += 1;
      }
    }

    return origins;
  }

  private toGitError(error: unknown, message: string): GitRepositoryError {
    if (error instanceof GitRepositoryError) {
      return error;
    }

    if (isNotFoundError(error)) {
      return new GitRepositoryError("COMMIT_NOT_FOUND", message, {
        cause: error,
      });
    }

    return new GitRepositoryError("GIT_OPERATION_FAILED", message, {
      cause: error,
    });
  }
}
