import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config.js';

export interface AuthStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
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

    // Cognito domain prefix must NOT contain "aws" (even as substring).
    // "pawsitivemileage" contains "p-aws-itive", so we use a separate prefix (resolved from config).
    const cognitoDomainPrefix = config.cognitoDomainPrefix;

    this.userPoolDomain = this.userPool.addDomain('HostedUIDomain', {
      cognitoDomain: {
        domainPrefix: cognitoDomainPrefix,
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

    // JWT configuration for API Gateway authorizer
    this.jwtIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`;
    this.jwtAudience = [this.userPoolClient.userPoolClientId];

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'HostedUIDomain', { value: this.userPoolDomain.domainName });
    new cdk.CfnOutput(this, 'JwtIssuer', { value: this.jwtIssuer });
  }
}
