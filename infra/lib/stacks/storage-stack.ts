import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config.js';

export interface StorageStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class StorageStack extends cdk.Stack {
  public readonly photosBucket: s3.Bucket;
  public readonly exportsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;
    const removalPolicy = config.envName === 'production'
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;
    const autoDeleteObjects = config.envName !== 'production';

    // Enable termination protection on stateful stacks
    if (config.envName === 'production') {
      this.terminationProtection = true;
    }

    // Photos bucket — vehicle photos and receipt photos with presigned URL uploads
    this.photosBucket = new s3.Bucket(this, 'PhotosBucket', {
      bucketName: `${config.resourcePrefix}-photos`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy,
      autoDeleteObjects,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: config.envName === 'production'
            ? [`https://${config.frontendDomain}`]
            : [`https://${config.frontendDomain}`, 'http://localhost:5173'],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    // Allow CloudFront OAC to read photos via the frontend distribution
    // Uses account-scoped SourceArn so the Frontend stack doesn't need to pass its distribution ARN
    this.photosBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudFrontOAC',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      actions: ['s3:GetObject'],
      resources: [this.photosBucket.arnForObjects('*')],
      conditions: {
        StringEquals: {
          'AWS:SourceAccount': cdk.Stack.of(this).account,
        },
      },
    }));

    // Exports bucket — CSV and PDF exports
    this.exportsBucket = new s3.Bucket(this, 'ExportsBucket', {
      bucketName: `${config.resourcePrefix}-exports`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy,
      autoDeleteObjects,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(7),
          prefix: 'exports/',
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'PhotosBucketName', { value: this.photosBucket.bucketName });
    new cdk.CfnOutput(this, 'ExportsBucketName', { value: this.exportsBucket.bucketName });
  }
}
