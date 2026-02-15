#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { getEnvironmentConfig } from '../lib/config.js';
import { applyTags } from '../lib/tags.js';
import { AuthStack } from '../lib/stacks/auth-stack.js';
import { DatabaseStack } from '../lib/stacks/database-stack.js';
import { StorageStack } from '../lib/stacks/storage-stack.js';
import { ApiStack } from '../lib/stacks/api-stack.js';
import { FrontendStack } from '../lib/stacks/frontend-stack.js';
import { MonitoringStack } from '../lib/stacks/monitoring-stack.js';

const app = new cdk.App();

const envName = app.node.tryGetContext('environment') ?? 'test';
const config = getEnvironmentConfig(app, envName);

const stackPrefix = `PawsitiveMileage-${config.envName}`;

const authStack = new AuthStack(app, `${stackPrefix}-Auth`, { config });

const databaseStack = new DatabaseStack(app, `${stackPrefix}-Database`, { config });

const storageStack = new StorageStack(app, `${stackPrefix}-Storage`, { config });

const apiStack = new ApiStack(app, `${stackPrefix}-Api`, {
  config,
  authStack,
  databaseStack,
  storageStack,
});

const frontendStack = new FrontendStack(app, `${stackPrefix}-Frontend`, {
  config,
});

const monitoringStack = new MonitoringStack(app, `${stackPrefix}-Monitoring`, {
  config,
  apiStack,
  databaseStack,
});

// Explicit deploy ordering
// Auth, Database, Storage have no inter-dependencies — deploy in parallel
// API depends on Auth + Database + Storage (implicit via props, but be explicit)
apiStack.addDependency(authStack);
apiStack.addDependency(databaseStack);
apiStack.addDependency(storageStack);
// Frontend depends on API (needs API Gateway endpoint for CORS/config) and Storage (photos bucket must exist first)
frontendStack.addDependency(apiStack);
frontendStack.addDependency(storageStack);
// Monitoring depends on API + Database
monitoringStack.addDependency(apiStack);
monitoringStack.addDependency(databaseStack);

// Apply tags to all stacks
[authStack, databaseStack, storageStack, apiStack, frontendStack, monitoringStack].forEach(
  (stack) => applyTags(stack, config),
);

app.synth();
