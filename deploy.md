# Git Court deployment

This project is deployed as three services from the same GitHub repository:

- **Render** runs the backend. It owns the `/api/*` routes, Prisma access, and
  the filesystem-backed Git repositories.
- **Supabase** runs the PostgreSQL database consumed by Prisma.
- **Vercel** runs the frontend. It serves the pages and calls the Render API
  through `NEXT_PUBLIC_API_BASE_URL`.

Deploy the backend first. The frontend needs the backend URL during its build
and runtime, and the backend needs the final frontend URL for CORS.

## 1. Prepare the repository

1. Push the intended deployment commit to the repository's `main` branch.
2. Confirm that `render.yaml`, `vercel.json`, `package.json`, and
   `package-lock.json` are present on `main`.
3. Do not commit `.env`, `.data/`, or API keys. Supabase stores production
   relational data, while Render's persistent disk stores Git repositories.

The deployment commands are already defined in `package.json`:

| Service | Build command                               | Start command          |
| ------- | ------------------------------------------- | ---------------------- |
| Render  | `npm ci && npm run render-build`            | `npm run render-start` |
| Vercel  | `npm ci` followed by `npm run vercel-build` | Managed by Vercel      |

## 2. Initialize Supabase database

Before deploying Render, initialize the Supabase PostgreSQL schema once.

1. Set `DATABASE_URL` locally to your full Supabase Postgres connection string:

```text
postgresql://postgres:<YOUR-PASSWORD>@db.nhvcdnteolcqzwbhkgus.supabase.co:5432/postgres
```

2. Apply the checked-in Prisma migrations:

```bash
npm run db:supabase:init
```

This applies the checked-in PostgreSQL migrations to the Supabase project.
Future production schema changes must be added as Prisma migrations and are
applied automatically by Render during startup. Do not run `supabase.db.sql`
before this command; that legacy SQL snapshot is retained for reference, while
Prisma migrations are the source of truth.

## 3. Deploy the backend on Render

### Create the Render service

