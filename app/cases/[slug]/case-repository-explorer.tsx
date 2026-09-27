"use client";

import { useEffect, useMemo, useState } from "react";

import type { DemoDocketEntry } from "@/lib/demo-case";

type Branch = {
  name: string;
  label: string;
  isReadOnly: boolean;
};

type ExplorerEntry = DemoDocketEntry & {
  persistedSha: string | null;
  aiSummary: string | null;
  aiKeyIssue: string | null;
  aiOutcome: string | null;
  aiSourceReferences: string[];
  aiSourceCommitSha: string | null;
  aiModel: string | null;
  aiPromptVersion: string | null;
  aiStatus: string | null;
  aiCitationWarnings: Array<{
    code: string;
    message: string;
  }>;
  aiError: string | null;
  aiGeneratedAt: string | null;
};

type CaseRepositoryExplorerProps = {
  branches: Branch[];
  entries: ExplorerEntry[];
};

function formatEntryType(entryType: string): string {
  return entryType
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatRelativeDate(date: string): string {
  const differenceInDays = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(`${date}T00:00:00.000Z`).getTime()) /
        (24 * 60 * 60 * 1000),
    ),
  );

  if (differenceInDays < 1) {
    return "today";
  }
  if (differenceInDays < 30) {
    return `${differenceInDays}d ago`;
  }
  if (differenceInDays < 365) {
    return `${Math.floor(differenceInDays / 30)}mo ago`;
  }

  return `${Math.floor(differenceInDays / 365)}y ago`;
}

