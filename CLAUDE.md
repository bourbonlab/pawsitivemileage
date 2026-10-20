# PawsitiveMileage

Serverless vehicle fuel and maintenance tracker. npm-workspaces monorepo:
- `web/`: React + Vite SPA
- `api/`: Lambda handlers
- `infra/`: AWS CDK
- `cli/`: admin tooling, including the account migration

[README.md](README.md) is the full reference for architecture, API routes and environment variables.

## AWS accounts — read before deploying

| | Account | CLI profile | Domains |
|---|---|---|---|
| **Current** (all environments) | `376784708284` | `pawsitivemileage` | `pawsitivemileage.app`, `staging.pawsitivemileage.app` (+ `api.` / `auth.` variants) |
| Legacy, being retired | `817281265012` (Organization management account) | `bourbonlab-root` | `*.bourbonlab.net` |

- **Never deploy to, or create resources in, the legacy account.** Every stack is pinned to `AWS_ACCOUNT_ID_<ENV>` and `deploy.sh` aborts if the active credentials don't match.
- The production cutover and the legacy teardown follow [docs/account-migration.md](docs/account-migration.md). Until the cutover is locked with `complete`, the old production on bourbonlab.net is live and authoritative.
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

- Deploys take 3–5 minutes; run them in the background.
- A production deploy stops at CDK's IAM approval prompt (`--require-approval broadening`) whenever permissions are added or widened. Answer it in an interactive terminal; never pipe `yes` into it.
- After infra changes, run `./deploy.sh` with no args first, to catch synth errors before deploying.

## Git workflow

- Work on feature branches from `main`, prefixed `feat/`, `fix/`, `refactor/`, `chore/` or `docs/`. Don't commit to `main` unless asked.
- Use conventional commits (`feat: …`, `fix: …`) with the summary under 72 characters, and bullet points in the body for multi-file changes.
- Before committing:
  - lint must be clean
  - tests covering the change must pass
  - include related doc updates in the same commit
- The repo is on Gitea: `https://gitea.bourbonlab.net/bourbonlab/PawsitiveMileage`. Use the `tea` CLI:
  ```bash
  git push -u origin feat/short-description
  tea pr create --title "feat: description" --head feat/short-description --base main
  tea pr merge <index>        # merge style; then delete the branch
  git checkout main && git pull origin main
  ```

## Keep docs in sync

When a change affects project structure, API routes, commands, environment variables, dependencies or other documented behavior, update [README.md](README.md) and the relevant file in [docs/](docs/) in the same change. Skip doc updates for internal-only changes.

## Conventions worth knowing

- **User ID:** the Cognito `sub` (`getUserId` in `api/src/lib/auth.ts`). It appears in DynamoDB keys and GSIs, and as the first segment of photo-bucket keys (`{userId}/{vehicleId}/{type}/{filename}`).
- **Other IDs** are ULIDs. The only UUIDs the app writes are user IDs, and the migration tool relies on this.
- **API responses** are `{ data, requestId }` on success and `{ error, code, requestId }` on failure (`api/src/lib/response.ts`). The web client unwraps `data`.
- **Photos** are served by the frontend CloudFront at `/photos/<key>`. Uploads go straight to S3 through presigned PUT URLs.
- **Secrets** live in `.env` (git-ignored) and Secrets Manager. Never print or commit them.
