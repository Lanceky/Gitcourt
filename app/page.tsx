import Link from "next/link";

import GitHubProjectMenu from "@/app/github-project-menu";
import { demoCase, getDemoDocketEntries } from "@/lib/demo-case";

const gitToCourt = [
  ["Repository", "Case file"],
  ["Commit", "Docket entry"],
  ["Branch", "Legal theory"],
  ["Fork", "Moot court"],
];

export default function HomePage() {
  const docketEntries = getDemoDocketEntries();
  const recentEntries = docketEntries.slice(-3).reverse();

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
          <span className="topbar-note">
            Public records, versioned for learning
          </span>
          <GitHubProjectMenu caseHref={`/cases/${demoCase.slug}`} />
        </div>
      </header>

      <main className="main landing-page">
        <div className="landing-repo-context">
          <div className="repo-path">
            <span className="repo-breadcrumb-icon" aria-hidden="true">
              ◇
            </span>
            <strong>gitcourt</strong>
            <span aria-hidden="true">/</span>
            <span>carpenter-v-united-states</span>
            <span className="public-badge">Public</span>
          </div>
          <nav className="repo-tabs" aria-label="Repository sections">
            <a className="repo-tab is-active" href="#how-it-works">
              <span aria-hidden="true">▤</span>
              Docket
            </a>
            <a className="repo-tab" href={`/cases/${demoCase.slug}`}>
              <span aria-hidden="true">⑂</span>
              Explore case
            </a>
          </nav>
        </div>

        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">A GitHub-inspired case workspace</p>
          <h1 id="hero-title">Read the record. Follow the reasoning.</h1>
          <p className="hero-copy">
            Git Court turns public court histories into readable, reviewable
            repositories. Start with the original record, inspect each
            milestone, and keep future moot-court work safely separate.
          </p>
          <div className="hero-actions">
            <Link
              className="button"
              href={`/cases/${demoCase.slug}`}
              id="open-demo-case"
            >
              Open the demo case
            </Link>
            <a className="button button-secondary" href="#how-it-works">
              How it works
            </a>
          </div>
        </section>

        <section className="landing-grid" id="how-it-works">
          <article className="card landing-card">
            <p className="eyebrow">Start with one public case</p>
            <h2>{demoCase.title}</h2>
            <p className="landing-card-copy">{demoCase.summary}</p>
            <dl className="landing-case-facts">
              <div>
                <dt>Court</dt>
                <dd>{demoCase.court}</dd>
              </div>
              <div>
                <dt>Docket</dt>
                <dd>{demoCase.docketNumber}</dd>
              </div>
              <div>
                <dt>History</dt>
                <dd>{docketEntries.length} source-linked milestones</dd>
              </div>
            </dl>
            <Link className="text-link" href={`/cases/${demoCase.slug}`}>
              Browse the full repository →
            </Link>
          </article>

          <aside className="card landing-card">
            <p className="eyebrow">Repository conventions</p>
            <h2>Familiar concepts, clearer history</h2>
            <p className="landing-card-copy">
              The interface borrows collaboration patterns from GitHub without
              treating a legal record like a code repository.
            </p>
            <dl className="mapping">
              {gitToCourt.map(([gitTerm, courtTerm]) => (
                <div className="mapping-row" key={gitTerm}>
                  <dt>{gitTerm}</dt>
                  <dd>{courtTerm}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </section>

        <section
          className="card landing-preview"
          aria-labelledby="preview-title"
        >
          <div className="preview-heading">
            <div>
              <p className="eyebrow">A read-first workflow</p>
              <h2 id="preview-title">See the latest milestones at a glance</h2>
            </div>
            <Link className="text-link" href={`/cases/${demoCase.slug}`}>
              View all commits
            </Link>
          </div>
          <div className="preview-list">
            {recentEntries.map((entry) => (
              <Link
                className="preview-entry"
                href={`/cases/${demoCase.slug}#commit-${entry.sha.slice(0, 7)}`}
                key={entry.sha}
              >
                <span className="timeline-marker" aria-hidden="true">
                  {entry.type.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{entry.title}</strong>
                  <span>
                    {entry.author} · {entry.date}
                  </span>
                </span>
                <code>{entry.sha.slice(0, 7)}</code>
              </Link>
            ))}
          </div>
        </section>

        <p className="landing-source">
          Demo source:{" "}
          <a href={demoCase.sourceUrl} rel="noreferrer" target="_blank">
            {demoCase.sourceAttribution}
          </a>
        </p>
      </main>
    </div>
  );
}
