# CI/CD with GitHub Actions

Pull requests are tested automatically. Every push to `main` deploys staging, then production after approval, unless it only changes docs. Both deploys run [`deploy.sh`](../deploy.sh), the same script used for local deploys, and a deploy only changes what is different from what's already deployed ([What a deploy changes](#what-a-deploy-changes)).

## Workflows

| Workflow | Trigger | What it does | AWS access |
|---|---|---|---|
| [`pr-title.yml`](../.github/workflows/pr-title.yml) | PR opened, edited or updated | Fails unless the PR title is a conventional commit; the job summary shows the version merging will release, or that the PR is docs-only | None |
| [`ci.yml`](../.github/workflows/ci.yml) | Every pull request; first stage of Deploy | `npm ci`, lint, all tests, build, `cdk synth` of staging, production and the GitHub access app (placeholder values); `npm audit` as a separate job | None |
| [`deploy.yml`](../.github/workflows/deploy.yml) | Push to `main` that changes more than docs; manual run | CI → version → **staging** → **production** (waits for approval) → mark release Latest | Per environment, via OIDC |
| [`deploy-environment.yml`](../.github/workflows/deploy-environment.yml) | Called by `deploy.yml` | `./deploy.sh --stage --skip-tests` or `--prod --yes --skip-tests` | The environment's deploy role |
| [`android.yml`](../.github/workflows/android.yml) | PRs and pushes to `main` touching `android/` or `openapi.json` | JDK 17: unit tests, lint, staging debug and production release builds; the staging APK is uploaded as an artifact | None |

- **Production approval:** after staging succeeds, the production job waits on the run page (or in the GitHub notification) until a reviewer of the `production` environment approves it. If it isn't approved within 30 days, the job is cancelled. If more pushes reach `main` before approval, only the newest pending production deploy is kept.
- **Docs-only pushes** don't run Deploy: a push that only changes `*.md` files, `docs/`, `LICENSE` or `.claude/` (`paths-ignore` in `deploy.yml`, mirrored by the docs-only check in `pr-title.yml`). They get no version of their own and ship with the next release.
- **Android-only pushes** (`android/`, `android.yml`) don't run Deploy either; the Android workflow builds them, and the app ships through Google Play.
- **Manual run:** Actions → Deploy → Run workflow, from `main`, choosing `staging` or `production`. A manual production run skips staging but still needs approval.
- **Failures:** a failed CI stage deploys nothing. If staging fails, production doesn't run. Deploys of the same environment never run in parallel.
- **`npm audit`:** a separate check, so a newly published advisory flags the PR without blocking tests.

## What a deploy changes

`deploy.sh` builds everything on every run, but only changes what differs from what's deployed. The comparison is by content, not by git diff, so it also catches changes that aren't in git (GitHub environment variables) and is right however many merges a production deploy covers.

| Part | How it decides | Unchanged | Changed |
|---|---|---|---|
| CDK stacks | CDK compares each synthesized template and its assets (Lambda bundles) with the deployed stack | Skipped (`no changes`), about a second each | Updated; stacks without a dependency between them deploy in parallel (`--concurrency 3`) |
| Frontend files | MD5 of each file in `web/dist/` against the S3 object's ETag | Nothing uploaded, no cache purge | Only changed files are uploaded, `index.html` last; removed files are deleted after it |
| Caches | Which files changed | No purge | `index.html` changed: full CloudFront invalidation and Cloudflare purge, because CloudFront serves `index.html` for every app route. Only other fixed-name files changed (e.g. `version.json`): those URLs only. Files under `assets/` have content-hashed names and never need purging |

