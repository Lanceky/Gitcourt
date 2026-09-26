import assert from "node:assert/strict";
import test from "node:test";

import {
  branchNameSchema,
  internalIdSchema,
  publicHttpsUrlSchema,
  repositoryFilePathSchema,
  repositoryRefSchema,
} from "@/lib/api-validation";
import {
  rateLimitResponse,
  resetRateLimitsForTests,
} from "@/lib/api-rate-limit";

test("API validation rejects unsafe identifiers, refs, paths, and URLs", () => {
  assert.equal(internalIdSchema.parse("repo_123-abc"), "repo_123-abc");
  assert.throws(() => internalIdSchema.parse("../repositories"));
  assert.throws(() => branchNameSchema.parse("feature/../main"));
  assert.equal(
    repositoryRefSchema.parse("alternate-standing"),
    "alternate-standing",
  );
  assert.throws(() =>
    repositoryFilePathSchema.parse("arguments/../../private.md"),
  );
  assert.throws(() => publicHttpsUrlSchema.parse("javascript:alert(1)"));
  assert.equal(
    publicHttpsUrlSchema.parse("https://example.test/source"),
    "https://example.test/source",
  );
});

test("write and AI rate limits return retry metadata", () => {
  resetRateLimitsForTests();
  const request = new Request("https://example.test/api/write", {
    headers: { "x-forwarded-for": "198.51.100.20" },
  });

  assert.equal(
    rateLimitResponse(request, "write", { limit: 2, windowMs: 60_000 }),
    null,
  );
  assert.equal(
    rateLimitResponse(request, "write", { limit: 2, windowMs: 60_000 }),
    null,
  );
  const limited = rateLimitResponse(request, "write", {
    limit: 2,
    windowMs: 60_000,
  });

  assert.ok(limited);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  resetRateLimitsForTests();
});
