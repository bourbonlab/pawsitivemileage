#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# PawsitiveMileage — configure GitHub environments for the Deploy workflow
#
# Usage:
#   ./setup-github.sh            # create/update the staging and production environments
#
# Copies deploy config from .env into the `staging` and `production` GitHub environments
# (variables, plus CLOUDFLARE_API_TOKEN as a secret), and sets each environment's deploy
# role from the PawsitiveMileage-GitHubAccess stack outputs. Re-run whenever .env changes.
#
# Both environments only accept deployments from main; production also requires approval
# from the user running this script.
#
# Requires: gh (authenticated, repo admin), aws (credentials for the target account), jq.
###############################################################################

REPO="${GITHUB_REPO:-bourbonlab/pawsitivemileage}"
ENVIRONMENTS=(staging production)
ACCESS_STACK=PawsitiveMileage-GitHubAccess

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/.env" ]] || { echo "Missing .env"; exit 1; }
set -a
source "$SCRIPT_DIR/.env"
set +a

# Shared across environments
SHARED_VARS=(GOOGLE_CLIENT_ID ACM_CERTIFICATE_ARN RESOURCE_PREFIX SOURCE_CODE_URL SUPPORT_EMAIL CLOUDFLARE_ZONE_ID)
# Suffixed with _STAGING / _PRODUCTION in .env, unsuffixed in the GitHub environment
PER_ENV_VARS=(AWS_ACCOUNT_ID FRONTEND_DOMAIN API_DOMAIN AUTH_DOMAIN GOOGLE_CLIENT_SECRET_ARN)

reviewer_id=$(gh api user --jq .id)
reviewer_login=$(gh api user --jq .login)

for env in "${ENVIRONMENTS[@]}"; do
  upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
  echo "── ${env}"

  account_var="AWS_ACCOUNT_ID_${upper}"
  actual=$(aws sts get-caller-identity --query Account --output text)
  [[ "$actual" == "${!account_var}" ]] \
    || { echo "AWS credentials are for ${actual}, ${env} is ${!account_var}. Check AWS_PROFILE."; exit 1; }

  role_arn=$(aws cloudformation describe-stacks --region us-east-1 --stack-name "$ACCESS_STACK" \
    --query "Stacks[0].Outputs[?starts_with(OutputKey, 'DeployRoleArn${env}')].OutputValue | [0]" \
    --output text)
  [[ "$role_arn" == arn:aws:iam::* ]] \
    || { echo "No deploy role for ${env} in ${ACCESS_STACK}. Deploy it first (see docs/ci-cd.md)."; exit 1; }

  # Environment protection: main only; production needs a reviewer
  if [[ "$env" == production ]]; then
    reviewers="[{\"type\":\"User\",\"id\":${reviewer_id}}]"
  else
    reviewers="[]"
  fi
  gh api --method PUT "repos/${REPO}/environments/${env}" --input - >/dev/null <<EOF
{"reviewers": ${reviewers}, "prevent_self_review": false,
 "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
EOF
  existing=$(gh api "repos/${REPO}/environments/${env}/deployment-branch-policies" --jq '.branch_policies[].name')
  if ! grep -qx main <<<"$existing"; then
    gh api --method POST "repos/${REPO}/environments/${env}/deployment-branch-policies" \
      -f name=main -f type=branch >/dev/null
  fi
  echo "  protection: main only$([[ "$env" == production ]] && echo ", approval by ${reviewer_login}")"

  gh variable set AWS_DEPLOY_ROLE_ARN --repo "$REPO" --env "$env" --body "$role_arn"
  for name in "${SHARED_VARS[@]}"; do
    gh variable set "$name" --repo "$REPO" --env "$env" --body "${!name:-}"
  done
  for name in "${PER_ENV_VARS[@]}"; do
    suffixed="${name}_${upper}"
    gh variable set "$name" --repo "$REPO" --env "$env" --body "${!suffixed:-}"
  done

  # Secret goes through stdin so it never appears in the process list
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    printf '%s' "$CLOUDFLARE_API_TOKEN" | gh secret set CLOUDFLARE_API_TOKEN --repo "$REPO" --env "$env"
  fi
done

echo ""
echo "Done. Review at https://github.com/${REPO}/settings/environments"
