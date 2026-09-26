import { notFound } from "next/navigation";
import Link from "next/link";

import CaseRepositoryExplorer from "@/app/cases/[slug]/case-repository-explorer";
import MootCourtWorkspace from "@/app/cases/[slug]/moot-court-workspace";
import { demoCase, getDemoDocketEntries } from "@/lib/demo-case";
import { CaseRepositoryService } from "@/lib/domain/case-repository-service";
import { db } from "@/lib/db";
import { importPublicCase } from "@/lib/import/public-case";

type CasePageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

export default async function CasePage({ params }: CasePageProps) {
  const { slug } = await params;
  const docketEntries = getDemoDocketEntries();

  if (slug !== demoCase.slug) {
    notFound();
  }

  const imported = await importPublicCase(db, demoCase);
  const persistedHistory = await new CaseRepositoryService(db).getHistory(
    imported.repositoryId,
    "main",
  );
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
          <Link href="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{demoCase.slug}</span>
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
            <article className="card readme readme-expanded">
              <div className="readme-heading">
                <span className="file-icon" aria-hidden="true">
                  #
                </span>
                <div>
                  <h2>README / Plain-language headnote</h2>
                  <p>Why this public record matters</p>
                </div>
              </div>
              <p>
                The Court considered whether the government&apos;s access to
                historical cell-site location information was a Fourth Amendment
                search requiring a warrant. This repository preserves a small,
                source-linked path through that public history.
              </p>
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
            <article className="card sidebar-card">
              <p className="eyebrow">Repository map</p>
              <h2>One authoritative history</h2>
              <p>
                This is the public record. Future moot-court exercises will
                happen in separate forks instead of changing this timeline.
              </p>
              <dl className="repository-facts">
                <div>
                  <dt>Branch</dt>
                  <dd>
                    <code>main</code>
                  </dd>
                </div>
                <div>
                  <dt>Entries</dt>
                  <dd>{docketEntries.length} public milestones</dd>
                </div>
                <div>
                  <dt>Jurisdiction</dt>
                  <dd>{demoCase.jurisdiction}</dd>
                </div>
              </dl>
            </article>

            <article className="card sidebar-card source-card">
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
