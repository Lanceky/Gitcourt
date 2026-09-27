import { notFound } from "next/navigation";
import Link from "next/link";

import CaseRepositoryExplorer from "@/app/cases/[slug]/case-repository-explorer";
import MootCourtWorkspace from "@/app/cases/[slug]/moot-court-workspace";
import { apiUrl, usesExternalApi } from "@/lib/api-client";
import { caseReadResponseSchema } from "@/lib/api-contracts";
import { demoCase, getDemoDocketEntries } from "@/lib/demo-case";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";
import { importPublicCase } from "@/lib/import/public-case";

type CasePageProps = {
  params: Promise<{ slug: string }>;
};

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

function fileNameForEntry(title: string, index: number): string {
  const fileName = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `docket/${String(index + 1).padStart(2, "0")}-${fileName || "entry"}.md`;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function loadPersistedHistory() {
  if (usesExternalApi()) {
    const response = await fetch(
      apiUrl(`/api/cases/${encodeURIComponent(demoCase.slug)}`),
      {
        cache: "no-store",
        headers: { accept: "application/json" },
      },
    );

    if (!response.ok) {
      throw new Error(
        `The Git Court backend returned HTTP ${response.status} while loading the case.`,
      );
    }

    return caseReadResponseSchema.parse(await response.json()).history;
  }

  const imported = await importPublicCase(db, demoCase);
  return new CaseRepositoryService(db).getHistory(
    imported.repositoryId,
    "main",
  );
}

export default async function CasePage({ params }: CasePageProps) {
  const { slug } = await params;
  const docketEntries = getDemoDocketEntries();

  if (slug !== demoCase.slug) {
    notFound();
  }

  const persistedHistory = await loadPersistedHistory();
  const explorerEntries = docketEntries.map((entry) => {
    const persisted = persistedHistory.find(
      (commit) =>
        commit.title === entry.title &&
        commit.publishedAt.toISOString().startsWith(entry.date),
    );

    return {
      ...entry,
      persistedSha: persisted?.sha ?? null,
      aiSummary: persisted?.aiSummary ?? null,
      aiKeyIssue: persisted?.aiKeyIssue ?? null,
      aiOutcome: persisted?.aiOutcome ?? null,
      aiSourceReferences: persisted?.aiSourceReferences ?? [],
      aiSourceCommitSha: persisted?.aiSourceCommitSha ?? null,
      aiModel: persisted?.aiModel ?? null,
      aiPromptVersion: persisted?.aiPromptVersion ?? null,
      aiStatus: persisted?.aiStatus ?? null,
      aiCitationWarnings: persisted?.aiCitationWarnings ?? [],
      aiError: persisted?.aiError ?? null,
      aiGeneratedAt: persisted?.aiGeneratedAt?.toISOString() ?? null,
    };
  });
  const latestEntry = docketEntries[docketEntries.length - 1];

  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            GC
          </span>
          Git Court
        </Link>
        <div className="topbar-actions">
          <span className="topbar-note">Canonical public repository</span>
          <a
            className="text-link"
            href={demoCase.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Official docket
          </a>
        </div>
      </header>

      <main className="main repository-page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span className="repo-breadcrumb-icon" aria-hidden="true">
            ◇
          </span>
          <Link href="/">gitcourt</Link>
          <span aria-hidden="true">/</span>
          <strong aria-current="page">{demoCase.slug}</strong>
          <span className="public-badge">Public</span>
        </nav>

        <section className="repository-header" aria-labelledby="case-title">
          <div>
            <p className="eyebrow">Public case repository</p>
            <h1 id="case-title">{demoCase.title}</h1>
            <p className="repository-description">{demoCase.summary}</p>
          </div>
          <div className="repository-status" aria-label="Repository status">
            <span className="status status-readonly">
              Read-only canonical record
            </span>
            <span className="repository-id">
              {demoCase.court} · No. {demoCase.docketNumber}
            </span>
          </div>
        </section>

        <nav className="repo-tabs" aria-label="Repository sections">
          <a className="repo-tab is-active" href="#docket">
            <span aria-hidden="true">▤</span>
            Docket
          </a>
          <a className="repo-tab" href="#filings">
            <span aria-hidden="true">▱</span>
            Filings
          </a>
          <a className="repo-tab" href="#branches">
            <span aria-hidden="true">⑂</span>
            Branches
          </a>
          <a className="repo-tab" href="#forks">
            <span aria-hidden="true">⑂</span>
            Forks
          </a>
          <a className="repo-tab" href="#insights">
            <span aria-hidden="true">◒</span>
            Insights
          </a>
        </nav>

        <div className="repo-toolbar" aria-label="Repository toolbar">
          <div className="repo-toolbar-left">
            <button className="branch-button" type="button">
              <span aria-hidden="true">⑂</span>
              main
              <span className="caret" aria-hidden="true">
                ▾
              </span>
            </button>
            <a className="toolbar-link" href="#branches">
              1 branch
            </a>
          </div>
          <div className="repo-toolbar-right">
            <label className="go-to-filing">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Go to filing</span>
              <input placeholder="Go to filing" type="search" />
            </label>
            <a className="button button-code" href="#moot-title">
              Fork this case
              <span className="button-caret" aria-hidden="true">
                ▾
              </span>
            </a>
          </div>
        </div>

        <MootCourtWorkspace
          caseSlug={demoCase.slug}
          caseTitle={demoCase.title}
          docketNumber={demoCase.docketNumber}
          entries={docketEntries}
          sourceAttribution={demoCase.sourceAttribution}
          sourceUrl={demoCase.sourceUrl}
        />

        <div className="repository-grid">
          <section className="repository-main">
            <section className="repo-file-list" id="docket">
              <div className="file-list-header">
                <div className="latest-commit">
                  <span className="avatar avatar-small" aria-hidden="true">
                    SC
                  </span>
                  <strong>{latestEntry.title}</strong>
                  <span className="muted">
                    · {formatRelativeDate(latestEntry.date)}
                  </span>
                </div>
                <a className="history-link" href="#history-title">
                  ↶ {docketEntries.length} commits
                </a>
              </div>
              <div className="file-list-rows">
                {docketEntries.map((entry, index) => (
                  <a
                    className="file-row"
                    href={`/cases/${demoCase.slug}#commit-${entry.sha.slice(0, 7)}`}
                    key={entry.sha}
                  >
                    <span className="file-row-icon" aria-hidden="true">
                      ▤
                    </span>
                    <span className="file-row-content">
                      <strong>{fileNameForEntry(entry.title, index)}</strong>
                      <span>{entry.summary}</span>
                    </span>
                    <time dateTime={entry.date}>
                      {formatRelativeDate(entry.date)}
                    </time>
                  </a>
                ))}
              </div>
            </section>

            <article className="card readme readme-expanded" id="filings">
              <div className="readme-heading">
                <span className="file-icon" aria-hidden="true">
                  ▤
                </span>
                <div>
                  <h2>README.md</h2>
                  <p>
                    Plain-language headnote · rendered from the public record
                  </p>
                </div>
              </div>
              <div className="readme-markdown">
                <h3>Carpenter v. United States</h3>
                <p>
                  The Court considered whether the government&apos;s access to
                  historical cell-site location information was a Fourth
                  Amendment search requiring a warrant. This repository
                  preserves a small, source-linked path through that public
                  history.
                </p>
              </div>
              <div className="source-attribution">
                <span>Primary source</span>
                <a href={demoCase.sourceUrl} rel="noreferrer" target="_blank">
                  {demoCase.sourceAttribution}
                </a>
              </div>
            </article>

            <CaseRepositoryExplorer
              branches={[
                {
                  name: "main",
                  label: "Canonical history",
                  isReadOnly: true,
                },
              ]}
              entries={explorerEntries}
            />
          </section>

          <aside className="repository-sidebar">
            <article className="about-panel sidebar-card">
              <h2>About</h2>
              <p>
                {demoCase.summary} This is the authoritative public record;
                moot-court work happens in isolated forks.
              </p>
              <div className="topic-list" aria-label="Topics">
                <span>Fourth Amendment</span>
                <span>SCOTUS</span>
                <span>2018</span>
                <span>Privacy</span>
              </div>
              <div className="sidebar-divider" />
              <dl className="repository-facts">
                <div>
                  <dt>
                    <span aria-hidden="true">◌</span> Following
                  </dt>
                  <dd>24</dd>
                </div>
                <div>
                  <dt>
                    <span aria-hidden="true">⑂</span> Moot court copies
                  </dt>
                  <dd>8</dd>
                </div>
                <div>
                  <dt>
                    <span aria-hidden="true">◉</span> Watchers
                  </dt>
                  <dd>17</dd>
                </div>
              </dl>
              <div className="sidebar-divider" />
              <h3>Case composition</h3>
              <div className="composition-bar" aria-label="Case composition">
                <span className="composition-majority" />
                <span className="composition-dissent" />
                <span className="composition-concurrence" />
              </div>
              <div className="composition-legend">
                <span>
                  <i className="legend-majority" /> Majority 55%
                </span>
                <span>
                  <i className="legend-dissent" /> Dissent 35%
                </span>
                <span>
                  <i className="legend-concurrence" /> Concurrence 10%
                </span>
              </div>
              <div className="sidebar-divider" />
              <h3>Contributors</h3>
              <div className="contributor-grid" aria-label="Case contributors">
                {["JR", "RG", "SB", "SS", "EK", "TK", "CT", "SA", "NG"].map(
                  (initials) => (
                    <span className="avatar contributor-avatar" key={initials}>
                      {initials}
                    </span>
                  ),
                )}
              </div>
              <div className="sidebar-divider" />
              <p className="sidebar-label">Jurisdiction</p>
              <p className="sidebar-value">{demoCase.jurisdiction}</p>
              <a
                className="source-link"
                href={demoCase.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open official docket ↗
              </a>
            </article>

            <article className="card sidebar-card source-card" id="insights">
              <p className="eyebrow">Source boundary</p>
              <h2>Read the original</h2>
              <p>
                Git Court keeps source text, attribution, and summaries separate
                so readers can check the record themselves.
              </p>
              <a
                className="button button-secondary"
                href={demoCase.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open official docket
              </a>
            </article>
          </aside>
        </div>
      </main>
    </div>
  );
}
