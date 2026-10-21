# Account Migration Runbook

Moves PawsitiveMileage from the legacy AWS account (`817281265012`, the Organization management account, `*.bourbonlab.net`) to its dedicated account (`376784708284`, `pawsitivemileage.app`).

The tool is [cli/src/migrate-account.ts](../cli/src/migrate-account.ts). It is built to be run repeatedly: rehearse on staging, rehearse on production while the old app stays live, then run once more during a short outage for the real cutover.

## What a run does

1. **Checks accounts.** Both profiles must resolve to the expected account IDs.
2. **Validates source data.** Every user-ID field (`userId`, `ownerUserId`, Fillups/Maintenance `GSI1PK`, photo-key owner segments) must belong to a user in the source pool. Orphaned data aborts the run before anything is written.
3. **Users.** For each Google user in the old pool, finds or creates a user in the new pool and links their Google identity to it. Their next Google sign-in lands in that user, so the new Cognito `sub` is known before any data moves.
   - If someone signed in to the new pool *before* their identity was linked, the separate `Google_<id>` user that sign-in created is removed so the link can be made.
4. **Tables.** Copies all six tables with old subs rewritten to new subs. A UUID that isn't a known sub, such as one in a photo filename, is left unchanged.
5. **Photos.** Copies photos to their remapped keys. Unchanged photos are skipped on re-runs.
6. **Mirror.** Deletes target items and photos that didn't come from the source, such as data created while testing a rehearsal. After every run, the target is an exact copy of the source.
7. **Verify.** Compares every item and photo in both accounts, and checks that every user is linked. The exit code is `2` on any difference.

The source account is only read, except by `freeze`/`unfreeze`. The user mapping (old sub → new sub, with emails) is written to `~/.pawsitivemileage-migration/<env>-user-map.json` (mode 600); it is not committed.

## Commands

Run from `cli/`. The defaults match the profiles and accounts above.

```bash
npx tsx src/migrate-account.ts migrate  --env staging --dry-run          # plan only, no writes
npx tsx src/migrate-account.ts migrate  --env staging                    # migrate + verify
npx tsx src/migrate-account.ts verify   --env staging                    # compare only
npx tsx src/migrate-account.ts freeze   --env production --yes           # old Lambdas → reserved concurrency 0
npx tsx src/migrate-account.ts migrate  --env production --final --yes   # refuses unless the source is frozen
npx tsx src/migrate-account.ts complete --env production --yes           # lock: migrate refuses from now on
npx tsx src/migrate-account.ts unfreeze --env production --yes           # roll back the freeze
```

Functional parity check, also from `cli/`. It invokes the API Lambdas directly as each migrated user:

```bash
npx tsx src/parity-check.ts --env staging                # read parity (old vs new) + write smoke tests (new only)
npx tsx src/parity-check.ts --env staging --skip-writes  # read parity only
```

It calls every read endpoint in both accounts and requires identical responses once old user IDs are swapped for new ones. These include profile, vehicles, fill-ups, maintenance, reminders, analytics, sharing and admin.

The write tests run in the new account only:
- create, update and delete records
- share and unshare
- presign, upload, and fetch through the site
- exports, summary card and recalculate

Re-run `migrate` afterwards to undo them. Because it invokes the old Lambdas, it only works while the source is **not** frozen, so use it in rehearsals.

`--yes` is required for any command that writes to production. `complete` sets the SSM parameter `/pawsitivemileage/<env>/migration/cutover-complete` in the new account. While it exists, `migrate` refuses to run, because the target is live and mirroring would wipe real data. To re-open a migration deliberately, delete the parameter.

---

## Phase 1 — Staging

