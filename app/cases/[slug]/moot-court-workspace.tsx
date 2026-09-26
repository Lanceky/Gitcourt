"use client";

import { useState } from "react";

import type { DemoDocketEntry } from "@/lib/demo-case";
import PullRequestWorkspace from "@/app/cases/[slug]/pull-request-workspace";

type MootCourtWorkspaceProps = {
  caseSlug: string;
  caseTitle: string;
  docketNumber: string;
  sourceAttribution: string;
  sourceUrl: string;
  entries: DemoDocketEntry[];
};

type Identity = {
  displayName: string;
  email: string;
};

type ForkState = {
  id: string;
  slug: string;
  title: string;
  parentRepositoryId: string | null;
  mainHeadSha: string | null;
};

type BranchState = {
  name: string;
  headSha: string | null;
};

type CommitState = {
  sha: string;
  documentPath: string;
};

type CommitSummary = {
  sha: string;
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

type ApiFailure = {
  error?: string;
};

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
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
      return "Summary pending";
  }
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, "-") || "moot-court-fork"
  );
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload: T | ApiFailure;

  try {
    payload = (await response.json()) as T | ApiFailure;
  } catch {
    throw new Error("The server returned an unreadable response.");
  }

  if (!response.ok) {
    const failure = payload as ApiFailure;
    throw new Error(failure.error ?? "The request could not be completed.");
  }

  return payload as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  let payload: T | ApiFailure;

  try {
    payload = (await response.json()) as T | ApiFailure;
  } catch {
    throw new Error("The server returned an unreadable response.");
  }

  if (!response.ok) {
    const failure = payload as ApiFailure;
    throw new Error(failure.error ?? "The request could not be completed.");
  }

  return payload as T;
}

