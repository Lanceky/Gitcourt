import { createHash } from "node:crypto";

import type { CommitHashInput } from "@/lib/domain/types";

export function createCommitHash(input: CommitHashInput): string {
  const immutablePayload = [
    input.parentSha ?? "",
    input.authorName.trim(),
    input.entryType.trim(),
    input.title.trim(),
    input.content,
    input.sourceReference ?? "",
  ].join("\u0000");

  return createHash("sha256").update(immutablePayload, "utf8").digest("hex");
}
