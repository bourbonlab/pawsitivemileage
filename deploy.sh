#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# PawsitiveMileage — CI/CD Deploy Script
#
# Usage:
#   ./deploy.sh              # Install, build, test, synth only (no deploy)
#   ./deploy.sh --test       # Deploy to test environment
#   ./deploy.sh --stage      # Deploy to staging environment
#   ./deploy.sh --prod       # Deploy to production (requires --yes)
#   ./deploy.sh --prod --yes # Deploy to production (skip confirmation)
#   ./deploy.sh --test --clear-cache  # Purge CloudFront + CloudFlare caches only
#
# Options:
#   --clear-cache  Skip build/deploy, just purge caches for the target environment
#   --skip-tests   Skip running tests
#   --verbose      Show detailed command output
###############################################################################

# ── Colors & helpers ─────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

STEP=0

step() {
  STEP=$((STEP + 1))
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}  Step ${STEP}: ${1}${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

ok()   { echo -e "  ${GREEN}✔${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✖ $1${NC}"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

# ── Parse arguments ──────────────────────────────────────────────────────────

DEPLOY_ENV=""
SKIP_TESTS=false
VERBOSE=false
CONFIRM_PROD=false
CLEAR_CACHE=false

for arg in "$@"; do
  case "$arg" in
    --test)       DEPLOY_ENV="test" ;;
    --stage)      DEPLOY_ENV="staging" ;;
    --prod)       DEPLOY_ENV="production" ;;
    --yes)        CONFIRM_PROD=true ;;
    --skip-tests) SKIP_TESTS=true ;;
    --clear-cache) CLEAR_CACHE=true ;;
    --verbose)    VERBOSE=true ;;
    --help|-h)
      echo "Usage: ./deploy.sh [--test|--stage|--prod] [--yes] [--skip-tests] [--clear-cache] [--verbose]"
      echo ""
      echo "  (no flag)      Install, build, test, and CDK synth only"
      echo "  --test         Deploy to test environment"
      echo "  --stage        Deploy to staging environment"
      echo "  --prod         Deploy to production (requires --yes to confirm)"
      echo "  --yes          Skip production confirmation prompt"
      echo "  --skip-tests   Skip running test suites"
      echo "  --clear-cache  Purge CloudFront + CloudFlare caches only (requires env flag)"
      echo "  --verbose      Show detailed command output"
      exit 0
      ;;
    *) fail "Unknown argument: $arg. Use --help for usage." ;;
  esac
done

# Production safety gate
if [[ "$DEPLOY_ENV" == "production" && "$CONFIRM_PROD" != true ]]; then
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  PRODUCTION DEPLOY — Are you sure?                         ║${NC}"
  echo -e "${RED}║  Re-run with --prod --yes to confirm.                      ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
  exit 1
fi

# Resolve project root (script location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Load .env secrets ────────────────────────────────────────────────────────
# In GitHub Actions (CI=true) there is no .env: the workflow sets the same variables from the
# GitHub environment, and the validation below catches anything missing.
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
elif [[ "${CI:-}" != true ]]; then
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  Missing .env file                                         ║${NC}"
  echo -e "${RED}║  Run: cp .env.example .env  and fill in your values.       ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
  exit 1
fi

# Target environment for synth/deploy (synth-only runs default to staging)
CDK_ENV="${DEPLOY_ENV:-staging}"
CDK_ENV_UPPER=$(echo "$CDK_ENV" | tr '[:lower:]' '[:upper:]')

# Resolve per-environment values (e.g. FRONTEND_DOMAIN_STAGING → FRONTEND_DOMAIN). The unsuffixed
# name is the fallback, which is how GitHub environment variables arrive in CI.
env_var() { local name="${1}_${CDK_ENV_UPPER}"; echo "${!name:-${!1:-}}"; }
AWS_ACCOUNT_ID=$(env_var AWS_ACCOUNT_ID)
FRONTEND_DOMAIN=$(env_var FRONTEND_DOMAIN)
API_DOMAIN=$(env_var API_DOMAIN)
AUTH_DOMAIN=$(env_var AUTH_DOMAIN)
GOOGLE_CLIENT_SECRET_ARN=$(env_var GOOGLE_CLIENT_SECRET_ARN)

