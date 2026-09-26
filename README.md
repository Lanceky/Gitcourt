# Git Court

Git Court is a public-record learning workspace for court cases. It applies familiar GitHub collaboration patterns to legal history: cases are repositories, docket entries are commits, legal theories are branches, and a fork is a safe moot-court exercise.

## Product story

### Problem

Public court histories are procedurally rich but are usually presented as difficult-to-navigate paperwork. Law students and self-represented litigants cannot easily see how a case evolved, trace the source of an argument, or safely test an alternative theory without changing the real record.

### Promise

**Fork a real public case, explore a what-if argument, and make every change reviewable.**

Git Court is an educational research tool, not legal advice. It uses public case law and court records only; it does not handle active client matters, confidential filings, or privileged work product.

### Primary users

- **Primary:** law students and self-represented litigants learning how arguments and rulings develop.
- **Secondary:** clinic mentors, instructors, attorneys, and researchers reviewing public legal history.

### Three-minute demo

1. Open a curated public appellate case and read its plain-language history.
2. Fork the case for moot court and create an `alternate-standing-argument` branch.
3. Add an argument commit without changing the public case.
4. Open a pull request, inspect the redline, and have a clinic mentor approve or request changes.
5. Use blame and the audit trail to trace a clause to its commit, author, date, and public source.

### Acceptance criteria

- A visitor can understand the seeded case without legal expertise or an account.
- The case timeline shows ordered, immutable docket commits with source links.
- A student can fork the case, branch an alternative theory, and create an argument commit.
- A pull request shows changed content and supports review before merge.
- A conflicting edit is explained as a legal-theory disagreement and cannot merge silently.
- Blame identifies the commit, author, date, and source for each changed line or paragraph.
- Forks, commits, reviews, conflicts, and merges appear in an accountability timeline.
- The original public case remains read-only throughout the student workflow.
- AI-generated summaries, when enabled, are source-linked, labeled for verification, and never presented as legal advice.

### Deliberate non-goals

The hackathon MVP will not provide legal advice, ingest active or confidential matters, replace a court docket, operate as a general-purpose Git hosting service, or attempt to cover every jurisdiction. It will prioritize one carefully curated public appellate case and a complete, understandable workflow over a large case database.

## Current foundation

The application uses Next.js, React, and TypeScript with Prisma and SQLite for local development. A filesystem-backed `isomorphic-git` adapter stores the case repositories, while the repository layer remains replaceable so PostgreSQL can replace SQLite without changing the domain workflow.

The domain model covers case repositories, immutable docket commits, branches, forks, pull requests, reviews, public source records, and audit events. Server-side policies protect the canonical public case, require public provenance, isolate forks, reject stale commits and unresolved conflicts, and restrict merges to assigned reviewers or administrators.

The demo fixture is **Carpenter v. United States, No. 16-402**, imported from the public Supreme Court docket and opinion. The importer keeps source text, publication dates, document types, URLs, citations, document hashes, and attribution separate from any future AI summary.

The read-first interface is available at `/cases/carpenter-v-united-states`: it presents the plain-language headnote, canonical `main` branch, searchable docket timeline, and source-backed commit detail without requiring an account. Its moot-court workspace accepts an explicit demo identity, creates an isolated fork from a selected public milestone, and previews a student argument before committing it to a separate branch.

After the argument commit, the workspace can open a pull request from the theory branch to the fork's `main` branch. The review panel renders changed files and line-level additions, deletions, and context; it records comments, requests for changes, approvals, and the resulting merge SHA. The blame and audit panels keep student authorship, public source provenance, and workflow activity visibly separate. Reviewer identities are labeled demo identities rather than authentication and must be replaced with real authentication before production use.

## Guarded AI summaries

AI summaries are an optional, server-side feature controlled by `AI_SUMMARY_ENABLED`. When enabled, Git Court sends only the selected public-record text and its provenance metadata to the configured OpenAI-compatible endpoint. The provider must return structured JSON containing a short summary, key issue, outcome, and source references. The application stores the model, prompt version, generation time, source commit SHA, source references, status, and any citation warnings alongside the original text.

Every result is labeled **AI-generated — verify against the source** and is explicitly educational, not legal advice. If credentials are absent, the provider is unavailable, the response is malformed, or its links do not match the supplied HTTPS provenance URL, Git Court retains a manual fallback and records the reason. Citation checks flag malformed links, missing case citations, and unsupported source references as formatting assistance only; an invalid check prevents a pull request approval but does not claim to validate legal accuracy. AI generation is never required by the merge operation, and API keys remain server-side.

## Deployment target

Deploy the backend API and persistence layer on **Render**. Deploy the Next.js frontend on **Vercel** and point it at the Render API. After the deployed workflow is verified, attach the supplied **`.xyz` domain** to the Vercel frontend.

The Render service must mount persistent storage for `GIT_REPOSITORIES_PATH`; Git Court stores repository objects on the backend filesystem alongside the database metadata.

## Status

This repository is being built for LexHack 2026. The current implementation is intentionally incremental; see the local implementation plan for the complete twelve-step roadmap.
