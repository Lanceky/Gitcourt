import { PrismaClient } from "@prisma/client";

import { createCommitHash } from "../lib/domain/commit-hash";
import { demoCase } from "../lib/demo-case";

const database = new PrismaClient();

async function main() {
  const seedUser = await database.user.upsert({
    where: { email: "seed@gitcourt.local" },
    update: { displayName: "Git Court Seed", role: "admin" },
    create: {
      email: "seed@gitcourt.local",
      displayName: "Git Court Seed",
      role: "admin",
    },
  });

  const repository = await database.caseRepository.upsert({
    where: { slug: "rivera-v-state-demo" },
    update: {
      title: demoCase.title,
      court: demoCase.court,
      docketNumber: demoCase.docketNumber,
      jurisdiction: "demo",
      status: "public",
      isPublic: true,
      isCanonicalSource: true,
    },
    create: {
      slug: "rivera-v-state-demo",
      title: demoCase.title,
      court: demoCase.court,
      docketNumber: demoCase.docketNumber,
      jurisdiction: "demo",
      status: "public",
      isPublic: true,
      isCanonicalSource: true,
    },
  });

  let parentSha: string | null = null;
  let headCommitId: string | null = null;

  for (const entry of demoCase.entries) {
    const sha = createCommitHash({
      parentSha,
      authorName: entry.author,
      entryType: entry.type,
      title: entry.title,
      content: entry.summary,
      sourceReference: null,
    });

    const commit = await database.docketCommit.upsert({
      where: {
        repositoryId_sha: {
          repositoryId: repository.id,
          sha,
        },
      },
      update: {
        parentSha,
        authorName: entry.author,
        entryType: entry.type,
        title: entry.title,
        content: entry.summary,
        createdAt: new Date(entry.date),
      },
      create: {
        repositoryId: repository.id,
        sha,
        parentSha,
        authorId: seedUser.id,
        authorName: entry.author,
        entryType: entry.type,
        title: entry.title,
        content: entry.summary,
        createdAt: new Date(entry.date),
      },
    });

    parentSha = sha;
    headCommitId = commit.id;
  }

  await database.branch.upsert({
    where: {
      repositoryId_name: {
        repositoryId: repository.id,
        name: "main",
      },
    },
    update: {
      ownerId: seedUser.id,
      headCommitId,
      isProtected: true,
    },
    create: {
      repositoryId: repository.id,
      name: "main",
      ownerId: seedUser.id,
      headCommitId,
      isProtected: true,
    },
  });

  console.log(`Database seeded: ${repository.slug}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await database.$disconnect();
  });