Staging is a single-user rehearsal environment, so it has no formal cutover: no freeze, `--final` or `complete`, and no redirect. The new staging is used from now on, and the old staging is removed in [Teardown](#teardown-about-30-days-after-cutover).

1. `./deploy.sh --stage`: the new staging environment is already deployed.
2. `migrate --env staging --dry-run`, then review the plan.
3. `migrate --env staging`. The run ends with **Verify passed**.
4. Sign in at https://staging.pawsitivemileage.app with a migrated Google account. Check:
   - vehicles, fill-ups, maintenance, analytics totals and photos
   - shared vehicles
   - one create, edit and delete
   - a photo upload and an export
5. `npx tsx src/parity-check.ts --env staging`. All read endpoints match the old account, and the write smoke tests pass.
6. Run `migrate --env staging` again. The test edits from steps 4–5 are reverted, and verify passes. This proves re-runs are safe.
7. Optionally, `parity-check --skip-writes` should now pass cleanly.

## Phase 2 — Production rehearsal (old app stays live)

1. Deploy prod to the new account: `./deploy.sh --prod --yes`.
2. **DNS** (pawsitivemileage.app zone). Create the CNAMEs `deploy.sh` prints:
   - `api` → API Gateway, proxied
   - `auth` → Cognito CloudFront, **DNS-only**
   - apex → CloudFront, proxied. This replaces the `192.0.2.1` placeholder A record.

   Users keep using `pawsitivemileage.bourbonlab.net` until cutover, so pointing the apex now is safe.
3. `migrate --env production --dry-run`, then `migrate --env production --yes`.
4. `npx tsx src/parity-check.ts --env production`, then test on https://pawsitivemileage.app the same way as staging.
   - **Anything changed here is discarded at cutover.** Tell testers.
5. Repeat whenever you like. Each run brings the rehearsal copy back in line with live production.

## Phase 3 — Final cutover (outage, about 30 minutes)

### Pre-cutover checklist
Last full preflight: 2026-10-21.

- [ ] **Lambda concurrency quota is at least 1000 in us-east-1** (`aws lambda get-account-settings --region us-east-1`). The quota is per region; on 2026-10-21 it was 1000 in us-east-2 but still 10 in us-east-1.
- [x] Google sign-in on https://pawsitivemileage.app lands on the migrated garage (confirmed 2026-10-21).
- [x] `migrate --env production --dry-run` shows no unexpected deletes, and `verify` passes.
- [x] `parity-check --env production --skip-writes` passes, while the old Lambdas are still live.
- [x] The cutover redirect rule exists, **disabled**, on bourbonlab.net (*"PawsitiveMileage cutover: old frontend → pawsitivemileage.app"*).
- [x] `www.pawsitivemileage.app` returns 301 to the apex: an always-on Single Redirect on the pawsitivemileage.app zone, with an `AAAA 100::` proxied placeholder record.
- [ ] Production user pool deletion protection is `ACTIVE`. This becomes true once the PR enabling it deploys to production; check with `aws cognito-idp describe-user-pool … --query UserPool.DeletionProtection`.
- [ ] **No merges to `main` during the window.** Every push to `main` deploys staging, then production (behind GitHub approval). Code deploys don't touch data, but don't approve one mid-cutover.

Tell users ahead of time. On the day:

| # | Step | Command / action |
|---|------|------------------|
| 1 | Freeze the old app. Its API now fails every call. | `freeze --env production --yes` |
| 2 | Final migration | `migrate --env production --final --yes` → **Verify passed**. It compares every item, photo and user link. `parity-check` can't run now, because it needs the old Lambdas. |
| 3 | Smoke test on https://pawsitivemileage.app | sign-in, data spot-checks, one write |
| 4 | Redirect the old site | **Enable** the pre-created rule. In CloudFlare, go to bourbonlab.net → Rules → Redirect Rules → *"PawsitiveMileage cutover: old frontend → pawsitivemileage.app"*. It matches `http.host eq "pawsitivemileage.bourbonlab.net"` and sends a 301 to `concat("https://pawsitivemileage.app", http.request.uri.path)`, keeping the query string. It answers at CloudFlare's edge and never reaches the old AWS resources. Check it with `curl -I https://pawsitivemileage.bourbonlab.net/garage`, which should return a 301 to `https://pawsitivemileage.app/garage`. |
| 5 | **Go / no-go** | |
| 6 | Lock the target | `complete --env production --yes` |

**Rollback before step 6:** disable the redirect rule again, then `unfreeze --env production --yes`. The old app is back exactly as it was. Writes made on the new app since step 2 are lost, so keep the no-go window short.

**After step 6:** there is no automated rollback. The new account is the source of truth.

The old API host (`pawsitivemileageapi.bourbonlab.net`) stays frozen and is not redirected. Its tokens are from the old user pool and wouldn't work against the new API anyway. Stale browser tabs fail, reload, and follow the 301.

## Teardown (about 30 days after cutover)

This removes everything PawsitiveMileage left in the legacy account `817281265012`. Every command below runs against that account (`--profile bourbonlab-root --region us-east-1`).

The old stacks were deployed from the pre-migration config, and `main` now targets the new account. So delete them with CloudFormation directly; don't use `cdk destroy` from `main`.

**Don't delete:**
- **`*.bourbonlab.net` ACM certificate.** It's shared: it's attached to other CloudFront distributions and load balancers in that account.
- **`CDKToolkit` stack.** Other apps in the account may use it.
- **Anything not prefixed `pawsitivemileage` / `PawsitiveMileage`.** The legacy account is the Organization management account and hosts other workloads.

### 1. Preconditions
- Production cutover was locked with `complete` at least 30 days ago. `verify` is no longer meaningful, because the new account has moved on.
- The old API is idle apart from the frozen-call errors: API Gateway `Count` for `pawsitivemileage-production-api` is near zero.

### 2. Archive the old production data (optional, cheap)
Deleting a table also deletes its point-in-time recovery history. **On-demand backups survive table deletion**, so take one per table first:

```bash
for t in users vehicles fillups maintenance schemas sharing; do
  aws dynamodb create-backup --table-name pawsitivemileage-$t-production --backup-name pre-teardown-$t-$(date +%F)
done
```

### 3. Delete the stacks
Delete them in dependency order: Frontend, then Api, then Auth, Database and Storage.

```bash
for env in staging production; do
  for s in Frontend Api Auth Database Storage; do
    aws cloudformation update-termination-protection --no-enable-termination-protection --stack-name PawsitiveMileage-$env-$s 2>/dev/null
    aws cloudformation delete-stack --stack-name PawsitiveMileage-$env-$s
    aws cloudformation wait stack-delete-complete --stack-name PawsitiveMileage-$env-$s
  done
done
```

Staging resources are deleted with their stacks; its buckets empty themselves.

### 4. Delete what production kept
Production resources use `RETAIN`, so they survive stack deletion. Remove them by hand:

| Resource | Names |
|---|---|
| DynamoDB tables | `pawsitivemileage-{users,vehicles,fillups,maintenance,schemas,sharing}-production` |
| S3 buckets (empty first: `aws s3 rm s3://<bucket> --recursive`) | `pawsitivemileage-production-{photos,exports,frontend}` |
| Cognito user pool | `pawsitivemileage-production-userpool`. Deleting it also removes its `pmileage-production` domain. |
| CloudWatch log groups | `/aws/lambda/pawsitivemileage-production-*` |

### 5. Remaining loose ends
- **Secrets Manager:** delete `pawsitivemileage/google-oauth-client-secret` in the old account.
- **Google OAuth client:** remove the `https://pmileage-{staging,production}.auth.us-east-1.amazoncognito.com` origins and `/oauth2/idpresponse` redirect URIs.
- **CloudFlare, bourbonlab.net zone:**
  - `pawsitivemileage.bourbonlab.net`: change it to `AAAA 100::` (**proxied**), CloudFlare's no-origin placeholder. The 301 rule only runs on proxied traffic, so the record must stay. This also avoids a CNAME pointing at a deleted CloudFront distribution.
  - `pawsitivemileageapi.bourbonlab.net`, `pawsitivemileagestaging.bourbonlab.net`, `pawsitivemileageapistaging.bourbonlab.net`: delete them.
  - Keep the production 301 rule for at least a year.
- **Local:** delete `.env.old-account`, which could only deploy to the old account. You can keep `~/.pawsitivemileage-migration/` as a record of the old→new user mapping, or delete it; it contains emails.
