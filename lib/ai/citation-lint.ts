export type CitationLintIssueCode =
  | "MALFORMED_SOURCE_URL"
  | "MISSING_CASE_CITATION"
  | "MALFORMED_SOURCE_REFERENCE"
  | "UNSUPPORTED_SOURCE_REFERENCE";

export type CitationLintIssue = {
  code: CitationLintIssueCode;
  message: string;
};

export type CitationLintResult = {
  valid: boolean;
  issues: CitationLintIssue[];
};

export type CitationLintInput = {
  citation: string;
  sourceUrl: string;
  text?: string;
  sourceReferences?: string[];
  requireSourceReference?: boolean;
};

const urlPattern = /https?:\/\/[^\s)]+/gi;
const caseCitationPattern =
  /\b(?:v\.\s*[A-Za-z][\w.-]*|No\.\s*[A-Za-z0-9][\w-]*)/i;

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function addIssue(
  issues: CitationLintIssue[],
  code: CitationLintIssueCode,
  message: string,
): void {
  if (
    !issues.some((issue) => issue.code === code && issue.message === message)
  ) {
    issues.push({ code, message });
  }
}

export function lintCitation(input: CitationLintInput): CitationLintResult {
  const issues: CitationLintIssue[] = [];
  const normalizedSourceUrl = normalizeUrl(input.sourceUrl);

  if (normalizedSourceUrl === null) {
    addIssue(
      issues,
      "MALFORMED_SOURCE_URL",
      "The source link must be a valid HTTPS URL.",
    );
  }

  if (!caseCitationPattern.test(input.citation.trim())) {
    addIssue(
      issues,
      "MISSING_CASE_CITATION",
      "Add a recognizable case citation, such as “Example v. Example” or a docket number.",
    );
  }

  const sourceReferences = input.sourceReferences ?? [];
  if (input.requireSourceReference && sourceReferences.length === 0) {
    addIssue(
      issues,
      "UNSUPPORTED_SOURCE_REFERENCE",
      "The summary must cite the public source URL.",
    );
  }

  for (const reference of sourceReferences) {
    const normalizedReference = normalizeUrl(reference);
    if (normalizedReference === null) {
      addIssue(
        issues,
        "MALFORMED_SOURCE_REFERENCE",
        `The source reference is not a valid HTTPS URL: ${reference}`,
      );
      continue;
    }

    if (
      normalizedSourceUrl !== null &&
      normalizedReference !== normalizedSourceUrl
    ) {
      addIssue(
        issues,
        "UNSUPPORTED_SOURCE_REFERENCE",
        `The summary cites a URL that was not supplied as public provenance: ${reference}`,
      );
    }
  }

  for (const link of input.text?.match(urlPattern) ?? []) {
    const normalizedLink = normalizeUrl(link);
    if (normalizedLink === null) {
      addIssue(
        issues,
        "MALFORMED_SOURCE_REFERENCE",
        `The text contains a non-HTTPS or malformed link: ${link}`,
      );
      continue;
    }

    if (
      normalizedSourceUrl !== null &&
      normalizedLink !== normalizedSourceUrl
    ) {
      addIssue(
        issues,
        "UNSUPPORTED_SOURCE_REFERENCE",
        `The text cites a URL that was not supplied as public provenance: ${link}`,
      );
    }
  }

  return { valid: issues.length === 0, issues };
}

export function formatCitationLintIssues(issues: CitationLintIssue[]): string {
  return issues.map((issue) => issue.message).join(" ");
}
