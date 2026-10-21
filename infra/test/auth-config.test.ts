import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/stacks/auth-stack.js';
import { FrontendStack } from '../lib/stacks/frontend-stack.js';
import { getEnvironmentConfig } from '../lib/config.js';

const CERT_ARN = 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert';

const BASE_CONTEXT: Record<string, string> = {
  account: '123456789012',
  frontendDomain: 'staging.example.app',
  apiDomain: 'api-staging.example.app',
  authDomain: 'auth-staging.example.app',
  googleClientSecretArn: 'test/google-secret',
  authCertificateArn: CERT_ARN,
  frontendCertificateArn: CERT_ARN,
};

function makeApp(context: Record<string, string> = BASE_CONTEXT): cdk.App {
  return new cdk.App({ context });
}

describe('getEnvironmentConfig', () => {
  it('pins the configured account and auth domain', () => {
    const config = getEnvironmentConfig(makeApp(), 'staging');
    expect(config.account).toBe('123456789012');
    expect(config.authDomain).toBe('auth-staging.example.app');
  });

  it.each(['account', 'frontendDomain', 'apiDomain', 'authDomain'])('requires %s context', (key) => {
    const { [key]: _omitted, ...context } = BASE_CONTEXT;
    expect(() => getEnvironmentConfig(makeApp(context), 'staging')).toThrow(key);
  });

  it('rejects a malformed account ID', () => {
    expect(() => getEnvironmentConfig(makeApp({ ...BASE_CONTEXT, account: 'abc' }), 'staging')).toThrow('12-digit');
  });
});

describe('AuthStack', () => {
  function authTemplate(envName: 'staging' | 'production' = 'staging'): Template {
    const app = makeApp();
    const config = getEnvironmentConfig(app, envName);
    const stack = new AuthStack(app, 'Auth', { config, env: { account: config.account, region: 'us-east-1' } });
    return Template.fromStack(stack);
  }

  it('protects the production user pool from deletion and keeps it on stack delete', () => {
    const pools = authTemplate('production').findResources('AWS::Cognito::UserPool');
    const [pool] = Object.values(pools);
    expect(pool.Properties.DeletionProtection).toBe('ACTIVE');
    expect(pool.DeletionPolicy).toBe('Retain');
  });

  it('leaves non-production user pools deletable', () => {
    const [pool] = Object.values(authTemplate('staging').findResources('AWS::Cognito::UserPool'));
    expect(pool.Properties.DeletionProtection).toBe('INACTIVE');
    expect(pool.DeletionPolicy).toBe('Delete');
  });

  it('serves the Hosted UI on the custom auth domain with the ACM certificate', () => {
    authTemplate().hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'auth-staging.example.app',
      CustomDomainConfig: { CertificateArn: CERT_ARN },
    });
  });

  it('registers the frontend domain as OAuth callback and logout URL', () => {
    authTemplate().hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: Match.arrayWith(['https://staging.example.app/callback']),
      LogoutURLs: Match.arrayWith(['https://staging.example.app']),
    });
  });

  it('adds public PKCE clients for Android and the CLI with identity scopes only (#22)', () => {
    const clients = Object.values(authTemplate('staging').findResources('AWS::Cognito::UserPoolClient'))
      .map((c) => c.Properties as { ClientName: string; GenerateSecret?: boolean; AllowedOAuthFlows: string[]; AllowedOAuthScopes: string[]; CallbackURLs: string[] });
    const byName = Object.fromEntries(clients.map((c) => [c.ClientName, c]));
    expect(Object.keys(byName).sort()).toEqual([
      'pawsitivemileage-staging-android-client', 'pawsitivemileage-staging-app-client', 'pawsitivemileage-staging-cli-client',
    ]);
    for (const name of ['android', 'cli']) {
      const client = byName[`pawsitivemileage-staging-${name}-client`];
      expect(client.GenerateSecret, name).toBe(false);
      expect(client.AllowedOAuthFlows, name).toEqual(['code']);
      expect(client.AllowedOAuthScopes.sort(), name).toEqual(['email', 'openid', 'profile']);
    }
    expect(byName['pawsitivemileage-staging-android-client'].CallbackURLs).toEqual(['app.pawsitivemileage.staging://callback']);
    expect(byName['pawsitivemileage-staging-cli-client'].CallbackURLs).toEqual(['http://localhost:47815/callback']);
  });

  it('gives production Android its own redirect scheme and puts every client in the JWT audience', () => {
    const app = makeApp();
    const config = getEnvironmentConfig(app, 'production');
    const stack = new AuthStack(app, 'Auth', { config, env: { account: config.account, region: 'us-east-1' } });
    expect(stack.jwtAudience).toHaveLength(3);
    Template.fromStack(stack).hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'pawsitivemileage-production-android-client',
      CallbackURLs: ['app.pawsitivemileage://callback'],
    });
  });

  it('requires authCertificateArn context', () => {
    const { authCertificateArn: _omitted, ...context } = BASE_CONTEXT;
    const app = makeApp(context);
    const config = getEnvironmentConfig(app, 'staging');
    expect(() => new AuthStack(app, 'Auth', { config })).toThrow('authCertificateArn');
  });
});

describe('FrontendStack', () => {
  it('allows the auth domain in CSP connect-src', () => {
    const app = makeApp();
    const config = getEnvironmentConfig(app, 'staging');
    const stack = new FrontendStack(app, 'Frontend', { config, env: { account: config.account, region: 'us-east-1' } });
    Template.fromStack(stack).hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: {
          ContentSecurityPolicy: {
            ContentSecurityPolicy: Match.stringLikeRegexp('connect-src [^;]*https://auth-staging\\.example\\.app'),
          },
        },
      },
    });
  });
});
