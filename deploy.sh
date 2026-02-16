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
if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  Missing .env file                                         ║${NC}"
  echo -e "${RED}║  Run: cp .env.example .env  and fill in your values.       ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
  exit 1
fi

set -a
source "$SCRIPT_DIR/.env"
set +a

# Validate required environment variables
MISSING_VARS=()
[[ -z "${GOOGLE_CLIENT_ID:-}" || "$GOOGLE_CLIENT_ID" == "your-google-client-id"* ]]   && MISSING_VARS+=("GOOGLE_CLIENT_ID")
[[ -z "${GOOGLE_CLIENT_SECRET:-}" || "$GOOGLE_CLIENT_SECRET" == "your-google-client"* ]] && MISSING_VARS+=("GOOGLE_CLIENT_SECRET")
[[ -z "${ACM_CERTIFICATE_ARN:-}" || "$ACM_CERTIFICATE_ARN" == *"your-certificate-id"* ]] && MISSING_VARS+=("ACM_CERTIFICATE_ARN")
[[ -z "${RESOURCE_PREFIX:-}" ]]                                                          && MISSING_VARS+=("RESOURCE_PREFIX")
[[ -z "${COGNITO_DOMAIN_PREFIX:-}" ]]                                                      && MISSING_VARS+=("COGNITO_DOMAIN_PREFIX")
[[ -z "${FRONTEND_DOMAIN_TEST:-}" ]]                                                     && MISSING_VARS+=("FRONTEND_DOMAIN_TEST")
[[ -z "${FRONTEND_DOMAIN_STAGING:-}" ]]                                                  && MISSING_VARS+=("FRONTEND_DOMAIN_STAGING")
[[ -z "${FRONTEND_DOMAIN_PRODUCTION:-}" ]]                                               && MISSING_VARS+=("FRONTEND_DOMAIN_PRODUCTION")
[[ -z "${API_DOMAIN_TEST:-}" ]]                                                          && MISSING_VARS+=("API_DOMAIN_TEST")
[[ -z "${API_DOMAIN_STAGING:-}" ]]                                                       && MISSING_VARS+=("API_DOMAIN_STAGING")
[[ -z "${API_DOMAIN_PRODUCTION:-}" ]]                                                    && MISSING_VARS+=("API_DOMAIN_PRODUCTION")

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

# CDK (via npx — no global install required)
if ! npx cdk --version &>/dev/null; then
  fail "AWS CDK CLI not available via npx. Run: npm install -g aws-cdk"
fi
ok "CDK $(npx cdk --version 2>&1 | head -1)"

# AWS credentials
step "Verifying AWS credentials"
if ! aws sts get-caller-identity &>/dev/null; then
  fail "AWS credentials not configured or expired. Run: aws configure"
fi
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
CALLER_ARN=$(aws sts get-caller-identity --query Arn --output text)
ok "Authenticated as ${CALLER_ARN}"
ok "Account: ${ACCOUNT_ID}"

# ── Step 2: Install dependencies ────────────────────────────────────────────

step "Installing dependencies"

for dir in api web infra; do
  info "npm install in ${dir}/"
  if [[ "$VERBOSE" == true ]]; then
    (cd "$dir" && npm install --yes)
  else
    (cd "$dir" && npm install --yes --silent 2>&1) || fail "npm install failed in ${dir}/"
  fi
  ok "${dir}/ dependencies installed"
done

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

CDK_ENV="${DEPLOY_ENV:-test}"

# Resolve domains for the target environment
CDK_ENV_UPPER=$(echo "$CDK_ENV" | tr '[:lower:]' '[:upper:]')
FRONTEND_DOMAIN_VAR="FRONTEND_DOMAIN_${CDK_ENV_UPPER}"
API_DOMAIN_VAR="API_DOMAIN_${CDK_ENV_UPPER}"
FRONTEND_DOMAIN="${!FRONTEND_DOMAIN_VAR}"
API_DOMAIN="${!API_DOMAIN_VAR}"

# Build CDK context flags (all values validated from .env above)
CDK_CONTEXT=(
  -c environment="$CDK_ENV"
  -c apiCertificateArn="$ACM_CERTIFICATE_ARN"
  -c frontendCertificateArn="$ACM_CERTIFICATE_ARN"
  -c googleClientId="$GOOGLE_CLIENT_ID"
  -c googleClientSecret="$GOOGLE_CLIENT_SECRET"
  -c frontendDomain="$FRONTEND_DOMAIN"
  -c apiDomain="$API_DOMAIN"
  -c resourcePrefix="${RESOURCE_PREFIX}-${CDK_ENV}"
  -c cognitoDomainPrefix="${COGNITO_DOMAIN_PREFIX}-${CDK_ENV}"
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

info "Running: cdk deploy --all --require-approval never -c environment=${DEPLOY_ENV}"

if [[ "$VERBOSE" == true ]]; then
  (cd infra && npx cdk deploy --all --require-approval never "${CDK_CONTEXT[@]}")
else
  (cd infra && npx cdk deploy --all --require-approval never "${CDK_CONTEXT[@]}") || fail "CDK deploy failed"
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

COGNITO_DOMAIN="${COGNITO_DOMAIN_PREFIX}-${CDK_ENV}.auth.us-east-1.amazoncognito.com"

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
    info "Frontend: https://${FRONTEND_DOMAIN}"
    info "API:      https://${API_DOMAIN}"
    ;;
esac

echo ""
