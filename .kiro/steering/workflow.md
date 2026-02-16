---
inclusion: auto
---

# Workflow — Commit & Deploy

## After Major Changes

When a set of related changes is complete (feature, bugfix, refactor):

1. Run the relevant lint/type check before committing:
   - `cd web && npm run lint` (frontend)
   - `cd api && npm run lint` (backend)
   - `cd infra && npm run lint` (infrastructure)
2. If infra changes were made, run `./deploy.sh` (no args) to synth and catch CDK errors early
3. Stage and commit with a conventional commit message:
   - Format: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:` prefix
   - Summary line under 72 chars, body with bullet points for multi-file changes
   - Example: `feat: add receipt photo display in fillup edit dialog`
4. If tests exist for the changed code, run them: `cd api && npm test`
5. Push commits to remote: `git push`

## Production Deployment

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