- **Release version:** the footer reads it from `/version.json` at runtime, so a release that doesn't touch `web/` leaves the JS bundle byte-for-byte unchanged. Its deploy uploads and purges `version.json` only.
- **CDK version reporting is off** (`"versionReporting": false` in `infra/cdk.json`). It recorded the exact Node.js version of the synth in every template, which made every stack redeploy whenever the runner's Node patch version changed.
- **Deterministic builds** are what make this work: esbuild (Lambda bundles) and Vite (frontend) produce identical bytes from identical inputs. Something that embeds a timestamp or build ID in either would make every deploy look like a change again.
- **`--clear-cache`** still purges everything, without building or deploying.

## Versioning

Every push to `main` that deploys is a release, following [semantic versioning](https://semver.org). The **Version** job of `deploy.yml` runs [`cli/src/release/version.ts`](../cli/src/release/version.ts) over the commits since the last `vX.Y.Z` tag and takes the largest bump:

| Commit (or PR title, for merge commits) | Bump |
|---|---|
| `type!: …`, or a `BREAKING CHANGE: …` footer | major |
| `feat: …` | minor |
| anything else (`fix`, `perf`, `chore`, `docs`, …, or not conventional) | patch |

Every deploying merge gets a version, so even a `chore:` merge gets a patch release; every deployed build has its own version. Docs-only merges don't deploy, so their commits are counted in the next release instead. The first release is `v1.0.0`.

1. **On the PR:** the *PR title and version* check fails unless the title is a conventional commit. GitHub writes the PR title into the merge commit, so the title decides the bump. Its summary shows the version merging would produce, for example *Merging this PR releases v1.3.0 (minor bump from v1.2.4)*, or *Docs-only: merging does not deploy or release*.
2. **On merge:** the Version job creates the tag and a GitHub **pre-release** with generated notes, then staging and production deploy with `APP_VERSION=vX.Y.Z`. `deploy.sh` writes it to `version.json` next to the frontend build, and the app footer shows it, linked to its release.
3. **After production deploys:** the release is marked **Latest**, so *Latest* on the Releases page is what is in production.

- **Re-runs:** re-running a run never creates a second version, because a commit that already has a tag keeps it. Version jobs run one at a time, so quick successive merges get consecutive versions.
- **Failed deploys:** if staging or production fails, the tag and pre-release stay. The next merge releases the next version, which includes those changes.
- **Manual runs** (Run workflow) don't create versions. They deploy the latest tag on that commit, or a `git describe` label such as `v1.2.0-1-gabc1234` if the commit is untagged.
- **Local deploys** (`./deploy.sh --stage`) show `git describe` output, for example `v1.2.0-3-gabc1234-dirty`.
- **Squash or rebase merges:** these work too. A squash commit's subject is the PR title.
- **`package.json` versions** aren't used. The git tags are the source of truth.

Check what the next version would be locally:

```bash
git fetch --tags && node cli/src/release/version.ts next
```

## How GitHub reaches AWS

There are no long-lived AWS keys in GitHub. Deploy jobs get short-lived credentials through GitHub's OIDC provider:

1. A deploy job runs in the GitHub environment `staging` or `production`. Each environment only accepts runs from `main`.
2. GitHub issues the job an OIDC token whose subject is `repo:bourbonlab@179869454/pawsitivemileage@1427729468:environment:<env>`. The repo uses GitHub's immutable subject format, with owner and repo IDs, so a deleted and recreated repo of the same name can't match. If GitHub's subject format or the repo ID ever changes, update `githubRepo` in [`bin/github-access.ts`](../infra/bin/github-access.ts) and redeploy (see Troubleshooting).
3. [`configure-aws-credentials`](https://github.com/aws-actions/configure-aws-credentials) exchanges it for the role `pawsitivemileage-app-github-deploy-<env>`, whose trust policy accepts only that exact subject. It also refuses to continue if the credentials are for any account other than `AWS_ACCOUNT_ID`.
4. `deploy.sh` runs `cdk deploy` through the CDK bootstrap roles, then syncs the frontend and invalidates caches.

Pull requests, including ones from forks, run no job in either environment, so they can't obtain AWS credentials.

**Each deploy role is effectively account admin.** It can assume the CDK bootstrap roles, and CloudFormation runs with the bootstrap execution role (AdministratorAccess, the CDK default). The staging role could therefore change production stacks. What separates the environments is GitHub's environment rules (branch restriction, production reviewers), not IAM. This is acceptable because the account `376784708284` holds only this app (see [security.md F-12](security.md#f-12----require-approval-never-in-deploy-script-low)).

The OIDC provider and roles live in their own stack, `PawsitiveMileage-GitHubAccess` ([`github-access-stack.ts`](../infra/lib/stacks/github-access-stack.ts), app [`bin/github-access.ts`](../infra/bin/github-access.ts)). It is deployed by hand, never by the workflow, so CI can't change its own permissions.

## Configuration

Each GitHub environment holds the values `deploy.sh` would otherwise read from `.env`. Per-environment values drop their `_STAGING` / `_PRODUCTION` suffix; `deploy.sh` falls back to the unsuffixed name.

| Kind | Name |
|---|---|
| Variable | `AWS_DEPLOY_ROLE_ARN` (from the GitHubAccess stack outputs) |
| Variable, per environment | `AWS_ACCOUNT_ID`, `FRONTEND_DOMAIN`, `API_DOMAIN`, `AUTH_DOMAIN`, `GOOGLE_CLIENT_SECRET_ARN` |
| Variable, same in both | `GOOGLE_CLIENT_ID`, `ACM_CERTIFICATE_ARN`, `RESOURCE_PREFIX`, `SOURCE_CODE_URL`, `SUPPORT_EMAIL`, `CLOUDFLARE_ZONE_ID` |
| Secret | `CLOUDFLARE_API_TOKEN` |

[`setup-github.sh`](../setup-github.sh) copies these from `.env`. **Re-run it whenever `.env` changes**, for example after the production cutover changes domains.

## One-time setup

Run from the repo root with admin credentials for `376784708284` (the `pawsitivemileage` profile) and an authenticated `gh`:

```bash
# 1. Review, then deploy the OIDC provider and deploy roles
export AWS_PROFILE=pawsitivemileage
CTX="-c account=376784708284 -c resourcePrefix=pawsitivemileage-app"
(cd infra && npx cdk diff --security-only --app "npx tsx bin/github-access.ts" $CTX)
npm run deploy:github-access -w infra -- $CTX

# 2. Create the GitHub environments (main only; production requires your approval),
#    then copy variables and the Cloudflare secret from .env
./setup-github.sh
```

### Changing the deploy roles

Edit `github-access-stack.ts` (its tests are in [`infra/test/github-access.test.ts`](../infra/test/github-access.test.ts)), review `cdk diff --security-only`, and redeploy it by hand as in step 1. The stack has termination protection. Deleting it keeps the OIDC provider, which is retained.

### Revoking access

To stop GitHub deploys immediately, including sessions already running, attach a deny-all policy to each role:

```bash
for env in staging production; do
  aws iam put-role-policy --role-name "pawsitivemileage-app-github-deploy-$env" --policy-name DenyAll \
    --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":"*","Resource":"*"}]}'
done
```

Remove it with `aws iam delete-role-policy --role-name … --policy-name DenyAll`. To pause deploys without touching AWS, disable the workflow (Actions → Deploy → ⋯ → Disable workflow).

## Troubleshooting

**`Not authorized to perform sts:AssumeRoleWithWebIdentity`**: the token's subject doesn't match the role's trust policy. Compare the subject GitHub sent (CloudTrail records it on the failed call) with the trust policy:

```bash
aws cloudtrail lookup-events --region us-east-1 --max-results 1 \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --query 'Events[].CloudTrailEvent' --output text | jq -r .userIdentity.userName
aws iam get-role --role-name pawsitivemileage-app-github-deploy-staging \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition'
gh api repos/bourbonlab/pawsitivemileage/actions/oidc/customization/sub
```
