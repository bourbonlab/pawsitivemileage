import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DatabaseStack } from '../lib/stacks/database-stack.js';
import { StorageStack } from '../lib/stacks/storage-stack.js';
import { EnvironmentConfig } from '../lib/config.js';

const TABLE = 'AWS::DynamoDB::GlobalTable';
const BUCKET = 'AWS::S3::Bucket';

function makeConfig(envName: EnvironmentConfig['envName']): EnvironmentConfig {
  return {
    envName,
    frontendDomain: 'app.example.com',
    apiDomain: 'api.example.com',
    resourcePrefix: `pawsitivemileage-${envName}`,
    cognitoDomainPrefix: `pmileage-${envName}`,
    enableMonitoring: false,
    tags: { Environment: envName, Project: 'PawsitiveMileage', ManagedBy: 'CDK' },
  };
}

const ENV = { account: '123456789012', region: 'us-east-1' };

function databaseStack(envName: EnvironmentConfig['envName']): DatabaseStack {
  const app = new cdk.App();
  return new DatabaseStack(app, `Db-${envName}`, { config: makeConfig(envName), env: ENV });
}

function storageStack(envName: EnvironmentConfig['envName']): StorageStack {
  const app = new cdk.App();
  return new StorageStack(app, `Storage-${envName}`, { config: makeConfig(envName), env: ENV });
}

describe('DatabaseStack', () => {
  it('defines all six DynamoDB tables', () => {
    Template.fromStack(databaseStack('production')).resourceCountIs(TABLE, 6);
  });

  it('enables point-in-time recovery on every table', () => {
    const template = Template.fromStack(databaseStack('production'));
    const tables = template.findResources(TABLE);
    expect(Object.keys(tables)).toHaveLength(6);
    for (const table of Object.values(tables)) {
      const replicas = table.Properties.Replicas as Array<Record<string, unknown>>;
      const pitrEnabled = replicas.every(
        (r) => (r.PointInTimeRecoverySpecification as { PointInTimeRecoveryEnabled?: boolean })
          ?.PointInTimeRecoveryEnabled === true,
      );
      expect(pitrEnabled).toBe(true);
    }
  });

  it('retains tables (and replaces-in-place safely) in production', () => {
    const tables = Template.fromStack(databaseStack('production')).findResources(TABLE);
    for (const table of Object.values(tables)) {
      expect(table.DeletionPolicy).toBe('Retain');
      expect(table.UpdateReplacePolicy).toBe('Retain');
    }
  });

  it('destroys tables in non-production so ephemeral envs tear down cleanly', () => {
    const tables = Template.fromStack(databaseStack('test')).findResources(TABLE);
    for (const table of Object.values(tables)) {
      expect(table.DeletionPolicy).toBe('Delete');
    }
  });

  it('enables stack termination protection only in production', () => {
    expect(databaseStack('production').terminationProtection).toBe(true);
    expect(databaseStack('test').terminationProtection).toBe(false);
  });
});

describe('StorageStack', () => {
  it('blocks all public access and encrypts every bucket', () => {
    const template = Template.fromStack(storageStack('production'));
    const buckets = template.findResources(BUCKET);
    expect(Object.keys(buckets).length).toBeGreaterThan(0);

    template.allResourcesProperties(BUCKET, {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.anyValue(),
      }),
    });
  });

  it('retains buckets in production', () => {
    const buckets = Template.fromStack(storageStack('production')).findResources(BUCKET);
    for (const bucket of Object.values(buckets)) {
      expect(bucket.DeletionPolicy).toBe('Retain');
    }
  });
});
