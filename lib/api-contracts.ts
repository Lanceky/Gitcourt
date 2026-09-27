import { z } from "zod";

const persistedCommitSchema = z.object({
  sha: z.string(),
  title: z.string(),
  publishedAt: z.coerce.date(),
  aiSummary: z.string().nullable(),
  aiKeyIssue: z.string().nullable(),
  aiOutcome: z.string().nullable(),
  aiSourceReferences: z.array(z.string()),
  aiSourceCommitSha: z.string().nullable(),
  aiModel: z.string().nullable(),
  aiPromptVersion: z.string().nullable(),
  aiStatus: z.string().nullable(),
  aiCitationWarnings: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
    }),
  ),
  aiError: z.string().nullable(),
  aiGeneratedAt: z.coerce.date().nullable(),
});

export const caseReadResponseSchema = z.object({
  history: z.array(persistedCommitSchema),
});

export type CaseReadResponse = z.infer<typeof caseReadResponseSchema>;
