# Resolve

A multi-tenant customer support application built with Next.js, React, TypeScript, Prisma, MySQL, and Better Auth. A single Next.js application on Node.js serves the frontend and backend.

## Features

- Workspace membership with owner, admin, and agent roles; invitation-based enrollment.
- Ticket inbox with pagination, search, assignment, priorities, status transitions, and change history.
- Public replies and internal notes, with customer access restricted to their own tickets and public replies.
- Customer invitations, ticket submission, and ticket viewing.
- Workspace help articles with drafts, publication, stale-edit protection, and ranked MySQL full-text search.
- Server-side workspace permission checks and automated API and browser tests.

This project is complete at its current local-demo scope. AI assistance, email notifications, and deployment support are not included. Protected application APIs intentionally require a loopback MySQL connection to `resolve_dev` outside production mode. Invitations are shared manually; no email is sent.

## Local setup

Requirements: Node.js 24, npm 11, and MySQL 8.0. Google Chrome is required for the browser tests.

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/adityavit337/Resolve.git
   cd Resolve
   npm ci
   ```

2. Create a local MySQL database named `resolve_dev` and configure a local database account with access to it. For example, use a MySQL administrator to create the database:

   ```sql
   CREATE DATABASE resolve_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

3. Copy `apps/web/.env.example` to `apps/web/.env`. Set `DATABASE_URL` to your local account and database, percent-encoding special characters in the URL password. Set a random `BETTER_AUTH_SECRET` of at least 32 characters, keep `BETTER_AUTH_URL=http://127.0.0.1:3000`, and choose a local `DEV_SEED_PASSWORD` of 12–128 characters. The optional `SHADOW_DATABASE_URL` points to a separate disposable database used when authoring migrations with `prisma migrate dev`; it is not required for applying existing migrations with `db:deploy`. Never commit `.env`.

4. Apply migrations, generate the database client, provision demo accounts, and start the app:

   ```sh
   npm run db:deploy --workspace=@resolve/web
   npm run db:generate --workspace=@resolve/web
   npm run db:seed --workspace=@resolve/web
   npm run db:seed-auth --workspace=@resolve/web
   npm run dev
   ```

Open <http://127.0.0.1:3000/sign-in> and sign in as `alice@example.test` with the `DEV_SEED_PASSWORD` you configured. Auth seeding preserves existing credentials on repeated runs. On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`.

## Local background worker

The initial background task is an infrastructure check with no customer data. It runs independently of the web server. Docker Desktop must be running to use the supplied Redis service; MySQL remains the application database.

From the repository root, start Redis:

```sh
docker compose -f compose.redis.yaml up -d --wait
```

Set `REDIS_URL=redis://127.0.0.1:6379/0` in `apps/web/.env`. `BULLMQ_PREFIX` defaults to `resolve-local`; the producer, status command, and worker must use the same prefix and Redis database. Queue commands are restricted to local Redis outside production mode.

Submit a job before starting the worker:

```sh
npm run queue:add --workspace=@resolve/web
npm run queue:status --workspace=@resolve/web -- JOB_ID
```

Replace `JOB_ID` with the returned ID. It stays `waiting` until a worker runs. Start the worker in a separate terminal:

```sh
npm run worker --workspace=@resolve/web
```

Run the status command again to see `completed` and its receipt. Stop the worker with Ctrl+C. The latest 100 completed and 100 failed jobs are retained, with older records removed as jobs finish. There is no web endpoint for these infrastructure commands.

To exercise retry handling, use an operation key and a diagnostic mode:

```sh
npm run queue:add --workspace=@resolve/web -- retry-demo transient
npm run queue:status --workspace=@resolve/web -- check-retry-demo
npm run queue:add --workspace=@resolve/web -- failure-demo always-fail
npm run queue:failed --workspace=@resolve/web
```

`success` is the default mode. `transient` fails once and then succeeds; `always-fail` exhausts three total attempts. Retries use exponential backoff starting at one second. Status includes attempt counts, the last failure, timing metadata, and the result. The failed command lists up to 20 retained failures.

Reusing an operation key returns the same retained job without replacing its data or restarting it. Use a new key for a new diagnostic run. This protection ends when the job is removed. The check processor is side-effect-free and returns a stable receipt on re-execution; this is not an exactly-once guarantee for future email delivery or database writes.

The Compose service publishes Redis on loopback only and stores its append-only data in a Docker volume. Stop it with `docker compose -f compose.redis.yaml stop`; starting it again reuses that volume. This is a local Redis setup, not containerization of the application.

## Verification

Type checking and production compilation:

```sh
npm run typecheck
npm run build
```

A successful build verifies compilation; it does not remove the application's local-development API restrictions.

With the development server running and the local database configured, run API suites individually:

```sh
npm run test:auth --workspace=@resolve/web
npm run test:workspaces --workspace=@resolve/web
npm run test:invitations --workspace=@resolve/web
npm run test:tickets --workspace=@resolve/web
npm run test:customers --workspace=@resolve/web
npm run test:articles --workspace=@resolve/web
```

With local Redis running, the queue test needs neither the web server nor MySQL:

```sh
npm run test:queue --workspace=@resolve/web
```

It uses a unique queue prefix, starts and stops a worker process, and removes only its own Redis fixtures.

Run browser journeys with Chrome installed:

```sh
npm run test:e2e --workspace=@resolve/web
```

Tests use the local development database and create temporary fixtures. Run suites sequentially. Article tests also print example search results and the full-text query plan.

## Structure

- `apps/web/app`: pages, UI components, and API Route Handlers.
- `apps/web/lib`: authentication, permissions, validation, and database operations.
- `apps/web/prisma`: schema, migrations, and development seeds.
- `apps/web/scripts`: API tests and database inspection scripts.
- `apps/web/e2e`: browser tests.