function formatCommitDate(date: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function summaryStatusLabel(status: string | null): string {
  switch (status) {
    case "generated":
      return "AI-generated — verify against source";
    case "rejected":
      return "Manual fallback — AI output rejected";
    case "manual-fallback":
      return "Manual fallback — AI optional";
    default:
      return "Manual summary";
  }
}

export default function CaseRepositoryExplorer({
  branches,
  entries,
}: CaseRepositoryExplorerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [entryType, setEntryType] = useState("all");
  const [branchName, setBranchName] = useState("all");
  const [copiedSha, setCopiedSha] = useState<string | null>(null);
  const [selectedSha, setSelectedSha] = useState(
    entries[entries.length - 1]?.sha ?? null,
  );

  useEffect(() => {
    const hash = window.location.hash.match(/^#commit-([0-9a-f]+)$/i);
    if (hash === null) {
      return;
    }

    const hashedEntry = entries.find((entry) => entry.sha.startsWith(hash[1]));
    if (hashedEntry === undefined) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setSelectedSha(hashedEntry.sha);
      document.getElementById(`commit-${hashedEntry.sha.slice(0, 7)}`)?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [entries]);

  const entryTypes = useMemo(
    () =>
      [...new Set(entries.map((entry) => entry.type))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [entries],
  );

  const visibleEntries = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return entries.filter((entry) => {
      const matchesType = entryType === "all" || entry.type === entryType;
      const matchesBranch = branchName === "all" || branchName === "main";
      const searchableText = [
        entry.title,
        entry.summary,
        entry.sourceText,
        entry.author,
        entry.citation,
      ]
        .join(" ")
        .toLowerCase();
      const matchesSearch =
        normalizedSearch.length === 0 ||
        searchableText.includes(normalizedSearch);

      return matchesType && matchesBranch && matchesSearch;
    });
  }, [branchName, entries, entryType, searchTerm]);

  const selectedEntry =
    entries.find((entry) => entry.sha === selectedSha) ??
    visibleEntries[visibleEntries.length - 1] ??
    entries[entries.length - 1];

  function selectEntry(sha: string): void {
    setSelectedSha(sha);
    window.history.replaceState(null, "", `#commit-${sha.slice(0, 7)}`);
  }

  function copySha(sha: string): void {
    if (!navigator.clipboard) {
      return;
    }

    void navigator.clipboard.writeText(sha).then(
      () => setCopiedSha(sha),
      () => setCopiedSha(null),
    );
  }

  const groupedEntries = visibleEntries.reduce<
    Array<{ date: string; entries: ExplorerEntry[] }>
  >((groups, entry) => {
    const group = groups.find((candidate) => candidate.date === entry.date);
    if (group === undefined) {
      groups.push({ date: entry.date, entries: [entry] });
    } else {
      group.entries.push(entry);
    }
    return groups;
  }, []);

  return (
    <section className="card explorer" aria-labelledby="history-title">
      <div className="explorer-heading">
        <div>
          <p className="eyebrow">Versioned public record</p>
          <h2 id="history-title">Docket history</h2>
          <p>
            Select a milestone to inspect its source text, metadata, and
            plain-language summary.
          </p>
        </div>
        <span className="history-count" aria-live="polite">
          {visibleEntries.length} of {entries.length} entries
        </span>
      </div>

      <form
        className="history-filters"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="filter-field filter-search">
          <label htmlFor="history-search">Search history</label>
          <input
            id="history-search"
            name="history-search"
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search title, author, or source text"
            type="search"
            value={searchTerm}
          />
        </div>
        <div className="filter-field">
          <label htmlFor="history-type">Entry type</label>
          <select
            id="history-type"
            name="history-type"
            onChange={(event) => setEntryType(event.target.value)}
            value={entryType}
          >
            <option value="all">All types</option>
            {entryTypes.map((type) => (
              <option key={type} value={type}>
                {formatEntryType(type)}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="history-branch">Branch</label>
          <select
            id="history-branch"
            name="history-branch"
            onChange={(event) => setBranchName(event.target.value)}
            value={branchName}
          >
            <option value="all">All branches</option>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name} · {branch.label}
                {branch.isReadOnly ? " · read-only" : ""}
              </option>
            ))}
          </select>
        </div>
      </form>

      <div className="history-layout">
        <div className="timeline-panel">
          <div className="timeline-panel-heading">
            <h3>Commits</h3>
            <span>Oldest first</span>
          </div>
          {visibleEntries.length === 0 ? (
            <p className="empty-state">
              No milestones match those filters. Try a broader search.
            </p>
          ) : (
            <div className="timeline-list" role="list">
              {groupedEntries.map((group) => (
                <section className="commit-group" key={group.date}>
                  <h4>Commits on {formatCommitDate(group.date)}</h4>
                  {group.entries.map((entry) => {
                    const isSelected = entry.sha === selectedEntry?.sha;
                    const initials = entry.author
                      .split(/\s+/)
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase();

                    return (
                      <div
                        className={`timeline-entry${isSelected ? " is-selected" : ""}`}
                        key={entry.sha}
                        role="listitem"
                      >
                        <span
                          className="avatar commit-avatar"
                          aria-hidden="true"
                        >
                          {initials}
                        </span>
                        <button
                          aria-pressed={isSelected}
                          className="commit-select"
                          onClick={() => selectEntry(entry.sha)}
                          type="button"
                        >
                          <span className="timeline-entry-content">
                            <span className="timeline-entry-title">
                              {entry.title}
                            </span>
                            <span className="timeline-entry-meta">
                              {entry.author} · {formatRelativeDate(entry.date)}
                            </span>
                            <span className="timeline-entry-summary">
                              {entry.summary}
                            </span>
                          </span>
                        </button>
                        <span className="commit-row-actions">
                          <code
                            className="commit-hash"
                            title={`Full commit SHA ${entry.sha}`}
                          >
                            {entry.sha.slice(0, 7)}
                          </code>
                          <button
                            aria-label={`Copy ${entry.sha} commit hash`}
                            className="copy-hash"
                            onClick={() => copySha(entry.sha)}
                            title="Copy commit hash"
                            type="button"
                          >
                            {copiedSha === entry.sha ? "✓" : "⧉"}
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </div>

        {selectedEntry === undefined ? (
          <div className="commit-detail empty-detail">
            <h3>Select a commit</h3>
            <p>Choose a milestone to inspect its public source.</p>
          </div>
        ) : (
          <article
            className="commit-detail"
            id={`commit-${selectedEntry.sha.slice(0, 7)}`}
            tabIndex={-1}
          >
            <div className="detail-heading">
              <div>
                <p className="eyebrow">Commit detail</p>
                <h3>{selectedEntry.title}</h3>
                <p>{selectedEntry.summary}</p>
              </div>
              <code
                className="detail-sha"
                title={`Full commit SHA ${selectedEntry.sha}`}
              >
                {selectedEntry.sha.slice(0, 7)}
              </code>
            </div>

            <dl className="detail-metadata">
              <div>
                <dt>Type</dt>
                <dd>{formatEntryType(selectedEntry.type)}</dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>{formatDate(selectedEntry.date)}</dd>
              </div>
              <div>
                <dt>Author</dt>
                <dd>{selectedEntry.author}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>
                  <code>main</code>
                </dd>
              </div>
              <div>
                <dt>Parent commit</dt>
                <dd>
                  {selectedEntry.parentSha === null ? (
                    "Initial entry"
                  ) : (
                    <code>{selectedEntry.parentSha.slice(0, 7)}</code>
                  )}
                </dd>
              </div>
            </dl>

            <section className="document-section">
              <div className="section-heading">
                <div>
                  <h4>Original public-record document</h4>
                  <p>Preserved text from the cited source.</p>
                </div>
                <span className="document-badge">Public record</span>
              </div>
              <blockquote>{selectedEntry.sourceText}</blockquote>
            </section>

            <section className="document-section summary-section">
              <div className="section-heading">
                <div>
                  <h4>
                    {selectedEntry.aiStatus === "generated"
                      ? "Generated summary"
                      : "Curated manual summary"}
                  </h4>
                  <p>
                    {selectedEntry.aiStatus === "generated"
                      ? "AI-generated — verify against the original source; not legal advice."
                      : "Plain-language orientation, not legal advice."}
                  </p>
                </div>
                <span className="document-badge">
                  {summaryStatusLabel(selectedEntry.aiStatus)}
                </span>
              </div>
              <p>{selectedEntry.aiSummary ?? selectedEntry.summary}</p>
              {selectedEntry.aiKeyIssue !== null ||
              selectedEntry.aiOutcome !== null ? (
                <dl className="ai-summary-facts">
                  <div>
                    <dt>Key issue</dt>
                    <dd>{selectedEntry.aiKeyIssue ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Outcome</dt>
                    <dd>{selectedEntry.aiOutcome ?? "Not recorded"}</dd>
                  </div>
                </dl>
              ) : null}
              {selectedEntry.aiSourceReferences.length > 0 ? (
                <div className="ai-source-references">
                  <span className="metadata-label">Source references</span>
                  {selectedEntry.aiSourceReferences.map((reference) => (
                    <a
                      href={reference}
                      key={reference}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {reference}
                    </a>
                  ))}
                </div>
              ) : null}
              {selectedEntry.aiCitationWarnings.length > 0 ? (
                <div className="citation-callout" role="alert">
                  <strong>Citation formatting warnings</strong>
                  <ul>
                    {selectedEntry.aiCitationWarnings.map((issue) => (
                      <li key={`${issue.code}-${issue.message}`}>
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {selectedEntry.aiModel !== null ||
              selectedEntry.aiPromptVersion !== null ||
              selectedEntry.aiGeneratedAt !== null ? (
                <dl className="ai-summary-facts">
                  <div>
                    <dt>Model</dt>
                    <dd>{selectedEntry.aiModel ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Prompt version</dt>
                    <dd>{selectedEntry.aiPromptVersion ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Source commit</dt>
                    <dd>
                      <code>
                        {(
                          selectedEntry.aiSourceCommitSha ??
                          selectedEntry.persistedSha ??
                          selectedEntry.sha
                        ).slice(0, 7)}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt>Generated</dt>
                    <dd>
                      {selectedEntry.aiGeneratedAt === null
                        ? "Not recorded"
                        : new Intl.DateTimeFormat("en", {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: "UTC",
                          }).format(new Date(selectedEntry.aiGeneratedAt))}
                    </dd>
                  </div>
                </dl>
              ) : null}
              {selectedEntry.aiError !== null ? (
                <p className="field-help">
                  Provider note: {selectedEntry.aiError}
                </p>
              ) : null}
            </section>

            <section className="document-section source-section">
              <div className="section-heading">
                <div>
                  <h4>Source and attribution</h4>
                  <p>Verify this entry against the original public record.</p>
                </div>
                <a
                  className="text-link"
                  href={selectedEntry.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open source
                </a>
              </div>
              <dl className="source-metadata">
                <div>
                  <dt>Citation</dt>
                  <dd>{selectedEntry.citation}</dd>
                </div>
                <div>
                  <dt>Attribution</dt>
                  <dd>{selectedEntry.attribution}</dd>
                </div>
              </dl>
            </section>
          </article>
        )}
      </div>
    </section>
  );
}
