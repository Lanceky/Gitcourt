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

## Run locally

```bash
npm ci
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000` after the development server starts. The migration and seed commands are safe to rerun; they preserve the single public fixture without duplicating its docket entries.

## Current foundation

The application uses Next.js, React, and TypeScript with Prisma and SQLite for local development. A filesystem-backed `isomorphic-git` adapter stores the case repositories, while the repository layer remains replaceable so PostgreSQL can replace SQLite without changing the domain workflow.

The domain model covers case repositories, immutable docket commits, branches, forks, pull requests, reviews, public source records, and audit events. Server-side policies protect the canonical public case, require public provenance, isolate forks, reject stale commits and unresolved conflicts, and restrict merges to assigned reviewers or administrators.

The demo fixture is **Carpenter v. United States, No. 16-402**, imported from the public Supreme Court docket and opinion. The importer keeps source text, publication dates, document types, URLs, citations, document hashes, and attribution separate from any future AI summary.

The read-first interface is available at `/cases/carpenter-v-united-states`: it presents the plain-language headnote, canonical `main` branch, searchable docket timeline, and source-backed commit detail without requiring an account. Its moot-court workspace accepts an explicit demo identity, creates an isolated fork from a selected public milestone, and previews a student argument before committing it to a separate branch.

After the argument commit, the workspace can open a pull request from the theory branch to the fork's `main` branch. The review panel renders changed files and line-level additions, deletions, and context; it records comments, requests for changes, approvals, and the resulting merge SHA. The blame and audit panels keep student authorship, public source provenance, and workflow activity visibly separate. Reviewer identities are labeled demo identities rather than authentication and must be replaced with real authentication before production use.

## Guarded AI summaries

AI summaries are an optional, server-side feature controlled by `AI_SUMMARY_ENABLED`. When enabled, Git Court sends only the selected public-record text and its provenance metadata to the configured OpenAI-compatible endpoint. The provider must return structured JSON containing a short summary, key issue, outcome, and source references. The application stores the model, prompt version, generation time, source commit SHA, source references, status, and any citation warnings alongside the original text.

Every result is labeled **AI-generated — verify against the source** and is explicitly educational, not legal advice. If credentials are absent, the provider is unavailable, the response is malformed, or its links do not match the supplied HTTPS provenance URL, Git Court retains a manual fallback and records the reason. Citation checks flag malformed links, missing case citations, and unsupported source references as formatting assistance only; an invalid check prevents a pull request approval but does not claim to validate legal accuracy. AI generation is never required by the merge operation, and API keys remain server-side.

## Testing and safety checks

The critical workflow is covered by unit, integration, and route-level tests:

```bash
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

The route boundary validates internal IDs, Git references, branch names, repository document paths, public HTTPS sources, and bounded text fields before domain operations run. Student writes, reviews, merges, and explicit AI refreshes have server-side in-memory rate limits for the prototype; production deployment should add an edge or service-level limiter. The UI renders source text and student arguments as escaped React text rather than injecting HTML, and all write failures remain visible to the user.

## Vercel-only deployment

Git Court is deployed as one Next.js project on **Vercel**. The same deployment serves the React pages and the `/api/*` route handlers; no separate backend service is required. `vercel.json` uses `npm ci` and `npm run vercel-build`, which generates Prisma Client, applies committed migrations, imports the public fixture idempotently, and builds the application.

Configure these Vercel project variables for the seeded demo:

```text
NODE_ENV=production
DATABASE_URL=file:./dev.db
GIT_REPOSITORIES_PATH=.data/repositories
NEXT_PUBLIC_APP_URL=https://your-project.vercel.app
AI_SUMMARY_ENABLED=false
```

After deployment, verify the clean public URL with:

```bash
npm run verify:deployment -- https://your-project.vercel.app
```

The current SQLite database and `isomorphic-git` filesystem are intentionally kept unchanged for the hackathon. Vercel deployment files are read-only and writable `/tmp` storage is instance-local, so a Vercel-only deployment is suitable for the public, read-first seeded demo but does **not** provide durable fork, commit, review, or merge persistence across serverless instances. The complete collaboration workflow remains reproducible locally. Durable production collaboration requires replacing these adapters with Vercel-compatible persistent database and object storage; no Render service is introduced or required by this code path. Attach the supplied **`.xyz` domain** to the Vercel project only after the public URL passes verification.

## Devpost submission package

- **Project:** Git Court — a public-record learning workspace for court cases.
- **Summary:** Fork a real public case, explore a what-if argument, and make every change reviewable.
- **Problem:** Public court histories are difficult to follow and unsafe to alter for learning.
- **Solution:** Source-linked case repositories, isolated moot-court forks, legal-theory branches, reviewable pull requests, conflict explanations, blame, audit events, and guarded AI summaries.
- **Tech stack:** Next.js, React, TypeScript, Prisma, SQLite, `isomorphic-git`, Zod, and an optional OpenAI-compatible summary provider.
- **Source attribution:** Carpenter v. United States, No. 16-402, from the public Supreme Court docket and opinion sources listed in the application.
- **Demo sequence:** Problem (0:00), public history (0:20), fork and alternate argument (0:45), pull request and conflict (1:15), blame and AI summary (1:50), impact and limitations (2:20).
- **Disclosure:** Pre-existing open-source libraries, public court sources, and any configured AI model are disclosed; AI output is educational orientation, not legal advice.

## Status

This repository is being built for LexHack 2026. The current implementation is intentionally incremental; see the local implementation plan for the complete twelve-step roadmap.
