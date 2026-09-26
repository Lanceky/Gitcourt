import assert from "node:assert/strict";
import test from "node:test";

import { lintCitation } from "@/lib/ai/citation-lint";
import {
  generateSummary,
  type SummaryGenerationInput,
  type SummaryProvider,
} from "@/lib/ai/summary-service";

const sourceUrl = "https://www.supremecourt.gov/docket/16-402";

const input: SummaryGenerationInput = {
  sourceCommitSha: "a".repeat(40),
  title: "Judgment issued",
  entryType: "opinion",
  publishedAt: new Date("2018-06-22T00:00:00.000Z"),
  sourceText:
    "The Court held that Carpenter v. United States, No. 16-402, required a warrant for the historical records at issue.",
  manualSummary: "The Court issued its judgment.",
  sourceUrl,
  citation: "Carpenter v. United States, No. 16-402",
};

test("citation lint accepts sourced HTTPS case citations", () => {
  const result = lintCitation({
    citation: input.citation,
    sourceUrl,
    sourceReferences: [sourceUrl],
    text: `See ${sourceUrl} for Carpenter v. United States.`,
    requireSourceReference: true,
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("citation lint flags malformed links, missing citations, and unsupported references", () => {
  const result = lintCitation({
    citation: "Public record",
    sourceUrl: "https://approved.test/source",
    sourceReferences: ["https://unapproved.test/source", "not-a-url"],
    text: "Read http://unapproved.test/source.",
    requireSourceReference: true,
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      "MISSING_CASE_CITATION",
      "MALFORMED_SOURCE_REFERENCE",
      "UNSUPPORTED_SOURCE_REFERENCE",
    ]),
  );
  assert.equal(
    lintCitation({
      citation: input.citation,
      sourceUrl: "http://not-https.test/source",
      sourceReferences: [],
    }).issues[0]?.code,
    "MALFORMED_SOURCE_URL",
  );
});

test("summary generation persists structured provider output metadata", async () => {
  const provider: SummaryProvider = {
    model: "test-model",
    async generate() {
      return {
        summary: "The Court resolved the warrant question.",
        keyIssue: "Whether historical location data required a warrant.",
        outcome: "The judgment required a warrant for the records at issue.",
        sourceReferences: [sourceUrl],
      };
    },
  };

  const result = await generateSummary(input, provider);

  assert.equal(result.status, "generated");
  assert.equal(result.model, "test-model");
  assert.equal(result.promptVersion, "lexhack-summary-v1");
  assert.equal(result.sourceReferences[0], sourceUrl);
  assert.deepEqual(result.citationIssues, []);
  assert.equal(result.error, null);
});

test("malformed provider output falls back to the supplied manual summary", async () => {
  const provider: SummaryProvider = {
    model: "broken-model",
    async generate() {
      return { choices: [{ message: { content: "not JSON" } }] };
    },
  };

  const result = await generateSummary(input, provider);

  assert.equal(result.status, "manual-fallback");
  assert.equal(result.summary, input.manualSummary);
  assert.match(result.error ?? "", /invalid JSON/i);
  assert.equal(result.sourceReferences[0], sourceUrl);
});

test("unsupported provider citations are rejected without replacing source text", async () => {
  const provider: SummaryProvider = {
    model: "unsafe-model",
    async generate() {
      return {
        summary: "A generated explanation.",
        keyIssue: "A generated issue.",
        outcome: "A generated outcome.",
        sourceReferences: ["https://unapproved.test/source"],
      };
    },
  };

  const result = await generateSummary(input, provider);

  assert.equal(result.status, "rejected");
  assert.equal(result.summary, input.manualSummary);
  assert.ok(
    result.citationIssues.some(
      (issue) => issue.code === "UNSUPPORTED_SOURCE_REFERENCE",
    ),
  );
  assert.match(result.error ?? "", /citation checks/i);
});

test("an unavailable provider uses a visible manual fallback", async () => {
  const provider: SummaryProvider = {
    model: "offline-model",
    async generate() {
      throw new Error("connection refused");
    },
  };

  const result = await generateSummary(input, provider);

  assert.equal(result.status, "manual-fallback");
  assert.equal(result.summary, input.manualSummary);
  assert.match(result.error ?? "", /connection refused/i);
});
