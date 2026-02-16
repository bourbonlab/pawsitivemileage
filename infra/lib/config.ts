import * as cdk from 'aws-cdk-lib';

export interface EnvironmentConfig {
  envName: 'test' | 'staging' | 'production';
  frontendDomain: string;
  apiDomain: string;
  resourcePrefix: string;
  cognitoDomainPrefix: string;
  tags: Record<string, string>;
}

/** Default domain configuration — overridable via CDK context */
const defaults: Record<string, Omit<EnvironmentConfig, 'tags'>> = {
  test: {
    envName: 'test',
    frontendDomain: 'pawsitivemileagetest.bourbonlab.net',
    apiDomain: 'pawsitivemileageapitest.bourbonlab.net',
    resourcePrefix: 'pawsitivemileage-test',
    cognitoDomainPrefix: 'pmileage-test',
  },
  staging: {
    envName: 'staging',
    frontendDomain: 'pawsitivemileagestaging.bourbonlab.net',
    apiDomain: 'pawsitivemileageapistaging.bourbonlab.net',
    resourcePrefix: 'pawsitivemileage-staging',
    cognitoDomainPrefix: 'pmileage-staging',
  },
  production: {
    envName: 'production',
    frontendDomain: 'pawsitivemileage.bourbonlab.net',
    apiDomain: 'pawsitivemileageapi.bourbonlab.net',
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

  return {
    envName: base.envName,
    frontendDomain: app.node.tryGetContext('frontendDomain') ?? base.frontendDomain,
    apiDomain: app.node.tryGetContext('apiDomain') ?? base.apiDomain,
    resourcePrefix: app.node.tryGetContext('resourcePrefix') ?? base.resourcePrefix,
    cognitoDomainPrefix: app.node.tryGetContext('cognitoDomainPrefix') ?? base.cognitoDomainPrefix,
    tags: { Environment: envName, Project: 'PawsitiveMileage', ManagedBy: 'CDK' },
  };
}
