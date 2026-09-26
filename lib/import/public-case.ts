import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { createCommitHash } from "@/lib/domain/commit-hash";
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

function parsePublishedAt(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export async function importPublicCase(
  database: PrismaClient,
  input: unknown,
): Promise<PublicCaseImportResult> {
  const fixture: PublicCaseFixture = publicCaseFixtureSchema.parse(input);

  return database.$transaction(async (transaction) => {
    const importer = await transaction.user.upsert({
      where: { email: "public-records@gitcourt.local" },
      update: {
        displayName: "Public records importer",
        role: "admin",
      },
      create: {
        email: "public-records@gitcourt.local",
        displayName: "Public records importer",
        role: "admin",
      },
    });

    const repository = await transaction.caseRepository.upsert({
      where: { slug: fixture.slug },
      update: {
        title: fixture.title,
        court: fixture.court,
        docketNumber: fixture.docketNumber,
        jurisdiction: fixture.jurisdiction,
        status: fixture.status,
        isPublic: true,
        isCanonicalSource: true,
        sourceUrl: fixture.sourceUrl,
        sourceAttribution: fixture.sourceAttribution,
      },
      create: {
        slug: fixture.slug,
        title: fixture.title,
        court: fixture.court,
        docketNumber: fixture.docketNumber,
        jurisdiction: fixture.jurisdiction,
        status: fixture.status,
        isPublic: true,
        isCanonicalSource: true,
        sourceUrl: fixture.sourceUrl,
        sourceAttribution: fixture.sourceAttribution,
      },
    });

    let parentSha: string | null = null;
    let headCommitId: string | null = null;

    for (const entry of fixture.entries) {
      const content = normalizeDocketText(entry.sourceText);
      const sourceReference = entry.sourceUrl;
      const sha = createCommitHash({
        parentSha,
        authorName: entry.author,
        entryType: entry.type,
        title: entry.title,
        content,
        sourceReference,
      });
      const publishedAt = parsePublishedAt(entry.date);

      const commit = await transaction.docketCommit.upsert({
        where: {
          repositoryId_sha: {
            repositoryId: repository.id,
            sha,
          },
        },
        update: {
          parentSha,
          authorId: importer.id,
          authorName: entry.author,
          entryType: entry.type,
          title: entry.title,
          content,
          sourceReference,
          sourceUrl: entry.sourceUrl,
          attribution: entry.attribution,
          publishedAt,
        },
        create: {
          repositoryId: repository.id,
          sha,
          parentSha,
          authorId: importer.id,
          authorName: entry.author,
          entryType: entry.type,
          title: entry.title,
          content,
          sourceReference,
          sourceUrl: entry.sourceUrl,
          attribution: entry.attribution,
          publishedAt,
        },
      });

      await transaction.sourceRecord.upsert({
        where: {
          commitId_url: {
            commitId: commit.id,
            url: entry.sourceUrl,
          },
        },
        update: {
          repositoryId: repository.id,
          kind: entry.type,
          citation: entry.citation,
          documentHash: createDocumentHash(content),
          attribution: entry.attribution,
        },
        create: {
          repositoryId: repository.id,
          commitId: commit.id,
          kind: entry.type,
          url: entry.sourceUrl,
          citation: entry.citation,
          documentHash: createDocumentHash(content),
          attribution: entry.attribution,
        },
      });

      parentSha = sha;
      headCommitId = commit.id;
    }

    await transaction.branch.upsert({
      where: {
        repositoryId_name: {
          repositoryId: repository.id,
          name: "main",
        },
      },
      update: {
        ownerId: importer.id,
        headCommitId,
        isProtected: true,
      },
      create: {
        repositoryId: repository.id,
        name: "main",
        ownerId: importer.id,
        headCommitId,
        isProtected: true,
      },
    });

    return {
      repositoryId: repository.id,
      slug: repository.slug,
      entriesImported: fixture.entries.length,
      headSha: parentSha,
    };
  });
}
