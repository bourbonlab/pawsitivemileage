import * as cdk from 'aws-cdk-lib';

export interface EnvironmentConfig {
  envName: 'test' | 'staging' | 'production';
  frontendDomain: string;
  apiDomain: string;
  resourcePrefix: string;
  cognitoDomainPrefix: string;
  enableMonitoring: boolean;
  tags: Record<string, string>;
}

/** Default resource prefixes per environment — domains MUST be provided via CDK context */
const defaults: Record<string, { envName: EnvironmentConfig['envName']; resourcePrefix: string; cognitoDomainPrefix: string }> = {
  test: {
    envName: 'test',
    resourcePrefix: 'pawsitivemileage-test',
    cognitoDomainPrefix: 'pmileage-test',
  },
  staging: {
    envName: 'staging',
    resourcePrefix: 'pawsitivemileage-staging',
    cognitoDomainPrefix: 'pmileage-staging',
  },
  production: {
    envName: 'production',
    resourcePrefix: 'pawsitivemileage-production',
    cognitoDomainPrefix: 'pmileage-production',
  },
};

/**
 * Build environment config from CDK context with fallback to defaults.
 * Context keys: frontendDomain, apiDomain, resourcePrefix
 */
export function getEnvironmentConfig(app: cdk.App, envName: string): EnvironmentConfig {
  const base = defaults[envName];
  if (!base) {
    throw new Error(`Unknown environment: ${envName}. Valid values: ${Object.keys(defaults).join(', ')}`);
  }

  const frontendDomain = app.node.tryGetContext('frontendDomain');
  const apiDomain = app.node.tryGetContext('apiDomain');

  if (!frontendDomain) {
    throw new Error('Missing required CDK context: frontendDomain. Pass via -c frontendDomain=<domain>');
  }
  if (!apiDomain) {
    throw new Error('Missing required CDK context: apiDomain. Pass via -c apiDomain=<domain>');
  }

  return {
    envName: base.envName,
    frontendDomain,
    apiDomain,
    resourcePrefix: app.node.tryGetContext('resourcePrefix') ?? base.resourcePrefix,
    cognitoDomainPrefix: app.node.tryGetContext('cognitoDomainPrefix') ?? base.cognitoDomainPrefix,
    enableMonitoring: app.node.tryGetContext('enableMonitoring') === 'true',
    tags: { Environment: envName, Project: 'PawsitiveMileage', ManagedBy: 'CDK' },
  };
}
