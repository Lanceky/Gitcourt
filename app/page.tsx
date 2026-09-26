import Link from "next/link";

import { demoCase } from "@/lib/demo-case";

const gitToCourt = [
  ["Repository", "Case file"],
  ["Commit", "Docket entry"],
  ["Branch", "Legal theory"],
  ["Fork", "Moot court"],
];

export default function HomePage() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            GC
          </span>
          Git Court
        </Link>
        <span className="topbar-note">
          Public records, versioned for learning
        </span>
      </header>

      <main className="main">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">A GitHub-inspired case workspace</p>
          <h1 id="hero-title">Explore what a case could become.</h1>
          <p className="hero-copy">
            Git Court turns public court histories into readable, reviewable
            repositories. Follow the record, fork it for moot court, and keep
            every alternative argument safely separate.
          </p>
          <Link className="button" href="#case-repository">
            Open the demo case
          </Link>
        </section>

        <section
          className="repo-grid"
          id="case-repository"
          aria-label="Case repository"
        >
          <article className="card repo-card">
            <div className="repo-heading">
              <p className="eyebrow">Public repository</p>
              <h2>{demoCase.title}</h2>
              <p className="repo-meta">
                <span>{demoCase.court}</span>
                <span>{demoCase.docketNumber}</span>
                <span className="status">{demoCase.status}</span>
              </p>
            </div>

            <div className="readme">
              <h3>README / Plain-language headnote</h3>
              <p>{demoCase.summary}</p>
            </div>

            <div className="timeline">
              <div className="timeline-heading">
                <h3>Docket history</h3>
                <span>{demoCase.entries.length} commits</span>
              </div>
              {demoCase.entries.map((entry) => (
                <article className="commit" key={entry.sha}>
                  <span className="commit-icon" aria-hidden="true">
                    {entry.type.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <p className="commit-title">{entry.title}</p>
                    <p className="commit-summary">{entry.summary}</p>
                    <p className="commit-meta">
                      {entry.author} · {entry.date}
                    </p>
                  </div>
                  <code className="commit-sha">{entry.sha}</code>
                </article>
              ))}
            </div>
          </article>

          <aside className="card side-card">
            <h2>The Git-to-gavel map</h2>
            <p>
              Familiar collaboration concepts make a complex legal record easier
              to inspect and discuss.
            </p>
            <dl className="mapping">
              {gitToCourt.map(([gitTerm, courtTerm]) => (
                <div className="mapping-row" key={gitTerm}>
                  <dt>{gitTerm}</dt>
                  <dd>{courtTerm}</dd>
                </div>
              ))}
            </dl>
            <p className="notice">
              Educational research tool only. Verify every source; this is not
              legal advice.
            </p>
          </aside>
        </section>
      </main>
    </div>
  );
}