1. Sign in to [Render](https://render.com).
2. Select **New → Blueprint**.
3. Connect the `Lanceky/Gitcourt` GitHub repository.
4. Select the `main` branch.
5. Let Render read the repository's `render.yaml`.
6. Review the service before applying it:
   - Service name: `gitcourt-backend`
   - Region: Virginia
   - Plan: `starter`
   - Persistent disk: `gitcourt-data`, mounted at `/var/data`, 1 GB
   - Health check: `/api/health`
7. Apply the Blueprint and wait for the first deploy to finish.

The persistent disk is still required for Git repositories. A Render plan with
a persistent disk is paid; do not switch this service to an ephemeral free
instance if user-created forks and commits must survive restarts.

### Render environment variables

`render.yaml` supplies the non-secret values. In the Render service's
**Environment** tab, set:

| Key                        | Value                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `NODE_ENV`                 | `production`                                                                         |
| `DATABASE_URL`             | `postgresql://postgres:<PASSWORD>@db.nhvcdnteolcqzwbhkgus.supabase.co:5432/postgres` |
| `SUPABASE_URL`             | `https://nhvcdnteolcqzwbhkgus.supabase.co`                                           |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_ZVjCYGUlgZmdIT5yvJ7J-w_lIFdPNMQ`                                     |
| `GIT_REPOSITORIES_PATH`    | `/var/data/repositories`                                                             |
| `AI_SUMMARY_ENABLED`       | `false`                                                                              |
| `AI_SUMMARY_MODEL`         | `configured-model`                                                                   |
| `AI_SUMMARY_TIMEOUT_MS`    | `8000`                                                                               |
| `CORS_ALLOWED_ORIGINS`     | Set after the Vercel URL exists; see below                                           |

The service must also have the persistent disk from the Blueprint attached to
the same Render service that runs `https://gitcourt.onrender.com` (for Git repositories):

| Disk setting | Value            |
| ------------ | ---------------- |
| Mount path   | `/var/data`      |
| Size         | `1 GB` or larger |

The startup script creates the repository parent directory before running
Prisma. It cannot substitute for an attached persistent disk: without that
disk, repository data is ephemeral and may not be writable.

Leave `AI_SUMMARY_API_URL` and `AI_SUMMARY_API_KEY` unset while the guarded AI
provider is disabled. If AI is enabled later, add those values only to Render;
never expose them as `NEXT_PUBLIC_*` variables in Vercel.

### Verify the backend before deploying Vercel

Copy the backend's public URL from Render, for example:

```text
https://gitcourt-backend.onrender.com
```

Check the service in a browser or terminal:

```bash
curl --fail https://gitcourt-backend.onrender.com/api/health
curl --fail https://gitcourt-backend.onrender.com/api/cases/carpenter-v-united-states
```

The health response must contain `"status":"ok"`. The case API response must
contain a non-empty `history` array, normally with 11 seeded public milestones.

If either request fails, fix Render before creating the frontend. A healthy
`/api/health` response now verifies both the Next.js process and the database;
it returns HTTP 503 with `DATABASE_UNAVAILABLE` when the disk, database URL, or
database permissions are wrong. The `render-start` command creates storage
directories, runs `prisma migrate deploy`, runs the idempotent public-case
seed, and then starts Next.js. It fails closed if a migration cannot be
applied, rather than starting against an unknown schema.

## 4. Prepare the frontend on Vercel

### Create the Vercel project

1. Sign in to [Vercel](https://vercel.com).
2. Select **Add New → Project**.
3. Import the same `Lanceky/Gitcourt` repository.
4. Select the `main` branch.
5. Keep the detected framework as **Next.js**.
6. Keep the repository build settings from `vercel.json`:
   - Install command: `npm ci`
   - Build command: `npm run vercel-build`
   - Output: managed by Next.js; do not configure a static export
7. Do not add a separate Render build command to Vercel.

`vercel-build` runs only `next build`. Prisma schema sync, seeding, and Git
repository storage belong to Render/Supabase, not Vercel.

### Vercel environment variables

Add these variables in the Vercel project for **Production** and **Preview**
before the first deployment:

| Key                        | Production value                             | Preview value                        |
| -------------------------- | -------------------------------------------- | ------------------------------------ |
| `NODE_ENV`                 | `production`                                 | `production`                         |
| `NEXT_PUBLIC_APP_URL`      | `https://your-production-project.vercel.app` | The specific preview URL, when known |
| `NEXT_PUBLIC_API_BASE_URL` | Render backend URL                           | The same Render backend URL          |

`NEXT_PUBLIC_API_BASE_URL` must be an origin only:

```text
https://gitcourt-backend.onrender.com
```

Do not append `/api`, a path, query parameters, or a trailing path segment.
The frontend adds `/api/...` itself.

The frontend does not need `DATABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, or `GIT_REPOSITORIES_PATH` when
`NEXT_PUBLIC_API_BASE_URL` points to Render. Do not put `AI_SUMMARY_API_KEY`
or other server-only secrets in Vercel public variables.

Deploy the project and copy its final production URL.

## 5. Connect CORS after Vercel deployment

Return to the Render backend's **Environment** tab and set
`CORS_ALLOWED_ORIGINS` to the exact Vercel origin, without a trailing slash:

```text
https://your-production-project.vercel.app
```

For more than one allowed frontend, separate origins with commas:

```text
https://your-production-project.vercel.app,https://your-preview.vercel.app
```

Save the variable and redeploy the Render service. The API intentionally
allows only explicitly configured origins; do not use `*` for this workflow.

For Vercel preview deployments, add the preview origin to this list before
testing a preview. Preview URLs can change, so update the list when needed.

## 6. Verify the complete deployment

From the repository root, run:

```bash
npm run verify:deployment -- \
  https://your-production-project.vercel.app \
  https://gitcourt-backend.onrender.com
```

The verifier checks:

1. Vercel home page
2. Vercel case page
3. Render health endpoint
4. Render seeded case API

Then perform the browser smoke test:

1. Open the Vercel home page.
2. Open the demo case.
3. Confirm the docket history loads.
4. Open the moot-court workspace.
5. Create a demo fork, branch, and student argument.
6. Open a pull request, approve it, and merge it.
7. Refresh the page and confirm the backend still serves the workflow.

The canonical public case must remain read-only after the workflow.

## 7. Troubleshooting

### Render deploy fails during migration or seed

Check that:

- `DATABASE_URL` uses the Supabase PostgreSQL connection string with the
  correct database password.
- The migration directory is present in the deployed commit and
  `prisma migrate deploy` completes before seeding.
- `GIT_REPOSITORIES_PATH` is exactly `/var/data/repositories`.
- The persistent disk is mounted at `/var/data`.
- The service has completed `npm ci` and `npm run render-build`.
- The service's **Start Command** is `npm run render-start` (or `npm start`,
  which now uses the same startup script).

Do not move `GIT_REPOSITORIES_PATH` to `/tmp`; `/tmp` is not durable.

### Vercel build runs Prisma migration or reports `tsx: command not found`

The Vercel project is using an old commit or an overridden build command.
Confirm that:

- The deployment cloned the current `main` commit.
- The build command is `npm run vercel-build`.
- `vercel-build` is `./node_modules/.bin/next build`.
- Render, not Vercel, is running `render-start`.

### The Vercel case page returns an error

Check `NEXT_PUBLIC_API_BASE_URL` in the Vercel environment and redeploy after
changing it. It must point to the Render origin and must not include `/api`.
Also check the Render `/api/health` endpoint and the Render service logs.

If `/api/health` returns `503` with `DATABASE_UNAVAILABLE`, verify that the
disk is attached to this exact service and that its mount path is `/var/data`,
then verify the Supabase `DATABASE_URL` password is correct.

### Browser requests fail with a CORS error

Set `CORS_ALLOWED_ORIGINS` on Render to the exact browser origin shown in the
error, including `https://` and excluding the trailing slash. Redeploy Render
after saving the variable.

### Forks or commits disappear

Confirm that the Render service still has the persistent disk mounted at
`/var/data` and that both storage environment variables use `/var/data`.
Vercel does not store repository data.

## 8. Deployment limitations

This is a hackathon prototype. Supabase PostgreSQL plus the single Render
instance is suitable for the current demo, but it is not a fully
multi-instance production architecture. A later production version should add
shared object storage for Git data and stronger rate limiting/write
coordination.
