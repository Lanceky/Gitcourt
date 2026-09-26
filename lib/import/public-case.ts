import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import {
  publicCaseFixtureSchema,
  type PublicCaseFixture,
} from "@/lib/import/public-case-schema";

export type PublicCaseImportResult = {
  repositoryId: string;
  slug: string;
  entriesImported: number;
  headSha: string | null;
};

export function normalizeDocketText(sourceText: string): string {
  return sourceText.replace(/\s+/g, " ").trim();
}

export function createDocumentHash(sourceText: string): string {
  return `sha256:${createHash("sha256")
    .update(normalizeDocketText(sourceText), "utf8")
    .digest("hex")}`;
}

export async function importPublicCase(
  database: PrismaClient,
  input: unknown,
): Promise<PublicCaseImportResult> {
  const fixture: PublicCaseFixture = publicCaseFixtureSchema.parse(input);
  const service = new CaseRepositoryService(database);

  return service.importPublicCase(fixture);
}
