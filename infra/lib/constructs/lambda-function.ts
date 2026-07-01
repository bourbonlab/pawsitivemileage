import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppFunctionProps {
  config: EnvironmentConfig;
  /** Handler file name without extension, e.g. 'vehicleCrud' */
  handlerFile: string;
  /** Exported handler function name, defaults to 'handler' */
  handlerExport?: string;
  /** Additional environment variables */
  environment?: Record<string, string>;
  /** Memory size in MB, defaults to 256 */
  memorySize?: number;
  /** Timeout in seconds, defaults to 30 */
  timeout?: number;
  /** Description for the function */
  description?: string;
}

export class AppFunction extends Construct {
  public readonly function: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: AppFunctionProps) {
    super(scope, id);

    const { config, handlerFile, handlerExport = 'handler', environment = {}, memorySize = 256, timeout = 30, description } = props;

    const projectRoot = path.join(__dirname, '..', '..', '..');

    this.function = new lambdaNodejs.NodejsFunction(this, 'Function', {
      functionName: `${config.resourcePrefix}-${handlerFile}`,
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(projectRoot, 'api', 'src', 'handlers', `${handlerFile}.ts`),
      handler: handlerExport,
      projectRoot,
      // Single hoisted lockfile at the monorepo root (npm workspaces).
      depsLockFilePath: path.join(projectRoot, 'package-lock.json'),
      memorySize,
      timeout: cdk.Duration.seconds(timeout),
      description,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        ENVIRONMENT: config.envName,
        ...environment,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node24',
        format: lambdaNodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        esbuildArgs: { '--tree-shaking': 'true' },
      },
      logGroup: new logs.LogGroup(this, 'LogGroup', {
        logGroupName: `/aws/lambda/${config.resourcePrefix}-${handlerFile}`,
        retention: config.envName === 'production'
          ? logs.RetentionDays.THREE_MONTHS
          : logs.RetentionDays.ONE_WEEK,
        removalPolicy: config.envName === 'production'
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      }),
      tracing: lambda.Tracing.ACTIVE,
    });
  }
}
