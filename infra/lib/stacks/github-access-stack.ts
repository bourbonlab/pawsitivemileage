import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/** Default CDK bootstrap qualifier (`cdk bootstrap` without --qualifier). */
const CDK_QUALIFIER = 'hnb659fds';

const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';

export interface GitHubAccessStackProps extends cdk.StackProps {
  /** `owner/repo` allowed to assume the deploy roles. */
  githubRepo: string;
  /** Same value as RESOURCE_PREFIX in .env (without the environment suffix). */
  resourcePrefix: string;
  /** Environments to create a deploy role for; each maps to a GitHub environment of the same name. */
  environments: string[];
}

/**
 * GitHub Actions access to this account: the GitHub OIDC provider plus one deploy role per
 * environment. A role can only be assumed by a workflow job running in the GitHub environment
 * of the same name, so GitHub's environment rules (branch restriction, required reviewers)
 * decide who can deploy.
 *
 * Deployed by hand (`npm run deploy:github-access -w infra`), never by the deploy workflow,
 * so CI can't widen its own access.
 *
 * The roles deploy through the CDK bootstrap roles. The CloudFormation execution role has
 * AdministratorAccess (CDK default), so each deploy role can in effect change anything in
 * this account. Environment separation is enforced by GitHub, not by IAM.
 */
export class GitHubAccessStack extends cdk.Stack {
  public readonly deployRoles: Record<string, iam.Role> = {};

  constructor(scope: Construct, id: string, props: GitHubAccessStackProps) {
    super(scope, id, props);

    const provider = new iam.OidcProviderNative(this, 'GitHubOidcProvider', {
      url: `https://${GITHUB_OIDC_HOST}`,
      clientIds: ['sts.amazonaws.com'],
      // Shared by every workflow in the account; keep it if this stack is ever deleted.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const { account, region } = this;
    const bootstrapRoles = ['deploy', 'file-publishing', 'image-publishing', 'lookup'].map(
      (name) => `arn:aws:iam::${account}:role/cdk-${CDK_QUALIFIER}-${name}-role-${account}-${region}`,
    );

    for (const envName of props.environments) {
      const role = new iam.Role(this, `DeployRole-${envName}`, {
        roleName: `${props.resourcePrefix}-github-deploy-${envName}`,
        description: `GitHub Actions deploys of ${props.githubRepo} to ${envName}`,
        maxSessionDuration: cdk.Duration.hours(1),
        assumedBy: new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
          StringEquals: {
            [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
            [`${GITHUB_OIDC_HOST}:sub`]: `repo:${props.githubRepo}:environment:${envName}`,
          },
        }).withSessionTags(),
      });

      // cdk deploy: publish assets and run CloudFormation through the bootstrap roles
      role.addToPolicy(new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: bootstrapRoles,
      }));

      // deploy.sh: bootstrap check and stack outputs (Cognito IDs, distribution ID)
      role.addToPolicy(new iam.PolicyStatement({
        sid: 'ReadStackOutputs',
        actions: ['cloudformation:DescribeStacks'],
        resources: [
          `arn:aws:cloudformation:${region}:${account}:stack/CDKToolkit/*`,
          `arn:aws:cloudformation:${region}:${account}:stack/PawsitiveMileage-${envName}-*/*`,
        ],
      }));

      // deploy.sh: aws s3 sync web/dist/ --delete
      const frontendBucket = `arn:aws:s3:::${props.resourcePrefix}-${envName}-frontend`;
      role.addToPolicy(new iam.PolicyStatement({
        sid: 'SyncFrontendBucket',
        actions: ['s3:ListBucket'],
        resources: [frontendBucket],
      }));
      role.addToPolicy(new iam.PolicyStatement({
        sid: 'WriteFrontendObjects',
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`${frontendBucket}/*`],
      }));

      // deploy.sh: invalidate the frontend distribution. Its ID is only known from stack outputs,
      // so this covers every distribution in the account (invalidation only, no config changes).
      role.addToPolicy(new iam.PolicyStatement({
        sid: 'InvalidateFrontendCache',
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${account}:distribution/*`],
      }));

      new cdk.CfnOutput(this, `DeployRoleArn-${envName}`, {
        value: role.roleArn,
        description: `AWS_DEPLOY_ROLE_ARN for the ${envName} GitHub environment`,
      });
      this.deployRoles[envName] = role;
    }
  }
}
