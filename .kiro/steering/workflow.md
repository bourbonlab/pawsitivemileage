---
description: Git branching workflow, Gitea PR process, commit conventions, lint/type-check steps, and deploy pipeline instructions for all environments.
inclusion: auto
---

# Workflow — Commit & Deploy

## Git Branching Workflow

All work happens on feature branches. Never commit directly to `main`.

1. Create a feature branch from `main`:
   ```bash
   git checkout main && git pull origin main
   git checkout -b feat/short-description
   ```
   Branch prefixes: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`

2. Run lint/type checks before committing:
   - `cd web && npm run lint` (frontend)
   - `cd api && npm run lint` (backend)
   - `cd infra && npm run lint` (infrastructure)
   - Note: pre-existing type errors in `api/` are known and acceptable

3. Run tests if they cover changed code: `cd api && npm test`

4. If infra changes were made, run `./deploy.sh` (no args) to synth and catch CDK errors early

5. Commit with conventional commit messages:
   - Format: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:` prefix
   - Summary line under 72 chars, body with bullet points for multi-file changes
   - Example: `feat: add isBusiness field to fillups`

6. Push the branch to origin:
   ```bash
   git push -u origin feat/short-description
   ```

## Pull Requests via Gitea API

The repo is hosted on Gitea at `https://gitea.bourbonlab.net/bourbonlab/PawsitiveMileage`. Auth token is stored in `~/.git-credentials`.

1. Create a PR:
   ```bash
   curl -s -X POST \
     "https://gitea.bourbonlab.net/api/v1/repos/bourbonlab/PawsitiveMileage/pulls" \
     -H "Authorization: token <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"title":"feat: description","head":"feat/branch-name","base":"main"}'
   ```

2. Merge the PR:
   ```bash
   curl -s -X POST \
     "https://gitea.bourbonlab.net/api/v1/repos/bourbonlab/PawsitiveMileage/pulls/<PR_NUMBER>/merge" \
     -H "Authorization: token <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"Do":"merge","delete_branch_after_merge":true}'
   ```

3. Sync local after merge:
   ```bash
   git checkout main
   git pull origin main
   git branch -d feat/short-description
   ```

## Production Deployment

Deploying from a feature branch is acceptable when it's the only active branch. Otherwise, merge to `main` first.

Deploy command: `./deploy.sh --prod --yes`

This is a long-running process (~3-5 minutes). Run it as a background process and monitor output periodically. The pipeline:

1. Prerequisite checks (Node.js 24+, npm, AWS CLI, CDK)
2. AWS credential verification
3. `npm install` in api/, web/, infra/
4. API build (esbuild → api/dist/)
5. API tests (vitest)
6. CDK synth + deploy all 6 stacks
7. Fetch Cognito outputs, build frontend with VITE_* env vars
8. S3 sync frontend assets
9. CloudFront cache invalidation
10. CloudFlare cache purge (if `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` set in `.env`)

Other environments:
- `./deploy.sh --test` — deploy to test
- `./deploy.sh --stage` — deploy to staging
- `./deploy.sh --skip-tests` — skip test suite

Frontend-only changes (no infra/API changes) still require a full deploy since the pipeline rebuilds and syncs the frontend bundle.
