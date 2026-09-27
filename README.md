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
npm run db:generate
npm run db:supabase:init
npm run db:seed
npm run dev
```

Use a non-production Supabase database for local development and set its
PostgreSQL connection string as `DATABASE_URL` in `.env`. Open
`http://localhost:3000` after the development server starts. Migrations and
the seed are safe to rerun; they preserve the single public fixture without
duplicating its docket entries.

`db:supabase:init` applies the checked-in Prisma migrations to the Supabase
PostgreSQL project. Prisma migrations are the schema source of truth; do not
apply the legacy `supabase.db.sql` snapshot first.

## Current foundation

The application uses Next.js, React, and TypeScript with Prisma on PostgreSQL (Supabase) for metadata persistence. A filesystem-backed `isomorphic-git` adapter stores the case repositories separately.

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

## Deployment: Vercel frontend + Render API + Supabase PostgreSQL

The deployment has three distinct roles:

- **Vercel** serves the Next.js pages.
- **Render** runs the Next.js API routes and the filesystem-backed Git adapter.
- **Supabase PostgreSQL** is the persistent relational database accessed by
  Prisma from the Render API.

Vercel must call the Render API; it must not attempt to use local filesystem
storage or connect directly to Prisma. Set `NEXT_PUBLIC_API_BASE_URL` in
Vercel's Production and Preview environments to the Render service origin.
The Vercel build fails with an actionable error if this value is missing.
Set `CORS_ALLOWED_ORIGINS` in Render to the exact Vercel production origin
(and any Preview origins you intend to test).

The Render service needs a paid plan with a persistent disk because Render's
Free instances do not support disks. The Blueprint mounts `gitcourt-data` at
`/var/data`; Git repositories are stored under
`/var/data/repositories`. Supabase stores relational records, not Git object
files.

### Configure Supabase and Render

1. In Supabase, copy the PostgreSQL connection string and set it as `DATABASE_URL`
   in the Render web service's Environment settings. Keep the password private.
2. Create or update the Render web service from `render.yaml`. Use a plan that
   supports persistent disks, and attach a 1 GB or larger disk at exactly
   `/var/data`. The existing Free service must be upgraded before a disk can
   be attached.
3. Set `CORS_ALLOWED_ORIGINS` in Render to the Vercel production origin, for
   example `https://your-project.vercel.app`.
4. Deploy the latest `main` commit. Render runs `prisma migrate deploy`, seeds
   the public case idempotently, then starts the API.
5. Verify `https://<render-service>.onrender.com/api/health` returns
   `{"status":"ok"}` and the case API returns a non-empty `history`.

Do not add Supabase publishable or service-role keys to Vercel. The current
application uses Prisma over the private PostgreSQL connection on Render; it
does not call Supabase's browser APIs.

### Configure Vercel

1. Import the same GitHub repository into Vercel with the Next.js framework.
2. Keep `npm ci` as the install command and `npm run vercel-build` as the
   build command. Vercel does not run migrations or seeds.
3. Before deploying, set this environment variable for both **Production**
   and **Preview**:

   ```text
   NEXT_PUBLIC_API_BASE_URL=https://<render-service>.onrender.com
   ```

   Use the Render service origin only: no `/api` path or trailing slash.
   This public URL is embedded in the client bundle, so redeploy Vercel after
   changing it.

4. Add the final Vercel production origin to Render's
   `CORS_ALLOWED_ORIGINS`, then redeploy Render if you changed the value.

Verify both hosts:

```bash
npm run verify:deployment -- \
  https://your-project.vercel.app \
  https://<render-service>.onrender.com
```

Vercel hosts the user-facing app, while API requests, Supabase database
connections, and Git operations remain on Render. A future fully serverless
deployment needs to replace filesystem Git storage with durable shared storage.
Attach the supplied **`.xyz` domain** to Vercel only after both URLs pass
verification.

## Devpost submission package

- **Project:** Git Court — a public-record learning workspace for court cases.
- **Summary:** Fork a real public case, explore a what-if argument, and make every change reviewable.
- **Problem:** Public court histories are difficult to follow and unsafe to alter for learning.
- **Solution:** Source-linked case repositories, isolated moot-court forks, legal-theory branches, reviewable pull requests, conflict explanations, blame, audit events, and guarded AI summaries.
- **Tech stack:** Next.js, React, TypeScript, Prisma, PostgreSQL (Supabase), `isomorphic-git`, Zod, and an optional OpenAI-compatible summary provider.
- **Source attribution:** Carpenter v. United States, No. 16-402, from the public Supreme Court docket and opinion sources listed in the application.
- **Demo sequence:** Problem (0:00), public history (0:20), fork and alternate argument (0:45), pull request and conflict (1:15), blame and AI summary (1:50), impact and limitations (2:20).
- **Disclosure:** Pre-existing open-source libraries, public court sources, and any configured AI model are disclosed; AI output is educational orientation, not legal advice.

## Status

This repository is being built for LexHack 2026. The current implementation is intentionally incremental; see the local implementation plan for the complete twelve-step roadmap.