export default function MootCourtWorkspace({
  caseSlug,
  caseTitle,
  docketNumber,
  sourceAttribution,
  sourceUrl,
  entries,
}: MootCourtWorkspaceProps) {
  const defaultEntry = entries[entries.length - 1];
  const [isOpen, setIsOpen] = useState(false);
  const [identity, setIdentity] = useState<Identity>({
    displayName: "Demo Student",
    email: "demo.student@gitcourt.local",
  });
  const [forkTitle, setForkTitle] = useState(`${caseTitle} - Moot Court Fork`);
  const [forkSlug, setForkSlug] = useState(`${caseSlug}-moot-court`);
  const [startingSha, setStartingSha] = useState(defaultEntry?.sha ?? "");
  const [fork, setFork] = useState<ForkState | null>(null);
  const [branch, setBranch] = useState<BranchState | null>(null);
  const [branchName, setBranchName] = useState("alternate-standing-argument");
  const [argumentTitle, setArgumentTitle] = useState(
    "Alternate standing argument",
  );
  const [argumentSummary, setArgumentSummary] = useState(
    "A student-authored theory to review against the public record.",
  );
  const [argumentContent, setArgumentContent] = useState(
    "This argument explores a different reading of the public record and identifies the facts a moot-court reviewer should test.",
  );
  const [sourceExcerpt, setSourceExcerpt] = useState(
    "The Court considered whether historical cell-site location information was a Fourth Amendment search requiring a warrant.",
  );
  const [citation, setCitation] = useState(
    `${caseTitle}, No. ${docketNumber}, public docket and opinion`,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [commit, setCommit] = useState<CommitState | null>(null);
  const [commitSummary, setCommitSummary] = useState<CommitSummary | null>(
    null,
  );
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    "fork" | "branch" | "commit" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  function updateIdentity(field: keyof Identity, value: string): void {
    setIdentity((current) => ({ ...current, [field]: value }));
  }

  function resetError(): void {
    setError(null);
  }

  async function loadCommitSummary(
    repositoryId: string,
    sha: string,
    regenerate = false,
  ): Promise<void> {
    setSummaryBusy(true);
    setSummaryError(null);

    try {
      const result = regenerate
        ? await postJson<{ summary: CommitSummary }>(
            `/api/repositories/${encodeURIComponent(
              repositoryId,
            )}/commits/${encodeURIComponent(sha)}/summary`,
            {},
          )
        : await getJson<{ summary: CommitSummary }>(
            `/api/repositories/${encodeURIComponent(
              repositoryId,
            )}/commits/${encodeURIComponent(sha)}/summary`,
          );
      setCommitSummary(result.summary);
    } catch (requestError) {
      setSummaryError(
        requestError instanceof Error
          ? requestError.message
          : "The summary could not be loaded.",
      );
    } finally {
      setSummaryBusy(false);
    }
  }

  async function createFork(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetError();
    setBusyAction("fork");

    try {
      const result = await postJson<{
        repository: {
          id: string;
          slug: string;
          title: string;
          parentRepositoryId: string | null;
        };
        branch: { headSha: string | null } | null;
      }>(`/api/cases/${encodeURIComponent(caseSlug)}/fork`, {
        actor: identity,
        slug: forkSlug,
        title: forkTitle,
        fromSha: startingSha,
      });

      setFork({
        id: result.repository.id,
        slug: result.repository.slug,
        title: result.repository.title,
        parentRepositoryId: result.repository.parentRepositoryId,
        mainHeadSha: result.branch?.headSha ?? null,
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The fork could not be created.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function createBranch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fork === null) {
      return;
    }

    resetError();
    setBusyAction("branch");

    try {
      const result = await postJson<{
        branch: { name: string; headSha: string | null };
      }>(`/api/repositories/${encodeURIComponent(fork.id)}/branches`, {
        actor: identity,
        name: branchName,
        fromSha: fork.mainHeadSha,
      });
      setBranch(result.branch);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The argument branch could not be created.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function commitArgument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fork === null || branch === null) {
      return;
    }

    resetError();
    setBusyAction("commit");

    try {
      const result = await postJson<{
        commit: { sha: string; documentPath: string };
      }>(`/api/repositories/${encodeURIComponent(fork.id)}/commits`, {
        actor: identity,
        branchName: branch.name,
        parentSha: branch.headSha,
        title: argumentTitle,
        content: argumentContent,
        summary: argumentSummary,
        sourceUrl,
        citation,
        sourceExcerpt,
        attribution: sourceAttribution,
      });
      setCommit(result.commit);
      setBranch((current) =>
        current === null ? current : { ...current, headSha: result.commit.sha },
      );
      void loadCommitSummary(fork.id, result.commit.sha);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The argument commit could not be created.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="card moot-workspace" aria-labelledby="moot-title">
      <div className="moot-heading">
        <div>
          <p className="eyebrow">Try a what-if argument</p>
          <h2 id="moot-title">Fork this case for moot court</h2>
          <p>
            Create an isolated copy, choose where the exercise starts, and write
            a student argument without changing the canonical record.
          </p>
        </div>
        <button
          aria-expanded={isOpen}
          className="button"
          onClick={() => {
            setIsOpen((current) => !current);
            resetError();
          }}
          type="button"
        >
          {isOpen ? "Close workspace" : "Fork for moot court"}
        </button>
      </div>

      {!isOpen ? (
        <div className="moot-collapsed">
          <span className="workflow-lock" aria-hidden="true">
            ↗
          </span>
          <span>
            <strong>Canonical history stays untouched.</strong> Browsing is
            anonymous; writing starts only after you name a demo identity.
          </span>
        </div>
      ) : (
        <div className="moot-flow">
          <div className="moot-boundary" role="note">
            <strong>Demo write boundary:</strong> this prototype uses the
            identity below for attribution. It is not a sign-in system and does
            not grant access to private case data.
          </div>

          {error !== null ? (
            <div aria-live="assertive" className="workflow-error" role="alert">
              {error}
            </div>
          ) : null}

          {fork === null ? (
            <form className="workflow-step" onSubmit={createFork}>
              <div className="workflow-step-heading">
                <span className="step-number">1</span>
                <div>
                  <h3>Name your moot-court fork</h3>
                  <p>
                    The source repository remains read-only. Your fork will
                    inherit the selected public history.
                  </p>
                </div>
              </div>

              <div className="workflow-fields identity-fields">
                <div className="filter-field">
                  <label htmlFor="demo-display-name">Demo display name</label>
                  <input
                    id="demo-display-name"
                    onChange={(event) =>
                      updateIdentity("displayName", event.target.value)
                    }
                    required
                    value={identity.displayName}
                  />
                </div>
                <div className="filter-field">
                  <label htmlFor="demo-email">Demo email</label>
                  <input
                    id="demo-email"
                    onChange={(event) =>
                      updateIdentity("email", event.target.value)
                    }
                    required
                    type="email"
                    value={identity.email}
                  />
                </div>
              </div>

              <div className="workflow-fields">
                <div className="filter-field">
                  <label htmlFor="fork-title">Fork title</label>
                  <input
                    id="fork-title"
                    onChange={(event) => setForkTitle(event.target.value)}
                    required
                    value={forkTitle}
                  />
                </div>
                <div className="filter-field">
                  <label htmlFor="fork-slug">Fork URL slug</label>
                  <input
                    id="fork-slug"
                    onChange={(event) =>
                      setForkSlug(slugify(event.target.value))
                    }
                    required
                    value={forkSlug}
                  />
                </div>
              </div>

              <div className="filter-field">
                <label htmlFor="fork-start">Start from public commit</label>
                <select
                  id="fork-start"
                  onChange={(event) => setStartingSha(event.target.value)}
                  value={startingSha}
                >
                  {entries.map((entry) => (
                    <option key={entry.sha} value={entry.sha}>
                      {formatDate(entry.date)} · {entry.title} ·{" "}
                      {entry.sha.slice(0, 7)}
                    </option>
                  ))}
                </select>
                <span className="field-help">
                  Starting earlier lets the exercise test reasoning before the
                  final judgment.
                </span>
              </div>

              <div className="workflow-actions">
                <button
                  className="button"
                  disabled={busyAction !== null}
                  type="submit"
                >
                  {busyAction === "fork" ? "Creating fork…" : "Create fork"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="relationship-panel">
                <div className="relationship-heading">
                  <div>
                    <p className="eyebrow">Repository relationship</p>
                    <h3>Your isolated workspace is ready</h3>
                  </div>
                  <span className="relationship-badge">Forked</span>
                </div>
                <div className="relationship-diagram">
                  <div className="relationship-node canonical-node">
                    <span className="node-label">Authoritative source</span>
                    <strong>{caseTitle}</strong>
                    <code>main · read-only</code>
                  </div>
                  <span className="relationship-arrow" aria-hidden="true">
                    →
                  </span>
                  <div className="relationship-node fork-node">
                    <span className="node-label">Your moot-court fork</span>
                    <strong>{fork.slug}</strong>
                    <code>main · starts {fork.mainHeadSha?.slice(0, 7)}</code>
                  </div>
                </div>
                <p className="relationship-caption">
                  Parent case: <code>{fork.parentRepositoryId}</code>. Changes
                  in this workspace cannot rewrite the source history.
                </p>
              </div>

              {branch === null ? (
                <form className="workflow-step" onSubmit={createBranch}>
                  <div className="workflow-step-heading">
                    <span className="step-number">2</span>
                    <div>
                      <h3>Create a legal-theory branch</h3>
                      <p>
                        Use a short name that tells a reviewer what the
                        alternative theory tests.
                      </p>
                    </div>
                  </div>
                  <div className="workflow-fields">
                    <div className="filter-field">
                      <label htmlFor="branch-name">Branch name</label>
                      <input
                        id="branch-name"
                        onChange={(event) => setBranchName(event.target.value)}
                        pattern="[A-Za-z0-9][A-Za-z0-9._/-]*"
                        required
                        value={branchName}
                      />
                      <span className="field-help">
                        Example: alternate-standing-argument
                      </span>
                    </div>
                  </div>
                  <div className="workflow-actions">
                    <button
                      className="button"
                      disabled={busyAction !== null}
                      type="submit"
                    >
                      {busyAction === "branch"
                        ? "Creating branch…"
                        : "Create theory branch"}
                    </button>
                  </div>
                </form>
              ) : (
                <form className="workflow-step" onSubmit={commitArgument}>
                  <div className="workflow-step-heading">
                    <span className="step-number">3</span>
                    <div>
                      <h3>Draft and commit an argument</h3>
                      <p>
                        Preview the student-authored document before it is
                        recorded on your fork.
                      </p>
                    </div>
                  </div>

                  <div className="branch-context">
                    <span>Writing on</span>
                    <code>{branch.name}</code>
                    <span>from</span>
                    <code>{branch.headSha?.slice(0, 7)}</code>
                  </div>

                  <div className="workflow-fields">
                    <div className="filter-field">
                      <label htmlFor="argument-title">Argument title</label>
                      <input
                        id="argument-title"
                        onChange={(event) =>
                          setArgumentTitle(event.target.value)
                        }
                        required
                        value={argumentTitle}
                      />
                    </div>
                    <div className="filter-field">
                      <label htmlFor="argument-summary">
                        Short explanation
                      </label>
                      <input
                        id="argument-summary"
                        onChange={(event) =>
                          setArgumentSummary(event.target.value)
                        }
                        required
                        value={argumentSummary}
                      />
                    </div>
                  </div>

                  <div className="filter-field">
                    <label htmlFor="argument-content">Argument document</label>
                    <textarea
                      id="argument-content"
                      onChange={(event) =>
                        setArgumentContent(event.target.value)
                      }
                      required
                      rows={6}
                      value={argumentContent}
                    />
                  </div>

                  <div className="workflow-source">
                    <div className="workflow-source-heading">
                      <div>
                        <h4>Public source citation</h4>
                        <p>
                          Keep the student interpretation distinct from the
                          public record it cites.
                        </p>
                      </div>
                      <span className="document-badge">Required</span>
                    </div>
                    <div className="filter-field">
                      <label htmlFor="source-excerpt">
                        Source excerpt/note
                      </label>
                      <textarea
                        id="source-excerpt"
                        onChange={(event) =>
                          setSourceExcerpt(event.target.value)
                        }
                        required
                        rows={3}
                        value={sourceExcerpt}
                      />
                    </div>
                    <div className="filter-field">
                      <label htmlFor="source-citation">Citation</label>
                      <input
                        id="source-citation"
                        onChange={(event) => setCitation(event.target.value)}
                        required
                        value={citation}
                      />
                    </div>
                    <p className="source-preview">
                      Source:{" "}
                      <a href={sourceUrl} rel="noreferrer" target="_blank">
                        {sourceAttribution}
                      </a>
                    </p>
                  </div>

                  {previewOpen ? (
                    <div className="argument-preview" aria-live="polite">
                      <div className="argument-preview-heading">
                        <div>
                          <p className="eyebrow">Commit preview</p>
                          <h4>{argumentTitle}</h4>
                        </div>
                        <code>{branch.name}</code>
                      </div>
                      <dl className="preview-metadata">
                        <div>
                          <dt>Entry type</dt>
                          <dd>Student argument</dd>
                        </div>
                        <div>
                          <dt>Parent</dt>
                          <dd>{branch.headSha?.slice(0, 7)}</dd>
                        </div>
                        <div>
                          <dt>Source</dt>
                          <dd>{citation}</dd>
                        </div>
                      </dl>
                      <p>{argumentSummary}</p>
                      <pre>{argumentContent}</pre>
                    </div>
                  ) : null}

                  {commit === null ? (
                    <div className="workflow-actions">
                      <button
                        className="button button-secondary"
                        onClick={() => setPreviewOpen((current) => !current)}
                        type="button"
                      >
                        {previewOpen ? "Hide preview" : "Preview commit"}
                      </button>
                      {previewOpen ? (
                        <button
                          className="button"
                          disabled={busyAction !== null}
                          type="submit"
                        >
                          {busyAction === "commit"
                            ? "Committing argument…"
                            : "Commit to fork"}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div aria-live="polite" className="commit-success">
                      <span className="success-icon" aria-hidden="true">
                        ✓
                      </span>
                      <div>
                        <strong>Argument committed to your fork.</strong>
                        <p>
                          <code>{commit.sha.slice(0, 7)}</code> ·{" "}
                          {commit.documentPath}
                        </p>
                        <span>
                          The canonical <code>main</code> record is unchanged.
                        </span>
                      </div>
                    </div>
                  )}
                  {commit !== null ? (
                    <section
                      aria-labelledby="ai-summary-title"
                      className="ai-summary-card"
                    >
                      <div className="panel-heading">
                        <div>
                          <p className="eyebrow">Guarded AI feature</p>
                          <h4 id="ai-summary-title">Commit summary</h4>
                        </div>
                        <span className="document-badge">
                          {summaryStatusLabel(commitSummary?.aiStatus ?? null)}
                        </span>
                      </div>
                      <p className="ai-summary-disclaimer">
                        AI output is educational orientation only, not a legal
                        conclusion or advice. Keep the original source open
                        while reviewing it.
                      </p>
                      {summaryBusy && commitSummary === null ? (
                        <p className="field-help">Loading summary metadata…</p>
                      ) : null}
                      {summaryError !== null ? (
                        <div className="citation-callout" role="alert">
                          {summaryError}
                        </div>
                      ) : null}
                      {commitSummary !== null ? (
                        <>
                          <p className="ai-summary-copy">
                            {commitSummary.aiSummary ??
                              "No summary was returned; verify the original source."}
                          </p>
                          <dl className="ai-summary-facts">
                            <div>
                              <dt>Key issue</dt>
                              <dd>
                                {commitSummary.aiKeyIssue ?? "Not provided"}
                              </dd>
                            </div>
                            <div>
                              <dt>Outcome</dt>
                              <dd>
                                {commitSummary.aiOutcome ?? "Not provided"}
                              </dd>
                            </div>
                            <div>
                              <dt>Model</dt>
                              <dd>{commitSummary.aiModel ?? "Not recorded"}</dd>
                            </div>
                            <div>
                              <dt>Prompt version</dt>
                              <dd>
                                {commitSummary.aiPromptVersion ??
                                  "Not recorded"}
                              </dd>
                            </div>
                            <div>
                              <dt>Source commit</dt>
                              <dd>
                                <code>
                                  {(
                                    commitSummary.aiSourceCommitSha ??
                                    commit.sha
                                  ).slice(0, 7)}
                                </code>
                              </dd>
                            </div>
                            <div>
                              <dt>Generated</dt>
                              <dd>
                                {commitSummary.aiGeneratedAt === null
                                  ? "Not recorded"
                                  : formatTimestamp(
                                      commitSummary.aiGeneratedAt,
                                    )}
                              </dd>
                            </div>
                          </dl>
                          <div className="ai-source-references">
                            <span className="metadata-label">
                              Source references
                            </span>
                            {commitSummary.aiSourceReferences.length === 0 ? (
                              <span>None recorded</span>
                            ) : (
                              commitSummary.aiSourceReferences.map(
                                (reference) => (
                                  <a
                                    href={reference}
                                    key={reference}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    {reference}
                                  </a>
                                ),
                              )
                            )}
                          </div>
                          {commitSummary.aiCitationWarnings.length > 0 ? (
                            <div className="citation-callout" role="alert">
                              <strong>
                                Citation formatting assistance found warnings.
                              </strong>
                              <ul>
                                {commitSummary.aiCitationWarnings.map(
                                  (issue) => (
                                    <li key={`${issue.code}-${issue.message}`}>
                                      {issue.message}
                                    </li>
                                  ),
                                )}
                              </ul>
                            </div>
                          ) : null}
                          {commitSummary.aiError !== null ? (
                            <p className="field-help">
                              Provider note: {commitSummary.aiError}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                      <button
                        className="button button-secondary"
                        disabled={summaryBusy}
                        onClick={() =>
                          void loadCommitSummary(fork.id, commit.sha, true)
                        }
                        type="button"
                      >
                        {summaryBusy
                          ? "Refreshing summary…"
                          : "Generate / refresh summary"}
                      </button>
                    </section>
                  ) : null}
                </form>
              )}
            </>
          )}
          {fork !== null && branch !== null && commit !== null ? (
            <PullRequestWorkspace
              citation={citation}
              documentPath={commit.documentPath}
              identity={identity}
              repositoryId={fork.id}
              sourceAttribution={sourceAttribution}
              sourceBranchName={branch.name}
              sourceExcerpt={sourceExcerpt}
              sourceUrl={sourceUrl}
              targetBranchName="main"
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
