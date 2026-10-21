#!/usr/bin/env node

// Separate CDK app for the GitHub Actions deploy roles, kept out of bin/app.ts so the deploy
// workflow (`cdk deploy --all`) can never change its own permissions. Deploy by hand:
//   npm run deploy:github-access -w infra -- -c account=<id> -c resourcePrefix=<RESOURCE_PREFIX>

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { REGION } from '../lib/config.js';
import { GitHubAccessStack } from '../lib/stacks/github-access-stack.js';

const app = new cdk.App();

function requireContext(key: string): string {
  const value = app.node.tryGetContext(key);
  if (!value) {
    throw new Error(`Missing required CDK context: ${key}. Pass via -c ${key}=<value>`);
  }
  return value;
}

const account = requireContext('account');
if (!/^\d{12}$/.test(account)) {
  throw new Error(`CDK context "account" must be a 12-digit AWS account ID (got "${account}")`);
}

const stack = new GitHubAccessStack(app, 'PawsitiveMileage-GitHubAccess', {
  env: { account, region: REGION },
  // Immutable OIDC subject form (owner@id/repo@id) — see GitHubAccessStackProps.githubRepo
  githubRepo: app.node.tryGetContext('githubRepo') ?? 'bourbonlab@179869454/pawsitivemileage@1427729468',
  resourcePrefix: requireContext('resourcePrefix'),
  environments: ['staging', 'production'],
  terminationProtection: true,
});

cdk.Tags.of(stack).add('Project', 'PawsitiveMileage');
cdk.Tags.of(stack).add('ManagedBy', 'CDK');

app.synth();
