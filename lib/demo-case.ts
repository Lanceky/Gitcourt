import demoCaseFixture from "@/data/demo-case.json";
import { createCommitHash } from "@/lib/domain/commit-hash";
import {
  publicCaseFixtureSchema,
  type PublicCaseFixture,
  type PublicDocketEntry,
} from "@/lib/import/public-case-schema";

export type DemoCase = PublicCaseFixture;
export type DemoDocketEntry = PublicDocketEntry & {
  sha: string;
  parentSha: string | null;
};

export const demoCase = publicCaseFixtureSchema.parse(demoCaseFixture);

export function getDemoDocketEntries(): DemoDocketEntry[] {
  let parentSha: string | null = null;

  return demoCase.entries.map((entry) => {
    const sha = createCommitHash({
      parentSha,
      authorName: entry.author,
      entryType: entry.type,
      title: entry.title,
      content: entry.sourceText,
      sourceReference: entry.sourceUrl,
    });
    const importedEntry = { ...entry, sha, parentSha };

    parentSha = sha;
    return importedEntry;
  });
}
