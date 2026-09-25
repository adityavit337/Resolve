# Resolve

A multi-tenant customer support application built with Next.js, React, TypeScript, Prisma, MySQL, and Better Auth. A single Next.js application on Node.js serves the frontend and backend.

## Features

- Workspace membership with owner, admin, and agent roles; invitation-based enrollment.
- Ticket inbox with pagination, search, assignment, priorities, status transitions, and change history.
- Public replies and internal notes, with customer access restricted to their own tickets and public replies.
- Customer invitations, ticket submission, and ticket viewing.
- Workspace help articles with drafts, publication, stale-edit protection, and ranked MySQL full-text search.
- Server-side workspace permission checks and automated API and browser tests.

AI assistance is planned but is not implemented. The current application runs locally: protected application APIs intentionally require a loopback MySQL connection to `resolve_dev` outside production mode. Invitations are shared manually; no email is sent. Deployment support is not yet implemented.

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
