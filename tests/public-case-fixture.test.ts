import assert from "node:assert/strict";
import test from "node:test";

import { demoCase, getDemoDocketEntries } from "@/lib/demo-case";
import {
  createDocumentHash,
  normalizeDocketText,
} from "@/lib/import/public-case";
import { publicCaseFixtureSchema } from "@/lib/import/public-case-schema";

test("the committed fixture is public, ordered, sourced, and bounded", () => {
  const parsedCase = publicCaseFixtureSchema.parse(demoCase);
  const entries = getDemoDocketEntries();

  assert.equal(parsedCase.entries.length, 11);
  assert.equal(entries.length, parsedCase.entries.length);
  assert.ok(
    entries.every(
      (entry) =>
        entry.isPublicRecord &&
        entry.sourceUrl.startsWith("https://") &&
        entry.sourceText.length > 0 &&
        entry.attribution.length > 0,
    ),
  );
  assert.deepEqual(
    entries.map((entry) => entry.date),
    [...entries].map((entry) => entry.date).sort(),
  );
  assert.equal(new Set(entries.map((entry) => entry.sha)).size, entries.length);
});

test("normalization preserves source wording while removing layout whitespace", () => {
  const sourceText = "Judgment  REVERSED\nand case   REMANDED.";

  assert.equal(
    normalizeDocketText(sourceText),
    "Judgment REVERSED and case REMANDED.",
  );
  assert.equal(
    createDocumentHash(sourceText),
    createDocumentHash("Judgment REVERSED and case REMANDED."),
  );
});

test("fixture validation rejects duplicate or out-of-order entries", () => {
  assert.throws(() =>
    publicCaseFixtureSchema.parse({
      ...demoCase,
      entries: [...demoCase.entries, demoCase.entries[0]],
    }),
  );

  const outOfOrderEntries = [...demoCase.entries];
  [outOfOrderEntries[0], outOfOrderEntries[1]] = [
    outOfOrderEntries[1],
    outOfOrderEntries[0],
  ];

  assert.throws(() =>
    publicCaseFixtureSchema.parse({
      ...demoCase,
      entries: outOfOrderEntries,
    }),
  );
});

test("fixture validation rejects direct contact details", () => {
  assert.throws(() =>
    publicCaseFixtureSchema.parse({
      ...demoCase,
      entries: [
        {
          ...demoCase.entries[0],
          sourceText: "Contact clerk@example.com for the filing.",
        },
        ...demoCase.entries.slice(1),
      ],
    }),
  );
});
