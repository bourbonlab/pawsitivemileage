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
#
# Options:
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

for arg in "$@"; do
  case "$arg" in
    --test)       DEPLOY_ENV="test" ;;
    --stage)      DEPLOY_ENV="staging" ;;
    --prod)       DEPLOY_ENV="production" ;;
    --yes)        CONFIRM_PROD=true ;;
    --skip-tests) SKIP_TESTS=true ;;
    --verbose)    VERBOSE=true ;;
    --help|-h)
      echo "Usage: ./deploy.sh [--test|--stage|--prod] [--yes] [--skip-tests] [--verbose]"
      echo ""
      echo "  (no flag)    Install, build, test, and CDK synth only"
      echo "  --test       Deploy to test environment"
      echo "  --stage      Deploy to staging environment"
      echo "  --prod       Deploy to production (requires --yes to confirm)"
      echo "  --yes        Skip production confirmation prompt"
      echo "  --skip-tests Skip running test suites"
      echo "  --verbose    Show detailed command output"
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

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          PawsitiveMileage — CI/CD Pipeline                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"

if [[ -n "$DEPLOY_ENV" ]]; then
  info "Target environment: ${YELLOW}${DEPLOY_ENV}${NC}"
else
  info "Mode: ${YELLOW}synth only${NC} (no deploy flag provided)"
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

# ── Step 5: Build frontend ──────────────────────────────────────────────────

step "Building frontend (Vite)"

if [[ "$VERBOSE" == true ]]; then
  (cd web && npm run build)
else
  (cd web && npm run build 2>&1) || fail "Frontend build failed"
fi

ok "Frontend built — output in web/dist/"


# ── Step 6: CDK Synth ───────────────────────────────────────────────────────

CDK_ENV="${DEPLOY_ENV:-test}"

step "Synthesizing CDK stacks (environment: ${CDK_ENV})"

if [[ "$VERBOSE" == true ]]; then
  (cd infra && npx cdk synth -c environment="$CDK_ENV")
else
  (cd infra && npx cdk synth -c environment="$CDK_ENV" 2>&1) || fail "CDK synth failed"
fi

ok "CDK synth succeeded for ${CDK_ENV}"

# ── Step 7: Deploy (if environment flag provided) ───────────────────────────

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
  (cd infra && npx cdk deploy --all --require-approval never -c environment="$DEPLOY_ENV")
else
  (cd infra && npx cdk deploy --all --require-approval never -c environment="$DEPLOY_ENV") || fail "CDK deploy failed"
fi

ok "All stacks deployed to ${DEPLOY_ENV}"

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Deploy complete: ${DEPLOY_ENV}${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

case "$DEPLOY_ENV" in
  test)
    info "Frontend: https://pawsitivemileagetest.bourbonlab.net"
    info "API:      https://pawsitivemileageapitest.bourbonlab.net"
    ;;
  staging)
    info "Frontend: https://pawsitivemileagestaging.bourbonlab.net"
    info "API:      https://pawsitivemileageapistaging.bourbonlab.net"
    ;;
  production)
    info "Frontend: https://pawsitivemileage.bourbonlab.net"
    info "API:      https://pawsitivemileageapi.bourbonlab.net"
    ;;
esac

echo ""
