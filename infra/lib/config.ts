export interface EnvironmentConfig {
  envName: 'test' | 'staging' | 'production';
  frontendDomain: string;
  apiDomain: string;
  resourcePrefix: string;
  tags: Record<string, string>;
}

export const environments: Record<string, EnvironmentConfig> = {
  test: {
    envName: 'test',
    frontendDomain: 'pawsitivemileagetest.bourbonlab.net',
    apiDomain: 'pawsitivemileageapitest.bourbonlab.net',
    resourcePrefix: 'pawsitivemileage-test',
    tags: { Environment: 'test', Project: 'PawsitiveMileage', ManagedBy: 'CDK' },
  },
  staging: {
    envName: 'staging',
    frontendDomain: 'pawsitivemileagestaging.bourbonlab.net',
    apiDomain: 'pawsitivemileageapistaging.bourbonlab.net',
    resourcePrefix: 'pawsitivemileage-staging',
    tags: { Environment: 'staging', Project: 'PawsitiveMileage', ManagedBy: 'CDK' },
  },
  production: {
    envName: 'production',
    frontendDomain: 'pawsitivemileage.bourbonlab.net',
    apiDomain: 'pawsitivemileageapi.bourbonlab.net',
    resourcePrefix: 'pawsitivemileage-production',
    tags: { Environment: 'production', Project: 'PawsitiveMileage', ManagedBy: 'CDK' },
  },
};

export function getEnvironmentConfig(envName: string): EnvironmentConfig {
  const config = environments[envName];
  if (!config) {
    throw new Error(`Unknown environment: ${envName}. Valid values: ${Object.keys(environments).join(', ')}`);
  }
  return config;
}
