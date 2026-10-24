import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config.js';

export interface FrontendStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class FrontendStack extends cdk.Stack {
  public readonly frontendBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { config } = props;
    const removalPolicy = config.envName === 'production'
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;
    const autoDeleteObjects = config.envName !== 'production';

    // Frontend static hosting bucket (co-located with CloudFront to avoid cross-stack cycles)
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${config.resourcePrefix}-frontend`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy,
      autoDeleteObjects,
    });

    // Custom domain certificate (optional — requires pre-provisioned ACM cert in us-east-1)
    const frontendCertificateArn = this.node.tryGetContext('frontendCertificateArn');
    let certificate: certificatemanager.ICertificate | undefined;
    if (frontendCertificateArn) {
      certificate = certificatemanager.Certificate.fromCertificateArn(
        this, 'FrontendCertificate', frontendCertificateArn,
      );
    }

    // Photos origin — import bucket by name to avoid cross-stack circular dependency
    // (OAC modifies the source bucket's policy, which would create Storage → Frontend → Storage cycle)
    const photosBucket = s3.Bucket.fromBucketName(this, 'PhotosBucket', `${config.resourcePrefix}-photos`);
    const photosOrigin = origins.S3BucketOrigin.withOriginAccessControl(photosBucket);

    // Acknowledge that we manage the imported bucket's OAC policy manually (via Storage stack).
    // This suppresses the CDK warning about not being able to auto-update an imported bucket's policy.
    cdk.Annotations.of(this).acknowledgeWarning(
      '@aws-cdk/aws-cloudfront-origins:updateImportedBucketPolicyOac',
      'Photos bucket policy is managed in the Storage stack',
    );

    // CloudFront Function to strip /photos prefix so S3 key matches the actual object path
    const stripPhotosPrefix = new cloudfront.Function(this, 'StripPhotosPrefix', {
      comment: 'Strip /photos prefix from URI before forwarding to photos S3 bucket',
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          request.uri = request.uri.replace(/^\\/photos/, '');
          return request;
        }
      `),
      functionName: `${config.resourcePrefix}-strip-photos-prefix`,
    });

    // Security response headers policy (CSP, HSTS, X-Frame-Options, etc.)
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: `${config.resourcePrefix}-security-headers`,
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            // Cloudflare Web Analytics: the proxy injects its beacon, which reports back to cloudflareinsights.com
            "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' blob: data: https://*.tile.openstreetmap.org",
            "font-src 'self'",
            `connect-src 'self' https://${config.apiDomain} https://${config.resourcePrefix}-photos.s3.us-east-1.amazonaws.com https://cognito-idp.us-east-1.amazonaws.com https://${config.authDomain} https://cloudflareinsights.com`,
            "frame-ancestors 'none'",
          ].join('; '),
          override: true,
        },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        contentTypeOptions: {
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.seconds(31536000),
          includeSubdomains: true,
          override: true,
        },
      },
    });

    // CloudFront distribution using Origin Access Control
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `PawsitiveMileage Frontend (${config.envName})`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        responseHeadersPolicy,
      },
      additionalBehaviors: {
        '/photos/*': {
          origin: photosOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          responseHeadersPolicy,
          functionAssociations: [{
            function: stripPhotosPrefix,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      domainNames: certificate ? [config.frontendDomain] : undefined,
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // Outputs
    new cdk.CfnOutput(this, 'FrontendBucketName', { value: this.frontendBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: this.distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: certificate ? `https://${config.frontendDomain}` : `https://${this.distribution.distributionDomainName}`,
    });
  }
}