# Validate required environment variables (global + the target environment only)
MISSING_VARS=()
[[ -z "${GOOGLE_CLIENT_ID:-}" || "$GOOGLE_CLIENT_ID" == "your-google-client-id"* ]]   && MISSING_VARS+=("GOOGLE_CLIENT_ID")
[[ -z "${ACM_CERTIFICATE_ARN:-}" || "$ACM_CERTIFICATE_ARN" == *"your-certificate-id"* ]] && MISSING_VARS+=("ACM_CERTIFICATE_ARN")
[[ -z "${RESOURCE_PREFIX:-}" ]]                                                          && MISSING_VARS+=("RESOURCE_PREFIX")
[[ ! "$AWS_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]                                                 && MISSING_VARS+=("AWS_ACCOUNT_ID_${CDK_ENV_UPPER}")
[[ -z "$GOOGLE_CLIENT_SECRET_ARN" || "$GOOGLE_CLIENT_SECRET_ARN" == "your-"* ]]           && MISSING_VARS+=("GOOGLE_CLIENT_SECRET_ARN_${CDK_ENV_UPPER}")
[[ -z "$FRONTEND_DOMAIN" ]]                                                              && MISSING_VARS+=("FRONTEND_DOMAIN_${CDK_ENV_UPPER}")
[[ -z "$API_DOMAIN" ]]                                                                   && MISSING_VARS+=("API_DOMAIN_${CDK_ENV_UPPER}")
[[ -z "$AUTH_DOMAIN" ]]                                                                  && MISSING_VARS+=("AUTH_DOMAIN_${CDK_ENV_UPPER}")

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  Missing required variables in .env                        ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
  for var in "${MISSING_VARS[@]}"; do
    echo -e "  ${RED}✖${NC} ${var} is not set or still has placeholder value"
  done
  echo ""
  echo -e "  ${CYAN}→${NC} Edit .env with your actual values. See .env.example for reference."
  exit 1
fi

# Refuse to touch AWS unless the active credentials belong to the environment's account.
# AWS_PROFILE (if set in .env) is exported above and used by every aws/cdk call.
verify_account() {
  local actual
  actual=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) \
    || fail "AWS credentials not configured or expired (profile: ${AWS_PROFILE:-default}). Run: aws sso login --profile ${AWS_PROFILE:-<profile>}"
  if [[ "$actual" != "$AWS_ACCOUNT_ID" ]]; then
    fail "Credentials are for account ${actual}, but ${CDK_ENV} must deploy to ${AWS_ACCOUNT_ID}. Check AWS_PROFILE in .env (currently: ${AWS_PROFILE:-unset})."
  fi
}

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          PawsitiveMileage — CI/CD Pipeline                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"

if [[ -n "$DEPLOY_ENV" ]]; then
  info "Target environment: ${YELLOW}${DEPLOY_ENV}${NC}"
else
  info "Mode: ${YELLOW}synth only${NC} (no deploy flag provided)"
fi

# ── Clear-cache shortcut ────────────────────────────────────────────────────
# Skips the entire build/deploy pipeline — just purges caches and exits.

if [[ "$CLEAR_CACHE" == true ]]; then
  if [[ -z "$DEPLOY_ENV" ]]; then
    fail "--clear-cache requires an environment flag (--test, --stage, or --prod)"
  fi

  step "Clearing caches for ${DEPLOY_ENV}"

  verify_account

  # Resolve CloudFront distribution ID
  FRONTEND_STACK_NAME="PawsitiveMileage-${DEPLOY_ENV}-Frontend"
  CF_DIST_ID=$(aws cloudformation describe-stacks \
    --stack-name "$FRONTEND_STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
    --output text 2>/dev/null || true)

  if [[ -n "$CF_DIST_ID" && "$CF_DIST_ID" != "None" ]]; then
    info "Invalidating CloudFront distribution ${CF_DIST_ID}"
    aws cloudfront create-invalidation --distribution-id "$CF_DIST_ID" --paths "/*" > /dev/null 2>&1 || warn "CloudFront invalidation failed (non-fatal)"
    ok "CloudFront cache invalidation requested"
  else
    warn "Could not find CloudFront distribution ID — skipping"
  fi

  if [[ -n "${CLOUDFLARE_ZONE_ID:-}" && -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    info "Purging CloudFlare cache for zone ${CLOUDFLARE_ZONE_ID}"
    CF_RESPONSE=$(curl -s -X POST \
      "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data '{"purge_everything":true}' 2>/dev/null || true)

    if echo "$CF_RESPONSE" | grep -q '"success":\s*true'; then
      ok "CloudFlare cache purged"
    else
      warn "CloudFlare cache purge failed (non-fatal)"
      if [[ "$VERBOSE" == true ]]; then
        info "Response: ${CF_RESPONSE}"
      fi
    fi
  fi

  echo ""
  echo -e "${GREEN}  Cache clear complete for ${DEPLOY_ENV}${NC}"
  echo ""
  exit 0
fi


# ── Step 1: Prerequisites ───────────────────────────────────────────────────

step "Checking prerequisites"

# Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node.js 22+ from https://nodejs.org/"
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt 24 ]]; then
  fail "Node.js v24+ required (found v${NODE_VERSION}). Please upgrade."
fi
ok "Node.js $(node -v)"

# npm
if ! command -v npm &>/dev/null; then
  fail "npm is not installed."
fi
ok "npm $(npm -v)"

# AWS CLI
if ! command -v aws &>/dev/null; then
  fail "AWS CLI is not installed. See https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
fi
ok "AWS CLI $(aws --version 2>&1 | awk '{print $1}')"

# CDK (via npx from infra/ — where aws-cdk is installed)
# stderr is discarded: npm 12 prints "npm notice run ..." lines there, and piping them
# through `head -1` SIGPIPEs npx, which fails this check under `set -o pipefail`.
CDK_VERSION=$(cd infra && npx cdk --version 2>/dev/null) || fail "AWS CDK CLI not available. Run: cd infra && npm install"
ok "CDK ${CDK_VERSION}"

# AWS credentials
step "Verifying AWS credentials"
if ! aws sts get-caller-identity &>/dev/null; then
  fail "AWS credentials not configured or expired. Run: aws configure"
fi
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
CALLER_ARN=$(aws sts get-caller-identity --query Arn --output text)
ok "Authenticated as ${CALLER_ARN}"
ok "Account: ${ACCOUNT_ID} (profile: ${AWS_PROFILE:-default})"
if [[ -n "$DEPLOY_ENV" ]]; then
  verify_account
  ok "Account matches ${CDK_ENV} target (${AWS_ACCOUNT_ID})"
elif [[ "$ACCOUNT_ID" != "$AWS_ACCOUNT_ID" ]]; then
  warn "Synth-only: credentials are for ${ACCOUNT_ID}, ${CDK_ENV} targets ${AWS_ACCOUNT_ID}"
fi

# ── Step 2: Install dependencies ────────────────────────────────────────────

step "Installing dependencies (npm ci — all workspaces)"

# Single hoisted install from the root lockfile covers every workspace
# (api, web, cli, infra). npm ci is reproducible and fails fast if the
# lockfile is out of sync with package.json.
info "npm ci at repo root"
if [[ "$VERBOSE" == true ]]; then
  npm ci
else
  npm ci --silent 2>&1 || fail "npm ci failed — lockfile may be out of sync. Run 'npm install' locally and commit package-lock.json."
fi
ok "All workspace dependencies installed from lockfile"

(npm audit --audit-level=high 2>/dev/null) || warn "npm audit found vulnerabilities (run 'npm audit' for details)"

# ── Step 3: Build API ───────────────────────────────────────────────────────

step "Building API (esbuild)"

if [[ "$VERBOSE" == true ]]; then
  (cd api && npm run build)
else
  (cd api && npm run build 2>&1) || fail "API build failed"
fi

HANDLER_COUNT=$(ls -1 api/dist/*.js 2>/dev/null | wc -l)
ok "API built — ${HANDLER_COUNT} handler bundles in api/dist/"

# ── Step 4: Run API tests ───────────────────────────────────────────────────

if [[ "$SKIP_TESTS" == true ]]; then
  step "Skipping tests (--skip-tests)"
  warn "Tests skipped by flag"
else
  step "Running API tests"

  if [[ "$VERBOSE" == true ]]; then
    (cd api && npm test) || fail "API tests failed"
  else
    (cd api && npm test 2>&1) || fail "API tests failed"
  fi
  ok "API tests passed"
fi

# ── Step 5: CDK Synth ────────────────────────────────────────────────────────

# Build CDK context flags (all values validated from .env above)
CDK_CONTEXT=(
  -c environment="$CDK_ENV"
  -c account="$AWS_ACCOUNT_ID"
  -c apiCertificateArn="$ACM_CERTIFICATE_ARN"
  -c frontendCertificateArn="$ACM_CERTIFICATE_ARN"
  -c authCertificateArn="$ACM_CERTIFICATE_ARN"
  -c googleClientId="$GOOGLE_CLIENT_ID"
  -c googleClientSecretArn="$GOOGLE_CLIENT_SECRET_ARN"
  -c frontendDomain="$FRONTEND_DOMAIN"
  -c apiDomain="$API_DOMAIN"
  -c authDomain="$AUTH_DOMAIN"
  -c resourcePrefix="${RESOURCE_PREFIX}-${CDK_ENV}"
)

step "Synthesizing CDK stacks (environment: ${CDK_ENV})"

if [[ "$VERBOSE" == true ]]; then
  (cd infra && npx cdk synth "${CDK_CONTEXT[@]}")
else
  (cd infra && npx cdk synth "${CDK_CONTEXT[@]}" 2>&1) || fail "CDK synth failed"
fi

ok "CDK synth succeeded for ${CDK_ENV}"

# ── Step 6: Deploy (if environment flag provided) ───────────────────────────

if [[ -z "$DEPLOY_ENV" ]]; then
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  Pipeline complete — synth only (no deploy flag provided)${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  info "To deploy, re-run with: --test, --stage, or --prod"
  exit 0
fi

step "Deploying to ${DEPLOY_ENV}"

# CDK must be bootstrapped once per account/region before the first deploy
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-1 &>/dev/null; then
  fail "CDK is not bootstrapped in ${AWS_ACCOUNT_ID}/us-east-1. Run (outside infra/): npx cdk bootstrap aws://${AWS_ACCOUNT_ID}/us-east-1"
fi

# No interactive IAM approval in any environment: the account (376784708284) is dedicated to
# this app, and IAM changes are reviewed in PRs (security finding F-12, accepted risk).
APPROVAL_FLAG="--require-approval never"

info "Running: cdk deploy --all ${APPROVAL_FLAG} -c environment=${DEPLOY_ENV}"

if [[ "$VERBOSE" == true ]]; then
  (cd infra && npx cdk deploy --all ${APPROVAL_FLAG} "${CDK_CONTEXT[@]}")
else
  (cd infra && npx cdk deploy --all ${APPROVAL_FLAG} "${CDK_CONTEXT[@]}") || fail "CDK deploy failed"
fi

ok "All stacks deployed to ${DEPLOY_ENV}"

# ── Step 7: Build frontend with Cognito config ──────────────────────────────

step "Building frontend with Cognito configuration"

AUTH_STACK_NAME="PawsitiveMileage-${CDK_ENV}-Auth"
info "Fetching Cognito outputs from ${AUTH_STACK_NAME}"

COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "$AUTH_STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text 2>/dev/null) || fail "Could not fetch UserPoolId from ${AUTH_STACK_NAME}"

COGNITO_APP_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name "$AUTH_STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
  --output text 2>/dev/null) || fail "Could not fetch UserPoolClientId from ${AUTH_STACK_NAME}"

COGNITO_DOMAIN="$AUTH_DOMAIN"

if [[ -z "$COGNITO_USER_POOL_ID" || "$COGNITO_USER_POOL_ID" == "None" ]]; then
  fail "UserPoolId is empty — Auth stack may not have deployed correctly"
fi
if [[ -z "$COGNITO_APP_CLIENT_ID" || "$COGNITO_APP_CLIENT_ID" == "None" ]]; then
  fail "UserPoolClientId is empty — Auth stack may not have deployed correctly"
fi

ok "User Pool ID:  ${COGNITO_USER_POOL_ID}"
ok "App Client ID: ${COGNITO_APP_CLIENT_ID}"
ok "Cognito Domain: ${COGNITO_DOMAIN}"

# Export VITE_ env vars so Vite bakes them into the frontend bundle
export VITE_API_URL="https://${API_DOMAIN}"
export VITE_COGNITO_USER_POOL_ID="$COGNITO_USER_POOL_ID"
export VITE_COGNITO_APP_CLIENT_ID="$COGNITO_APP_CLIENT_ID"
export VITE_COGNITO_DOMAIN="$COGNITO_DOMAIN"
export VITE_SOURCE_CODE_URL="${SOURCE_CODE_URL:-}"
export VITE_SUPPORT_EMAIL="${SUPPORT_EMAIL:-}"

info "VITE_API_URL=${VITE_API_URL}"
info "Building frontend with Cognito config baked in..."

if [[ "$VERBOSE" == true ]]; then
  (cd web && npm run build)
else
  (cd web && npm run build 2>&1) || fail "Frontend build failed"
fi

ok "Frontend built — output in web/dist/"

# ── Step 8: Sync frontend to S3 ─────────────────────────────────────────────

step "Syncing frontend assets to S3"

FRONTEND_BUCKET="${RESOURCE_PREFIX}-${CDK_ENV}-frontend"
info "Bucket: ${FRONTEND_BUCKET}"

aws s3 sync web/dist/ "s3://${FRONTEND_BUCKET}" --delete || fail "S3 sync failed"
ok "Frontend assets synced to s3://${FRONTEND_BUCKET}"

# Invalidate CloudFront cache
FRONTEND_STACK_NAME="PawsitiveMileage-${CDK_ENV}-Frontend"
CF_DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name "$FRONTEND_STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text 2>/dev/null || true)

if [[ -n "$CF_DIST_ID" && "$CF_DIST_ID" != "None" ]]; then
  info "Invalidating CloudFront distribution ${CF_DIST_ID}"
  aws cloudfront create-invalidation --distribution-id "$CF_DIST_ID" --paths "/*" > /dev/null 2>&1 || warn "CloudFront invalidation failed (non-fatal)"
  ok "CloudFront cache invalidation requested"
else
  warn "Could not find CloudFront distribution ID — skipping cache invalidation"
  info "You can manually invalidate via: aws cloudfront create-invalidation --distribution-id <ID> --paths '/*'"
fi

# Purge CloudFlare cache (optional — requires CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN in .env)
if [[ -n "${CLOUDFLARE_ZONE_ID:-}" && -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  info "Purging CloudFlare cache for zone ${CLOUDFLARE_ZONE_ID}"
  CF_RESPONSE=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{"purge_everything":true}' 2>/dev/null || true)

  if echo "$CF_RESPONSE" | grep -q '"success":\s*true'; then
    ok "CloudFlare cache purged"
  else
    warn "CloudFlare cache purge failed (non-fatal)"
    if [[ "$VERBOSE" == true ]]; then
      info "Response: ${CF_RESPONSE}"
    fi
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Deploy complete: ${DEPLOY_ENV}${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

case "$DEPLOY_ENV" in
  test|staging|production)
    # Fetch CNAME targets from stack outputs
    CF_DOMAIN_NAME=$(aws cloudformation describe-stacks \
      --stack-name "$FRONTEND_STACK_NAME" \
      --query "Stacks[0].Outputs[?OutputKey=='DistributionDomainName'].OutputValue" \
      --output text 2>/dev/null || echo "unknown")

    API_STACK_NAME="PawsitiveMileage-${CDK_ENV}-Api"
    API_CNAME_TARGET=$(aws cloudformation describe-stacks \
      --stack-name "$API_STACK_NAME" \
      --query "Stacks[0].Outputs[?OutputKey=='ApiDomainRegionalDomainName'].OutputValue" \
      --output text 2>/dev/null || echo "unknown")

    AUTH_CNAME_TARGET=$(aws cloudformation describe-stacks \
      --stack-name "$AUTH_STACK_NAME" \
      --query "Stacks[0].Outputs[?OutputKey=='HostedUIDomainCloudFrontTarget'].OutputValue" \
      --output text 2>/dev/null || echo "unknown")

    echo -e "  ${CYAN}Endpoints${NC}"
    info "Frontend: https://${FRONTEND_DOMAIN}  (CNAME → ${CF_DOMAIN_NAME})"
    info "API:      https://${API_DOMAIN}  (CNAME → ${API_CNAME_TARGET})"
    info "Auth:     https://${AUTH_DOMAIN}  (CNAME → ${AUTH_CNAME_TARGET}, DNS-only — not proxied)"

    # Google OAuth configuration reminder
    COGNITO_HOSTED_UI="https://${COGNITO_DOMAIN}"
    echo ""
    echo -e "  ${CYAN}Google OAuth Console Settings${NC}"
    echo -e "  ${YELLOW}Authorized JavaScript Origins:${NC}"
    info "${COGNITO_HOSTED_UI}"
    echo -e "  ${YELLOW}Authorized Redirect URIs:${NC}"
    info "${COGNITO_HOSTED_UI}/oauth2/idpresponse"
    ;;
esac

echo ""
