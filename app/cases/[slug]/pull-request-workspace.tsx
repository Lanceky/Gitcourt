"use client";

import { useState } from "react";

type PullRequestWorkspaceProps = {
  repositoryId: string;
  sourceBranchName: string;
  targetBranchName: string;
  documentPath: string;
  sourceUrl: string;
  sourceAttribution: string;
  citation: string;
  sourceExcerpt: string;
  identity: {
    displayName: string;
    email: string;
  };
};

type PullRequest = {
  id: string;
  sourceBranchName: string;
  targetBranchName: string;
  sourceHeadSha: string;
  targetHeadSha: string;
  title: string;
  description: string;
  status: string;
  hasConflicts: boolean;
  authorName: string;
  reviewerName: string | null;
  sourceUrl: string | null;
  sourceCitation: string | null;
  sourceAttribution: string | null;
  createdAt: string;
  mergedAt: string | null;
  reviews: Array<{
    id: string;
    reviewerName: string;
    decision: string;
    comment: string | null;
    createdAt: string;
  }>;
  diff: Array<{
    filepath: string;
    lines: Array<{
      type: "context" | "addition" | "deletion";
      value: string;
    }>;
  }>;
};

type AuditEvent = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  actorName: string | null;
  createdAt: string;
};

type BlameLine = {
  lineNumber: number;
  text: string;
  commit: {
    sha: string;
    authorName: string;
    publishedAt: string;
    docketLabel: string;
    sourceUrl: string | null;
    sourceCitation: string | null;
    attribution: string;
  };
};

