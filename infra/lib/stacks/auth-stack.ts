import * as cdk from 'aws-cdk-lib';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config.js';
import { NATIVE_SCOPES, nativeRedirects } from '../client-metadata.js';

export interface AuthStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  /** Public PKCE clients for the native apps (#22) */
  public readonly nativeClients: Record<'android' | 'cli', cognito.UserPoolClient>;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly jwtIssuer: string;
  public readonly jwtAudience: string[];

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${config.resourcePrefix}-userpool`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: config.envName === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      // RETAIN only covers stack deletion; this also blocks deleting the pool directly
      // (console/API), which would remove every user. Non-prod pools stay disposable.
      deletionProtection: config.envName === 'production',
    });

    // Google identity provider — client ID from context, secret from Secrets Manager
    const googleClientId = this.node.tryGetContext('googleClientId') ?? 'PLACEHOLDER_GOOGLE_CLIENT_ID';
    const googleSecretName = this.node.tryGetContext('googleClientSecretArn');
    if (!googleSecretName) {
      throw new Error('CDK context parameter "googleClientSecretArn" is required. Pass it via -c googleClientSecretArn=<secret-name-or-arn>');
    }
    const clientSecretValue = cdk.SecretValue.secretsManager(googleSecretName);

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
      userPool: this.userPool,
      clientId: googleClientId,
      clientSecretValue,
      scopes: ['profile', 'email', 'openid'],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        fullname: cognito.ProviderAttribute.GOOGLE_NAME,
        custom: {
          picture: cognito.ProviderAttribute.GOOGLE_PICTURE,
        },
      },
    });

    // Hosted UI on a custom domain (e.g. auth.pawsitivemileage.app) so the Google consent
    // screen shows our domain. The certificate must be in us-east-1, and Cognito requires the
    // parent domain (e.g. pawsitivemileage.app) to already resolve to an A record.
    const authCertificateArn = this.node.tryGetContext('authCertificateArn');
    if (!authCertificateArn) {
      throw new Error('CDK context parameter "authCertificateArn" is required. Pass it via -c authCertificateArn=<acm-arn>');
    }
    const authCertificate = certificatemanager.Certificate.fromCertificateArn(
      this, 'AuthCertificate', authCertificateArn,
    );

    this.userPoolDomain = this.userPool.addDomain('HostedUIDomain', {
      customDomain: {
        domainName: config.authDomain,
        certificate: authCertificate,
      },
    });

    const callbackUrls = config.envName === 'production'
      ? [`https://${config.frontendDomain}/callback`]
      : [`https://${config.frontendDomain}/callback`, 'http://localhost:5173/callback'];

    const logoutUrls = config.envName === 'production'
      ? [`https://${config.frontendDomain}`]
      : [`https://${config.frontendDomain}`, 'http://localhost:5173'];

    this.userPoolClient = this.userPool.addClient('AppClient', {
      userPoolClientName: `${config.resourcePrefix}-app-client`,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
        callbackUrls,
        logoutUrls,
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
      generateSecret: false,
    });

    // Ensure Google provider is created before the client references it
    this.userPoolClient.node.addDependency(googleProvider);

    // Native clients (#22): public (no secret), authorization code + PKCE through the Hosted UI,
    // identity scopes only. They use access tokens, which the API accepts via the authorizer's
    // client_id check; the web keeps its client and ID tokens.
    const redirects = nativeRedirects(config.envName);
    const nativeClient = (id: string, name: 'android' | 'cli') => {
      const client = this.userPool.addClient(id, {
        userPoolClientName: `${config.resourcePrefix}-${name}-client`,
        oAuth: {
          flows: { authorizationCodeGrant: true },
          scopes: NATIVE_SCOPES.map((scope) => cognito.OAuthScope.custom(scope)),
          callbackUrls: [redirects[name].callback],
          logoutUrls: [redirects[name].logout],
        },
        supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.GOOGLE],
        generateSecret: false,
        preventUserExistenceErrors: true,
      });
      client.node.addDependency(googleProvider);
      return client;
    };
    this.nativeClients = { android: nativeClient('AndroidClient', 'android'), cli: nativeClient('CliClient', 'cli') };

    // JWT configuration for API Gateway authorizer
    this.jwtIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`;
    this.jwtAudience = [this.userPoolClient, this.nativeClients.android, this.nativeClients.cli].map((c) => c.userPoolClientId);

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'AndroidClientId', { value: this.nativeClients.android.userPoolClientId });
    new cdk.CfnOutput(this, 'CliClientId', { value: this.nativeClients.cli.userPoolClientId });
    new cdk.CfnOutput(this, 'HostedUIDomain', { value: config.authDomain });
    // DNS target for the auth domain CNAME (must be DNS-only, not proxied, in CloudFlare)
    new cdk.CfnOutput(this, 'HostedUIDomainCloudFrontTarget', { value: this.userPoolDomain.cloudFrontEndpoint });
    new cdk.CfnOutput(this, 'JwtIssuer', { value: this.jwtIssuer });
  }
}
