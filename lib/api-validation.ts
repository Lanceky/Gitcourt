import { z } from "zod";

import { assertRepositoryFilePath } from "@/lib/git/paths";

const internalIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const branchNamePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;

export const internalIdSchema = z
  .string()
  .trim()
  .regex(
    internalIdPattern,
    "Identifiers must contain only letters, numbers, hyphens, or underscores.",
  );

export const gitShaSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{40}$/i, "Use a full Git commit SHA.");

export const fixtureOrGitShaSchema = z
  .string()
  .trim()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i, "Use a full commit identifier.");

export const branchNameSchema = z
  .string()
  .trim()
  .regex(branchNamePattern, "Use a safe Git branch name.")
  .refine(
    (value) =>
      !value.includes("..") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.includes("@{"),
    "Use a safe Git branch name.",
  );

export const publicHttpsUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (value) => new URL(value).protocol === "https:",
    "Public sources must use HTTPS URLs.",
  );

export const repositoryFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .superRefine((value, context) => {
    try {
      assertRepositoryFilePath(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Repository documents must be Markdown files under docket/, arguments/, or notes/.",
      });
    }
  });

export const repositoryRefSchema = z.union([gitShaSchema, branchNameSchema]);

export const repositoryIdParamsSchema = z.object({
  repositoryId: internalIdSchema,
});

export const pullRequestIdParamsSchema = z.object({
  pullRequestId: internalIdSchema,
});
