import { z } from "zod";

import {
  formatCitationLintIssues,
  lintCitation,
  type CitationLintIssue,
} from "@/lib/ai/citation-lint";

export const AI_SUMMARY_PROMPT_VERSION = "lexhack-summary-v1";
export const MANUAL_FALLBACK_PROMPT_VERSION = "manual-fallback-v1";

const generatedSummarySchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  keyIssue: z.string().trim().min(1).max(1200),
  outcome: z.string().trim().min(1).max(1200),
  sourceReferences: z.array(z.string().trim().min(1)).min(1).max(8),
});

export type SummaryGenerationInput = {
  sourceCommitSha: string;
  title: string;
  entryType: string;
  publishedAt: Date;
  sourceText: string;
  manualSummary?: string;
  sourceUrl: string;
  citation: string;
};

export type GeneratedSummary = z.infer<typeof generatedSummarySchema>;

export type AiSummaryStatus = "generated" | "manual-fallback" | "rejected";

export type SummaryGenerationResult = GeneratedSummary & {
  status: AiSummaryStatus;
  model: string;
  promptVersion: string;
  generatedAt: Date;
  citationIssues: CitationLintIssue[];
  error: string | null;
};

export type SummaryProvider = {
  model: string;
  generate(input: {
    title: string;
    entryType: string;
    publishedAt: Date;
    sourceText: string;
    sourceUrl: string;
    citation: string;
  }): Promise<unknown>;
};

export class AiSummaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSummaryError";
  }
}

function firstSentence(sourceText: string): string {
  const normalized = sourceText.replace(/\s+/g, " ").trim();
  const sentence = normalized.match(/^.{1,240}?(?:[.!?](?:\s|$)|$)/)?.[0];
  return (sentence ?? normalized.slice(0, 240)).trim();
}

export function createManualFallback(
  input: SummaryGenerationInput,
  error: string | null = null,
): SummaryGenerationResult {
  const summary =
    input.manualSummary?.trim() ||
    firstSentence(input.sourceText) ||
    `The ${input.entryType} entry records ${input.title}.`;
  const citationCheck = lintCitation({
    citation: input.citation,
    sourceUrl: input.sourceUrl,
    sourceReferences: [input.sourceUrl],
    requireSourceReference: true,
  });

  return {
    status: "manual-fallback",
    summary,
    keyIssue: `This public-record entry concerns ${input.title}.`,
    outcome:
      "Manual summary retained; verify the original source before relying on it.",
    sourceReferences: [input.sourceUrl],
    model: "manual-fallback",
    promptVersion: MANUAL_FALLBACK_PROMPT_VERSION,
    generatedAt: new Date(),
    citationIssues: citationCheck.issues,
    error,
  };
}

function parseJsonContent(content: string): unknown {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    throw new AiSummaryError("The AI provider returned invalid JSON.");
  }
}

function extractProviderPayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    return parseJsonContent(payload);
  }

  if (typeof payload !== "object" || payload === null) {
    throw new AiSummaryError("The AI provider returned an invalid payload.");
  }

  if ("summary" in payload) {
    return payload;
  }

  if (!("choices" in payload) || !Array.isArray(payload.choices)) {
    throw new AiSummaryError(
      "The AI provider response had no structured choice.",
    );
  }

  const firstChoice: unknown = payload.choices[0];
  if (typeof firstChoice !== "object" || firstChoice === null) {
    throw new AiSummaryError("The AI provider returned an empty choice.");
  }

  if (!("message" in firstChoice)) {
    throw new AiSummaryError("The AI provider choice had no message.");
  }

  const message: unknown = firstChoice.message;
  if (
    typeof message !== "object" ||
    message === null ||
    !("content" in message)
  ) {
    throw new AiSummaryError("The AI provider message had no content.");
  }

  const content: unknown = message.content;
  if (typeof content !== "string") {
    throw new AiSummaryError("The AI provider message content was not text.");
  }

  return parseJsonContent(content);
}

function createConfiguredProvider(): SummaryProvider | null {
  if (process.env.AI_SUMMARY_ENABLED !== "true") {
    return null;
  }

  const endpoint = process.env.AI_SUMMARY_API_URL?.trim();
  const apiKey = process.env.AI_SUMMARY_API_KEY?.trim();
  if (!endpoint || !apiKey) {
    return null;
  }

  const model = process.env.AI_SUMMARY_MODEL?.trim() || "configured-model";
  return {
    model,
    async generate(input) {
      const timeoutMs = Number(process.env.AI_SUMMARY_TIMEOUT_MS ?? "8000");
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000,
      );

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You summarize public legal records for education. Do not give legal advice or conclusions. Return JSON with summary, keyIssue, outcome, and sourceReferences. sourceReferences must contain only the exact supplied HTTPS source URL.",
              },
              {
                role: "user",
                content: JSON.stringify({
                  title: input.title,
                  entryType: input.entryType,
                  publishedAt: input.publishedAt.toISOString(),
                  sourceText: input.sourceText.slice(0, 12000),
                  sourceUrl: input.sourceUrl,
                  citation: input.citation,
                }),
              },
            ],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new AiSummaryError(
            `The AI provider returned HTTP ${response.status}.`,
          );
        }

        return (await response.json()) as unknown;
      } catch (error) {
        if (error instanceof AiSummaryError) {
          throw error;
        }
        throw new AiSummaryError(
          error instanceof Error
            ? `The AI provider was unavailable: ${error.message}`
            : "The AI provider was unavailable.",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export async function generateSummary(
  input: SummaryGenerationInput,
  provider?: SummaryProvider | null,
): Promise<SummaryGenerationResult> {
  const selectedProvider =
    provider === undefined ? createConfiguredProvider() : provider;

  if (selectedProvider === null) {
    return createManualFallback(
      input,
      "AI provider is not configured; the supplied manual summary was retained.",
    );
  }

  try {
    const parsed = generatedSummarySchema.parse(
      extractProviderPayload(await selectedProvider.generate(input)),
    );
    const citationCheck = lintCitation({
      citation: input.citation,
      sourceUrl: input.sourceUrl,
      text: `${parsed.summary} ${parsed.keyIssue} ${parsed.outcome}`,
      sourceReferences: parsed.sourceReferences,
      requireSourceReference: true,
    });

    if (!citationCheck.valid) {
      const fallback = createManualFallback(
        input,
        `AI output rejected by citation checks: ${formatCitationLintIssues(
          citationCheck.issues,
        )}`,
      );
      return {
        ...fallback,
        status: "rejected",
        citationIssues: citationCheck.issues,
      };
    }

    return {
      ...parsed,
      status: "generated",
      model: selectedProvider.model,
      promptVersion: AI_SUMMARY_PROMPT_VERSION,
      generatedAt: new Date(),
      citationIssues: [],
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "AI output did not match the required structured summary format."
        : error instanceof Error
          ? error.message
          : "The AI provider failed.";
    return createManualFallback(input, message);
  }
}
