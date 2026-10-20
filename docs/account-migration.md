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

Tell users ahead of time. On the day:

| # | Step | Command / action |
|---|------|------------------|
| 1 | Freeze the old app. Its API now fails every call. | `freeze --env production --yes` |
| 2 | Final migration | `migrate --env production --final --yes` → **Verify passed**. It compares every item, photo and user link. `parity-check` can't run now, because it needs the old Lambdas. |
| 3 | Smoke test on https://pawsitivemileage.app | sign-in, data spot-checks, one write |
| 4 | Redirect the old site | CloudFlare Single Redirect on bourbonlab.net: `pawsitivemileage.bourbonlab.net/*` → `https://pawsitivemileage.app/${path}` (301, keep the query string) |
| 5 | **Go / no-go** | |
| 6 | Lock the target | `complete --env production --yes` |

**Rollback before step 6:** turn off the redirect rule, then `unfreeze --env production --yes`. The old app is back exactly as it was. Writes made on the new app since step 2 are lost, so keep the no-go window short.

**After step 6:** there is no automated rollback. The new account is the source of truth.

The old API host (`pawsitivemileageapi.bourbonlab.net`) stays frozen and is not redirected. Its tokens are from the old user pool and wouldn't work against the new API anyway. Stale browser tabs fail, reload, and follow the 301.

## Afterwards (about 30 days)

- Delete the `PawsitiveMileage-*` stacks in `817281265012`. Production retains its tables, buckets and user pool and has termination protection, so remove those by hand.
- Delete `pawsitivemileage/google-oauth-client-secret` in the old account.
- Remove the old `pmileage-*` entries from the Google OAuth client.
- Keep the CloudFlare 301 for at least a year.
