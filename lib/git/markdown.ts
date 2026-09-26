import { assertRepositoryFilePath, slugifyDocumentPart } from "@/lib/git/paths";

export type CommitDocumentMetadata = {
  entryType: string;
  title: string;
  publishedAt: string;
  author: string;
  sourceUrl: string;
  citation: string;
  attribution: string;
  summary?: string;
};

function frontMatterValue(value: string): string {
  return JSON.stringify(value);
}

export function renderCommitDocument(
  metadata: CommitDocumentMetadata,
  content: string,
): string {
  const frontMatter = [
    "---",
    `entryType: ${frontMatterValue(metadata.entryType)}`,
    `title: ${frontMatterValue(metadata.title)}`,
    `publishedAt: ${frontMatterValue(metadata.publishedAt)}`,
    `author: ${frontMatterValue(metadata.author)}`,
    `sourceUrl: ${frontMatterValue(metadata.sourceUrl)}`,
    `citation: ${frontMatterValue(metadata.citation)}`,
    `attribution: ${frontMatterValue(metadata.attribution)}`,
    ...(metadata.summary === undefined
      ? []
      : [`summary: ${frontMatterValue(metadata.summary)}`]),
    "---",
    "",
  ].join("\n");

  return `${frontMatter}${content.trim()}\n`;
}

export function docketDocumentPath(title: string, identity: string): string {
  return assertRepositoryFilePath(
    `docket/${slugifyDocumentPart(title)}-${identity.slice(0, 12)}.md`,
  );
}

export function argumentDocumentPath(title: string): string {
  return assertRepositoryFilePath(`arguments/${slugifyDocumentPart(title)}.md`);
}

export function parseCommitDocument(document: string): {
  metadata: Record<string, string>;
  content: string;
} {
  const match = document.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match === null) {
    return { metadata: {}, content: document };
  }

  const metadata: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) {
      continue;
    }

    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    try {
      metadata[key] = JSON.parse(value) as string;
    } catch {
      metadata[key] = value;
    }
  }

  return { metadata, content: match[2] };
}