type ApiFailure = {
  error?: string;
};

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  let payload: T | ApiFailure;

  try {
    payload = (await response.json()) as T | ApiFailure;
  } catch {
    throw new Error("The server returned an unreadable response.");
  }

  if (!response.ok) {
    throw new Error(
      (payload as ApiFailure).error ?? "The request could not be completed.",
    );
  }

  return payload as T;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default function PullRequestWorkspace({
  repositoryId,
  sourceBranchName,
  targetBranchName,
  documentPath,
  sourceUrl,
  sourceAttribution,
  citation,
  sourceExcerpt,
  identity,
}: PullRequestWorkspaceProps) {
  const [title, setTitle] = useState("Review alternate legal theory");
  const [description, setDescription] = useState(
    "Please review this student-authored interpretation against the public record.",
  );
  const [reviewerName, setReviewerName] = useState("Clinic Mentor");
  const [reviewerEmail, setReviewerEmail] = useState(
    "clinic.mentor@gitcourt.local",
  );
  const [reviewComment, setReviewComment] = useState("");
  const [pullRequest, setPullRequest] = useState<PullRequest | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [blameLines, setBlameLines] = useState<BlameLine[]>([]);
  const [busyAction, setBusyAction] = useState<
    "create" | "review" | "merge" | "load" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  function clearError(): void {
    setError(null);
  }

  async function refreshAccountability(pr: PullRequest): Promise<void> {
    const [audit, blame] = await Promise.all([
      requestJson<{ events: AuditEvent[] }>(
        `/api/repositories/${encodeURIComponent(repositoryId)}/audit`,
      ),
      requestJson<{ lines: BlameLine[] }>(
        `/api/repositories/${encodeURIComponent(
          repositoryId,
        )}/blame?ref=${encodeURIComponent(
          sourceBranchName,
        )}&filepath=${encodeURIComponent(documentPath)}`,
      ),
    ]);
    setAuditEvents(audit.events);
    setBlameLines(blame.lines);
    setPullRequest(pr);
  }

  async function createPullRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();
    setBusyAction("create");

    try {
      const result = await requestJson<{ pullRequest: PullRequest }>(
        `/api/repositories/${encodeURIComponent(repositoryId)}/pull-requests`,
        {
          method: "POST",
          body: JSON.stringify({
            actor: identity,
            reviewer: { displayName: reviewerName, email: reviewerEmail },
            sourceBranchName,
            targetBranchName,
            title,
            description,
            sourceUrl,
            citation,
            sourceExcerpt,
            attribution: sourceAttribution,
          }),
        },
      );
      await refreshAccountability(result.pullRequest);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The pull request could not be opened.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function submitReview(
    decision: "approve" | "request_changes" | "comment",
  ): Promise<void> {
    if (pullRequest === null) {
      return;
    }

    clearError();
    setBusyAction("review");
    try {
      const result = await requestJson<{ pullRequest: PullRequest }>(
        `/api/pull-requests/${encodeURIComponent(pullRequest.id)}/reviews`,
        {
          method: "POST",
          body: JSON.stringify({
            actor: { displayName: reviewerName, email: reviewerEmail },
            decision,
            comment: reviewComment,
          }),
        },
      );
      await refreshAccountability(result.pullRequest);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The review could not be recorded.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function mergePullRequest(): Promise<void> {
    if (pullRequest === null) {
      return;
    }

    clearError();
    setBusyAction("merge");
    try {
      const result = await requestJson<{
        pullRequest: PullRequest;
      }>(`/api/pull-requests/${encodeURIComponent(pullRequest.id)}/merge`, {
        method: "POST",
        body: JSON.stringify({
          actor: { displayName: reviewerName, email: reviewerEmail },
        }),
      });
      await refreshAccountability(result.pullRequest);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The pull request could not be merged.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="review-workspace" aria-labelledby="review-title">
      <div className="workflow-step-heading">
        <span className="step-number">4</span>
        <div>
          <h3 id="review-title">Open a reviewable pull request</h3>
          <p>
            Submit the theory for a second person to inspect. The canonical
            public case remains outside this fork.
          </p>
        </div>
      </div>

      {error !== null ? (
        <div aria-live="assertive" className="workflow-error" role="alert">
          {error}
        </div>
      ) : null}

      {pullRequest === null ? (
        <form className="review-form" onSubmit={createPullRequest}>
          <div className="workflow-fields">
            <div className="filter-field">
              <label htmlFor="pull-request-title">Pull request title</label>
              <input
                id="pull-request-title"
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </div>
            <div className="filter-field">
              <label htmlFor="reviewer-name">Assigned reviewer</label>
              <input
                id="reviewer-name"
                onChange={(event) => setReviewerName(event.target.value)}
                required
                value={reviewerName}
              />
            </div>
          </div>
          <div className="workflow-fields">
            <div className="filter-field">
              <label htmlFor="pull-request-description">Argument</label>
              <textarea
                id="pull-request-description"
                onChange={(event) => setDescription(event.target.value)}
                required
                rows={4}
                value={description}
              />
            </div>
            <div className="filter-field">
              <label htmlFor="reviewer-email">Reviewer demo email</label>
              <input
                id="reviewer-email"
                onChange={(event) => setReviewerEmail(event.target.value)}
                required
                type="email"
                value={reviewerEmail}
              />
              <span className="field-help">
                Demo mode labels this identity as the reviewer; it is not
                authentication.
              </span>
            </div>
          </div>
          <div className="review-branch-summary">
            <span>
              <strong>{sourceBranchName}</strong> →{" "}
              <strong>{targetBranchName}</strong>
            </span>
            <span>
              Source citation: <strong>{citation}</strong>
            </span>
          </div>
          <button
            className="button"
            disabled={busyAction !== null}
            type="submit"
          >
            {busyAction === "create"
              ? "Opening pull request…"
              : "Open pull request"}
          </button>
        </form>
      ) : (
        <>
          <div className="pull-request-header">
            <div>
              <p className="eyebrow">Pull request</p>
              <h4>{pullRequest.title}</h4>
              <p>{pullRequest.description}</p>
            </div>
            <span
              className={`status-pill status-${pullRequest.status} ${
                pullRequest.hasConflicts ? "status-conflict" : ""
              }`}
            >
              {pullRequest.hasConflicts ? "Conflict" : pullRequest.status}
            </span>
          </div>

          {pullRequest.hasConflicts ? (
            <div className="conflict-callout" role="alert">
              <strong>
                Two legal theories changed the same underlying text.
              </strong>
              <span>
                The branches cannot be merged automatically. A reviewer must
                resolve the competing reasoning instead of silently choosing a
                winner.
              </span>
            </div>
          ) : null}

          <div className="review-metadata-grid">
            <div>
              <span className="metadata-label">Source branch</span>
              <code>{pullRequest.sourceBranchName}</code>
              <small>{pullRequest.sourceHeadSha.slice(0, 7)}</small>
            </div>
            <div>
              <span className="metadata-label">Target branch</span>
              <code>{pullRequest.targetBranchName}</code>
              <small>{pullRequest.targetHeadSha.slice(0, 7)}</small>
            </div>
            <div>
              <span className="metadata-label">Author</span>
              <span>{pullRequest.authorName}</span>
            </div>
            <div>
              <span className="metadata-label">Reviewer</span>
              <span>{pullRequest.reviewerName ?? "Unassigned"}</span>
            </div>
          </div>

          <div className="diff-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Review diff</p>
                <h4>Changed documents</h4>
              </div>
              <span className="document-badge">
                {pullRequest.diff.length} file
                {pullRequest.diff.length === 1 ? "" : "s"}
              </span>
            </div>
            {pullRequest.diff.map((file) => (
              <div className="diff-file" key={file.filepath}>
                <code>{file.filepath}</code>
                <pre>
                  {file.lines.map((line, index) => (
                    <span className={`diff-line diff-${line.type}`} key={index}>
                      {line.type === "addition"
                        ? "+"
                        : line.type === "deletion"
                          ? "-"
                          : " "}
                      {line.value}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </div>
            ))}
          </div>

          <div className="review-source-card">
            <div>
              <span className="metadata-label">Authorship</span>
              <strong>{pullRequest.authorName}</strong>
              <p>Student interpretation recorded on the fork.</p>
            </div>
            <div>
              <span className="metadata-label">Public provenance</span>
              <a
                href={pullRequest.sourceUrl ?? sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                {pullRequest.sourceCitation ?? citation}
              </a>
              <p>{pullRequest.sourceAttribution ?? sourceAttribution}</p>
            </div>
          </div>

          {pullRequest.status === "open" ? (
            <div className="review-actions">
              <div className="filter-field">
                <label htmlFor="review-comment">Reviewer comment</label>
                <textarea
                  id="review-comment"
                  onChange={(event) => setReviewComment(event.target.value)}
                  placeholder="Explain the decision or request a source check."
                  rows={3}
                  value={reviewComment}
                />
              </div>
              <div className="workflow-actions">
                <button
                  className="button button-secondary"
                  disabled={busyAction !== null}
                  onClick={() => void submitReview("comment")}
                  type="button"
                >
                  Comment
                </button>
                <button
                  className="button button-secondary"
                  disabled={busyAction !== null}
                  onClick={() => void submitReview("request_changes")}
                  type="button"
                >
                  Request changes
                </button>
                <button
                  className="button"
                  disabled={busyAction !== null || pullRequest.hasConflicts}
                  onClick={() => void submitReview("approve")}
                  type="button"
                >
                  Approve
                </button>
                <button
                  className="button button-merge"
                  disabled={
                    busyAction !== null ||
                    pullRequest.hasConflicts ||
                    !pullRequest.reviews.some(
                      (review) => review.decision === "approve",
                    )
                  }
                  onClick={() => void mergePullRequest()}
                  type="button"
                >
                  {busyAction === "merge" ? "Merging…" : "Merge"}
                </button>
              </div>
            </div>
          ) : null}

          {pullRequest.reviews.length > 0 ? (
            <div className="review-list">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Review history</p>
                  <h4>Decisions and comments</h4>
                </div>
              </div>
              {pullRequest.reviews.map((review) => (
                <div className="review-entry" key={review.id}>
                  <strong>{review.reviewerName}</strong>
                  <span
                    className={`review-decision decision-${review.decision}`}
                  >
                    {review.decision.replace("_", " ")}
                  </span>
                  <time dateTime={review.createdAt}>
                    {formatDate(review.createdAt)}
                  </time>
                  {review.comment ? <p>{review.comment}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="accountability-grid">
            <div className="blame-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Line accountability</p>
                  <h4>Blame: {documentPath}</h4>
                </div>
              </div>
              {blameLines.map((line) => (
                <div className="blame-line" key={line.lineNumber}>
                  <code>{line.lineNumber}</code>
                  <span>{line.text}</span>
                  <a
                    href={line.commit.sourceUrl ?? sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                    title={line.commit.attribution}
                  >
                    {line.commit.authorName} · {line.commit.sha.slice(0, 7)}
                  </a>
                  <small>{line.commit.sourceCitation ?? "Source record"}</small>
                </div>
              ))}
            </div>
            <div className="audit-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Audit trail</p>
                  <h4>Who changed what</h4>
                </div>
              </div>
              {auditEvents.map((event) => (
                <div className="audit-entry" key={event.id}>
                  <strong>{event.eventType.replaceAll(".", " ")}</strong>
                  <span>{event.actorName ?? "System"}</span>
                  <time dateTime={event.createdAt}>
                    {formatDate(event.createdAt)}
                  </time>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
