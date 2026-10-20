import * as cdk from 'aws-cdk-lib';

/** All stacks deploy to us-east-1 (CloudFront and Cognito custom-domain certificates must live here). */
export const REGION = 'us-east-1';

export interface EnvironmentConfig {
  envName: 'test' | 'staging' | 'production';
  /** AWS account the environment is pinned to — synth fails rather than deploying elsewhere */
  account: string;
  frontendDomain: string;
  apiDomain: string;
  /** Cognito Hosted UI custom domain (e.g. auth.example.com) */
  authDomain: string;
  resourcePrefix: string;
  enableMonitoring: boolean;
  tags: Record<string, string>;
}

/** Default resource prefixes per environment — account and domains MUST be provided via CDK context */
const defaults: Record<string, { envName: EnvironmentConfig['envName']; resourcePrefix: string }> = {
  test: {
    envName: 'test',
    resourcePrefix: 'pawsitivemileage-test',
  },
  staging: {
    envName: 'staging',
    resourcePrefix: 'pawsitivemileage-staging',
  },
  production: {
    envName: 'production',
    resourcePrefix: 'pawsitivemileage-production',
  },
};

function requireContext(app: cdk.App, key: string): string {
  const value = app.node.tryGetContext(key);
  if (!value) {
    throw new Error(`Missing required CDK context: ${key}. Pass via -c ${key}=<value>`);
  }
  return value;
}

/**
 * Build environment config from CDK context with fallback to defaults.
 * Required context keys: account, frontendDomain, apiDomain, authDomain
 * Optional context keys: resourcePrefix, enableMonitoring
 */
export function getEnvironmentConfig(app: cdk.App, envName: string): EnvironmentConfig {
  const base = defaults[envName];
  if (!base) {
    throw new Error(`Unknown environment: ${envName}. Valid values: ${Object.keys(defaults).join(', ')}`);
  }

  const account = requireContext(app, 'account');
  if (!/^\d{12}$/.test(account)) {
    throw new Error(`CDK context "account" must be a 12-digit AWS account ID (got "${account}")`);
  }

  return {
    envName: base.envName,
    account,
    frontendDomain: requireContext(app, 'frontendDomain'),
    apiDomain: requireContext(app, 'apiDomain'),
    authDomain: requireContext(app, 'authDomain'),
    resourcePrefix: app.node.tryGetContext('resourcePrefix') ?? base.resourcePrefix,
    enableMonitoring: app.node.tryGetContext('enableMonitoring') === 'true',
    tags: { Environment: envName, Project: 'PawsitiveMileage', ManagedBy: 'CDK' },
  };
}
