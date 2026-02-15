import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvironmentConfig } from './config.js';

/**
 * Apply standard tags (Environment, Project, ManagedBy) to all resources in a scope.
 */
export function applyTags(scope: Construct, config: EnvironmentConfig): void {
  for (const [key, value] of Object.entries(config.tags)) {
    cdk.Tags.of(scope).add(key, value);
  }
}
