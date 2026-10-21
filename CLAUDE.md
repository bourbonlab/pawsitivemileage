# PawsitiveMileage

Serverless vehicle fuel and maintenance tracker. npm-workspaces monorepo:
- `web/`: React + Vite SPA
- `api/`: Lambda handlers
- `infra/`: AWS CDK
- `cli/`: admin tooling, including the account migration
- `pm/`: `pm`, the user-facing command line on the SDK (PKCE sign-in, fill-ups, maintenance, exports)
- `packages/sdk/`: typed TypeScript client built from the contract: `createClient({ baseUrl, getToken })`, one method per operation
- `packages/contracts/`: the API contract (zod schemas + route table), the single source of truth for requests and responses. See [docs/api-contract.md](docs/api-contract.md). When you change an endpoint:
  - update its contract
  - regenerate the OpenAPI document with `npm run openapi -w @pawsitivemileage/contracts`
  - run `npm test -w @pawsitivemileage/contracts`. Its tests fail if the route table and `api-stack.ts` disagree, or if the committed `packages/contracts/openapi.json` is stale.

[README.md](README.md) is the full reference for architecture, API routes and environment variables.

## AWS accounts — read before deploying

| | Account | CLI profile | Domains |
|---|---|---|---|
| **Current** (all environments) | `376784708284` | `pawsitivemileage` | `pawsitivemileage.app`, `staging.pawsitivemileage.app` (+ `api.` / `auth.` variants) |
| Legacy, frozen since the cutover | `817281265012` (Organization management account) | `bourbonlab-root` | `*.bourbonlab.net` (redirects to `pawsitivemileage.app`) |

- **Never deploy to, or create resources in, the legacy account.** Every stack is pinned to `AWS_ACCOUNT_ID_<ENV>` and `deploy.sh` aborts if the active credentials don't match.
- **Production was cut over and locked on 2026-10-21.** The new account is the source of truth. The old app is frozen, and `pawsitivemileage.bourbonlab.net` returns a 301 to `pawsitivemileage.app` at CloudFlare. `migrate` refuses to run against production while the lock is set. Never delete the lock parameter: re-running the mirror would wipe real data.
- Legacy teardown follows [docs/account-migration.md](docs/account-migration.md#teardown-about-30-days-after-cutover), not before 2026-11-20.
- All stacks run in `us-east-1`. Certificates must be in us-east-1.

## Commands

```bash
npm test                              # all workspaces (api, web, cli, infra)
npm run lint --workspaces --if-present  # tsc --noEmit per workspace; must be clean
npm run audit                         # npm audit --audit-level=high
./deploy.sh                           # install, build, test, CDK synth (staging) — no deploy
./deploy.sh --stage                   # deploy staging
./deploy.sh --prod --yes              # deploy production
```

- **Merging to `main` deploys.** GitHub Actions deploys staging on every push to `main`, then production after approval in the `production` environment ([docs/ci-cd.md](docs/ci-cd.md)). PRs run lint, tests, build and synth. Local `./deploy.sh --stage` / `--prod` still work.
- **Standard flow: push, open the PR and merge it** once lint and tests pass locally and the PR checks are green; no separate go-ahead is needed. Staging is where post-merge issues get caught; fix them in a follow-up PR. Production approval in GitHub is the user's step, never Claude's.
- Deploys take 3–5 minutes; run them in the background. A deploy only changes what differs from what's deployed ([docs/ci-cd.md#what-a-deploy-changes](docs/ci-cd.md#what-a-deploy-changes)); keep the builds deterministic so that keeps working.
- Deploys run without an interactive IAM approval prompt (`--require-approval never`), because the account is dedicated to this app. So **review IAM changes in the PR**: for changes to `infra/`, check `cdk diff --security-only` before deploying to production (security finding F-12, accepted risk).
- After infra changes, run `./deploy.sh` with no args first, to catch synth errors before deploying.
- The GitHub deploy roles (`infra/lib/stacks/github-access-stack.ts`) are a separate CDK app, deployed by hand, never by CI. After changing `.env`, re-run `./setup-github.sh` so the GitHub environments match.

## Git workflow

- Work on feature branches from `main`, prefixed `feat/`, `fix/`, `refactor/`, `chore/` or `docs/`. Don't commit to `main` unless asked.
- Use conventional commits (`feat: …`, `fix: …`) with the summary under 72 characters, and bullet points in the body for multi-file changes.
- **PR titles set the release version** (a check enforces the format): the title becomes the merge commit, and each merge to `main` is released as the next semver (docs-only merges don't deploy and ship with the next release): `feat` → minor, `type!:` or `BREAKING CHANGE:` → major, anything else → patch ([docs/ci-cd.md#versioning](docs/ci-cd.md#versioning)).
- Before committing:
  - lint must be clean
  - tests covering the change must pass
  - include related doc updates in the same commit
- The repo is on GitHub: `https://github.com/bourbonlab/pawsitivemileage` (public). Use the `gh` CLI:
  ```bash
  git push -u origin feat/short-description
  gh pr create --title "feat: description" --head feat/short-description --base main
  gh pr merge <number> --merge --delete-branch
  git checkout main && git pull origin main
  ```
- History before the move (PRs #1–#27, closed issues) stays on the old Gitea repo, `https://gitea.bourbonlab.net/bourbonlab/PawsitiveMileage`. `#N` references in older commit messages point there, not at GitHub. Commit SHAs differ from Gitea's, because the repo was converted from SHA-256 to SHA-1 for GitHub.

## Keep docs in sync

When a change affects project structure, API routes, commands, environment variables, dependencies or other documented behavior, update [README.md](README.md) and the relevant file in [docs/](docs/) in the same change. Skip doc updates for internal-only changes.

## Conventions worth knowing

- **User ID:** the Cognito `sub` (`getUserId` in `api/src/lib/auth.ts`). It appears in DynamoDB keys and GSIs, and as the first segment of photo-bucket keys (`{ownerUserId}/{vehicleId}/{uploadType}/{ulid}-{filename}`; older keys lack the ULID). Files are always stored under the **vehicle owner's** ID, even when a shared user uploads them. Validate submitted keys against `ownerUserId` with `photoKeyFieldError` (`api/src/lib/s3.ts`).
- **Other IDs** are ULIDs. The only UUIDs the app writes are user IDs, and the migration tool relies on this.
- **Request validation:** handlers call `validate(Schema, body)` from `api/src/lib/contract.ts`, using the schema from `@pawsitivemileage/contracts`. Put new field rules in the contract, not in the handler.
- **zod imports:** use `import * as z from 'zod'`, never `import { z }`. The named import stops esbuild tree-shaking and bundles all of zod's locales, about 350 KB per Lambda.
- **API responses** are `{ data, requestId }` on success and `{ error, code, requestId }` on failure (`api/src/lib/response.ts`). The web client unwraps `data`.
- **Photos** are served by the frontend CloudFront at `/photos/<key>`. Uploads go straight to S3 through presigned PUT URLs.
- **Secrets** live in `.env` (git-ignored) and Secrets Manager. Never print or commit them.
