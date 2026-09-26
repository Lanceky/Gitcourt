"use client";

import { useEffect, useMemo, useState } from "react";

import type { DemoDocketEntry } from "@/lib/demo-case";

type Branch = {
  name: string;
  label: string;
  isReadOnly: boolean;
};

type CaseRepositoryExplorerProps = {
  branches: Branch[];
  entries: DemoDocketEntry[];
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

export default function CaseRepositoryExplorer({
  branches,
  entries,
}: CaseRepositoryExplorerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [entryType, setEntryType] = useState("all");
  const [branchName, setBranchName] = useState("all");
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
              {visibleEntries.map((entry) => {
                const isSelected = entry.sha === selectedEntry?.sha;

                return (
                  <button
                    aria-pressed={isSelected}
                    className={`timeline-entry${isSelected ? " is-selected" : ""}`}
                    key={entry.sha}
                    onClick={() => selectEntry(entry.sha)}
                    type="button"
                  >
                    <span className="timeline-line" aria-hidden="true" />
                    <span className="timeline-marker" aria-hidden="true">
                      {entry.type.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="timeline-entry-content">
                      <span className="timeline-entry-title">
                        {entry.title}
                      </span>
                      <span className="timeline-entry-meta">
                        {formatEntryType(entry.type)} · {formatDate(entry.date)}
                      </span>
                      <span className="timeline-entry-summary">
                        {entry.summary}
                      </span>
                    </span>
                    <code title={`Full commit SHA ${entry.sha}`}>
                      {entry.sha.slice(0, 7)}
                    </code>
                  </button>
                );
              })}
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
                  <h4>Generated summary</h4>
                  <p>Plain-language orientation, not legal advice.</p>
                </div>
              </div>
              <p>{selectedEntry.summary}</p>
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
