import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { GitHubAccessStack } from '../lib/stacks/github-access-stack.js';

const ROLE = 'AWS::IAM::Role';
const POLICY = 'AWS::IAM::Policy';

function template(): Template {
  const app = new cdk.App();
  const stack = new GitHubAccessStack(app, 'GitHubAccess', {
    env: { account: '123456789012', region: 'us-east-1' },
    githubRepo: 'owner/repo',
    resourcePrefix: 'prefix',
    environments: ['staging', 'production'],
  });
  return Template.fromStack(stack);
}

type Statement = { Action: string | string[]; Resource: unknown; Effect: string };

function roleStatements(t: Template, roleName: string): Statement[] {
  const roles = t.findResources(ROLE, { Properties: { RoleName: roleName } });
  const [roleId] = Object.keys(roles);
  const policies = t.findResources(POLICY, {
    Properties: { Roles: [{ Ref: roleId }] },
  });
  return Object.values(policies).flatMap(
    (p) => p.Properties.PolicyDocument.Statement as Statement[],
  );
}

describe('GitHubAccessStack', () => {
  it('creates the GitHub OIDC provider for STS, retained on stack deletion', () => {
    const t = template();
    t.hasResource('AWS::IAM::OIDCProvider', {
      Properties: {
        Url: 'https://token.actions.githubusercontent.com',
        ClientIdList: ['sts.amazonaws.com'],
      },
      DeletionPolicy: 'Retain',
    });
  });

  it.each(['staging', 'production'])(
    'lets only the %s GitHub environment of the repo assume its role',
    (envName) => {
      template().hasResourceProperties(ROLE, {
        RoleName: `prefix-github-deploy-${envName}`,
        AssumeRolePolicyDocument: {
          Statement: [
            Match.objectLike({
              Action: ['sts:AssumeRoleWithWebIdentity', 'sts:TagSession'],
              Condition: {
                StringEquals: {
                  'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                  'token.actions.githubusercontent.com:sub': `repo:owner/repo:environment:${envName}`,
                },
              },
            }),
          ],
        },
      });
    },
  );

  it('never matches the subject claim with a wildcard', () => {
    const roles = template().findResources(ROLE);
    for (const role of Object.values(roles)) {
      const json = JSON.stringify(role.Properties.AssumeRolePolicyDocument);
      expect(json).not.toContain('StringLike');
      expect(json).not.toContain('*');
    }
  });

  it('scopes each role to its own environment resources', () => {
    const statements = roleStatements(template(), 'prefix-github-deploy-staging');
    const resources = JSON.stringify(statements.map((s) => s.Resource));
    expect(resources).toContain('prefix-staging-frontend');
    expect(resources).toContain('PawsitiveMileage-staging-*');
    expect(resources).not.toContain('production');
  });

  it('grants no IAM actions or wildcard actions directly', () => {
    for (const roleName of ['prefix-github-deploy-staging', 'prefix-github-deploy-production']) {
      const actions = roleStatements(template(), roleName).flatMap((s) => [s.Action].flat());
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action).not.toMatch(/^iam:/);
        expect(action).not.toContain('*');
      }
    }
  });
});
