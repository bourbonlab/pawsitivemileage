import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config.js';
import { AuthStack } from './auth-stack.js';
import { DatabaseStack } from './database-stack.js';
import { StorageStack } from './storage-stack.js';
import { AppFunction } from '../constructs/lambda-function.js';
import { CLIENT_METADATA } from '../client-metadata.js';

export interface ApiStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  authStack: AuthStack;
  databaseStack: DatabaseStack;
  storageStack: StorageStack;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly lambdaFunctions: Record<string, AppFunction>;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config, authStack, databaseStack, storageStack } = props;

    // Shared environment variables for all Lambda functions
    const sharedEnv: Record<string, string> = {
      USERS_TABLE: databaseStack.usersTable.tableName,
      VEHICLES_TABLE: databaseStack.vehiclesTable.tableName,
      FILLUPS_TABLE: databaseStack.fillupsTable.tableName,
      MAINTENANCE_TABLE: databaseStack.maintenanceTable.tableName,
      SCHEMAS_TABLE: databaseStack.schemasTable.tableName,
      SHARING_TABLE: databaseStack.sharingTable.tableName,
      IDEMPOTENCY_TABLE: databaseStack.idempotencyTable.tableName,
      PHOTOS_BUCKET: storageStack.photosBucket.bucketName,
      EXPORTS_BUCKET: storageStack.exportsBucket.bucketName,
      FRONTEND_DOMAIN: config.frontendDomain,
    };

    // Create Lambda functions
    this.lambdaFunctions = {};

    const functionDefs: Array<{ name: string; description: string; environment?: Record<string, string> }> = [
      { name: 'userProfile', description: 'User profile CRUD and account deletion' },
      { name: 'vehicleCrud', description: 'Vehicle CRUD and archive/unarchive' },
      { name: 'fillupCrud', description: 'Fillup CRUD with derived metrics calculation' },
      { name: 'maintenanceCrud', description: 'Maintenance CRUD and reminders' },
      { name: 'analytics', description: 'Analytics dashboard and year-over-year' },
      { name: 'exportData', description: 'CSV and PDF data export' },
      { name: 'presignUrl', description: 'S3 presigned URL generation' },
      { name: 'adminUsers', description: 'Admin user management' },
      { name: 'adminSchemas', description: 'Admin maintenance schema CRUD' },
      { name: 'adminStats', description: 'Admin platform statistics' },
      { name: 'importData', description: 'Fuelly CSV import and metrics recalculation' },
      { name: 'sharingCrud', description: 'Vehicle sharing CRUD and shared vehicles listing' },
      {
        name: 'meta',
        description: 'Public client metadata: minimum versions, feature flags, policy links',
        environment: {
          MIN_CLIENT_VERSIONS: JSON.stringify(CLIENT_METADATA.minimumVersions),
          FEATURE_FLAGS: JSON.stringify(CLIENT_METADATA.features),
        },
      },
    ];

    for (const def of functionDefs) {
      this.lambdaFunctions[def.name] = new AppFunction(this, `${def.name}Fn`, {
        config,
        handlerFile: def.name,
        environment: { ...sharedEnv, ...def.environment },
        description: def.description,
      });
    }

    // Grant DynamoDB permissions
    const allTables = [
      databaseStack.usersTable,
      databaseStack.vehiclesTable,
      databaseStack.fillupsTable,
      databaseStack.maintenanceTable,
      databaseStack.schemasTable,
      databaseStack.sharingTable,
    ];

    // userProfile needs Users, Vehicles, Fillups, Maintenance (for cascading delete), and S3
    databaseStack.usersTable.grantReadWriteData(this.lambdaFunctions['userProfile'].function);
    databaseStack.vehiclesTable.grantReadWriteData(this.lambdaFunctions['userProfile'].function);
    databaseStack.fillupsTable.grantReadWriteData(this.lambdaFunctions['userProfile'].function);
    databaseStack.maintenanceTable.grantReadWriteData(this.lambdaFunctions['userProfile'].function);
    storageStack.photosBucket.grantReadWrite(this.lambdaFunctions['userProfile'].function);

    // vehicleCrud needs Vehicles, Photos, Users (shared access email lookup), Sharing (shared access check)
    databaseStack.vehiclesTable.grantReadWriteData(this.lambdaFunctions['vehicleCrud'].function);
    storageStack.photosBucket.grantReadWrite(this.lambdaFunctions['vehicleCrud'].function);
    databaseStack.usersTable.grantReadData(this.lambdaFunctions['vehicleCrud'].function);
    databaseStack.sharingTable.grantReadData(this.lambdaFunctions['vehicleCrud'].function);

    // fillupCrud needs Fillups, Vehicles (ownership check), Photos, Users (shared access email lookup)
    databaseStack.fillupsTable.grantReadWriteData(this.lambdaFunctions['fillupCrud'].function);
    databaseStack.vehiclesTable.grantReadData(this.lambdaFunctions['fillupCrud'].function);
    storageStack.photosBucket.grantReadWrite(this.lambdaFunctions['fillupCrud'].function);
    databaseStack.usersTable.grantReadData(this.lambdaFunctions['fillupCrud'].function);

    // maintenanceCrud needs Maintenance, Vehicles, Schemas, Users (shared access email lookup)
    databaseStack.maintenanceTable.grantReadWriteData(this.lambdaFunctions['maintenanceCrud'].function);
    databaseStack.vehiclesTable.grantReadData(this.lambdaFunctions['maintenanceCrud'].function);
    databaseStack.schemasTable.grantReadData(this.lambdaFunctions['maintenanceCrud'].function);
    storageStack.photosBucket.grantReadWrite(this.lambdaFunctions['maintenanceCrud'].function);
    databaseStack.usersTable.grantReadData(this.lambdaFunctions['maintenanceCrud'].function);

    // analytics needs Fillups, Maintenance, Vehicles, Users (shared access email lookup), Sharing (shared access check)
    databaseStack.fillupsTable.grantReadData(this.lambdaFunctions['analytics'].function);
    databaseStack.maintenanceTable.grantReadData(this.lambdaFunctions['analytics'].function);
    databaseStack.vehiclesTable.grantReadData(this.lambdaFunctions['analytics'].function);
    databaseStack.usersTable.grantReadData(this.lambdaFunctions['analytics'].function);
    databaseStack.sharingTable.grantReadData(this.lambdaFunctions['analytics'].function);

    // exportData needs Fillups, Maintenance, Vehicles, Exports bucket, Users (shared access email lookup), Sharing (shared access check)
    databaseStack.fillupsTable.grantReadData(this.lambdaFunctions['exportData'].function);
    databaseStack.maintenanceTable.grantReadData(this.lambdaFunctions['exportData'].function);
    databaseStack.vehiclesTable.grantReadData(this.lambdaFunctions['exportData'].function);
    storageStack.exportsBucket.grantReadWrite(this.lambdaFunctions['exportData'].function);
    databaseStack.usersTable.grantReadData(this.lambdaFunctions['exportData'].function);
    databaseStack.sharingTable.grantReadData(this.lambdaFunctions['exportData'].function);

    // presignUrl needs Photos bucket, plus Vehicles, Users (shared access email lookup) and Sharing
    // to check the caller may upload for the vehicle and to key the file under the vehicle owner
    storageStack.photosBucket.grantPut(this.lambdaFunctions['presignUrl'].function);
    storageStack.photosBucket.grantRead(this.lambdaFunctions['presignUrl'].function);
    databaseStack.vehiclesTable.grantReadData(this.lambdaFunctions['presignUrl'].function);
    databaseStack.usersTable.grantReadData(this.lambdaFunctions['presignUrl'].function);
    databaseStack.sharingTable.grantReadData(this.lambdaFunctions['presignUrl'].function);

    // adminUsers needs Users table
    databaseStack.usersTable.grantReadWriteData(this.lambdaFunctions['adminUsers'].function);
    databaseStack.vehiclesTable.grantReadData(this.lambdaFunctions['adminUsers'].function);
    databaseStack.fillupsTable.grantReadData(this.lambdaFunctions['adminUsers'].function);

    // adminSchemas needs Schemas table + Users table (for checkIsAdmin)
    databaseStack.schemasTable.grantReadWriteData(this.lambdaFunctions['adminSchemas'].function);
    databaseStack.usersTable.grantReadData(this.lambdaFunctions['adminSchemas'].function);

    // importData needs Fillups, Maintenance (read/write), Vehicles (read), Photos bucket (read), Users (shared access email lookup), Sharing (shared access check)
    databaseStack.fillupsTable.grantReadWriteData(this.lambdaFunctions['importData'].function);
    databaseStack.maintenanceTable.grantReadWriteData(this.lambdaFunctions['importData'].function);
    databaseStack.vehiclesTable.grantReadData(this.lambdaFunctions['importData'].function);
    storageStack.photosBucket.grantRead(this.lambdaFunctions['importData'].function);
    databaseStack.usersTable.grantReadData(this.lambdaFunctions['importData'].function);
    databaseStack.sharingTable.grantReadData(this.lambdaFunctions['importData'].function);

    // sharingCrud needs Sharing (read/write), Users (read for email lookup), Vehicles (read for shared vehicles)
    databaseStack.sharingTable.grantReadWriteData(this.lambdaFunctions['sharingCrud'].function);
    databaseStack.usersTable.grantReadData(this.lambdaFunctions['sharingCrud'].function);
    databaseStack.vehiclesTable.grantReadData(this.lambdaFunctions['sharingCrud'].function);

    // Creates that accept an Idempotency-Key read/write the idempotency table (#24)
    for (const fn of ['fillupCrud', 'maintenanceCrud', 'vehicleCrud', 'sharingCrud']) {
      databaseStack.idempotencyTable.grantReadWriteData(this.lambdaFunctions[fn].function);
    }

    // fillupCrud and maintenanceCrud need Sharing table read for shared access checks
    databaseStack.sharingTable.grantReadData(this.lambdaFunctions['fillupCrud'].function);
    databaseStack.sharingTable.grantReadData(this.lambdaFunctions['maintenanceCrud'].function);

    // adminStats needs read access to all tables for aggregation
    for (const table of allTables) {
      table.grantReadData(this.lambdaFunctions['adminStats'].function);
    }

    // JWT Authorizer
    const jwtAuthorizer = new HttpJwtAuthorizer('CognitoAuthorizer', authStack.jwtIssuer, {
      jwtAudience: authStack.jwtAudience,
      identitySource: ['$request.header.Authorization'],
    });

    // Custom domain (optional — requires pre-provisioned ACM certificate)
    const apiCertificateArn = this.node.tryGetContext('apiCertificateArn');
    let domainName: apigwv2.DomainName | undefined;

    if (apiCertificateArn) {
      const certificate = certificatemanager.Certificate.fromCertificateArn(
        this, 'ApiCertificate', apiCertificateArn,
      );
      domainName = new apigwv2.DomainName(this, 'ApiDomainName', {
        domainName: config.apiDomain,
        certificate,
      });
    }

    // HTTP API
    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${config.resourcePrefix}-api`,
      description: `PawsitiveMileage API (${config.envName})`,
      corsPreflight: {
        allowOrigins: config.envName === 'production'
          ? [`https://${config.frontendDomain}`]
          : [`https://${config.frontendDomain}`, 'http://localhost:5173'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        // Idempotency-Key (#24), If-Match (#25) and X-Client (#23) must pass browser preflights
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'Idempotency-Key', 'If-Match', 'X-Client'],
        // Let browser JS read these response headers
        exposeHeaders: ['ETag', 'Idempotent-Replayed'],
        maxAge: cdk.Duration.hours(1),
      },
      defaultDomainMapping: domainName ? { domainName } : undefined,
    });

    // API Gateway throttling (L1 escape hatch — L2 doesn't expose throttle settings)
    const stage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingBurstLimit: 100,
      throttlingRateLimit: 50,
    };

    // Helper to create integration + route
    const addRoute = (method: apigwv2.HttpMethod, path: string, fnName: string, auth = true) => {
      const integration = new HttpLambdaIntegration(`${fnName}-${method}-${path.replace(/[\/{}]/g, '-')}`, this.lambdaFunctions[fnName].function);
      this.httpApi.addRoutes({
        path,
        methods: [method],
        integration,
        authorizer: auth ? jwtAuthorizer : undefined,
        authorizationScopes: auth ? [] : undefined,
      });
    };

    // User profile routes
    addRoute(apigwv2.HttpMethod.GET, '/v1/user/profile', 'userProfile');
    addRoute(apigwv2.HttpMethod.PUT, '/v1/user/profile', 'userProfile');
    addRoute(apigwv2.HttpMethod.DELETE, '/v1/user/profile', 'userProfile');

    // Vehicle routes
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles', 'vehicleCrud');
    addRoute(apigwv2.HttpMethod.POST, '/v1/vehicles', 'vehicleCrud');
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}', 'vehicleCrud');
    addRoute(apigwv2.HttpMethod.PUT, '/v1/vehicles/{vehicleId}', 'vehicleCrud');
    addRoute(apigwv2.HttpMethod.PATCH, '/v1/vehicles/{vehicleId}/archive', 'vehicleCrud');

    // Fillup routes
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}/fillups', 'fillupCrud');
    addRoute(apigwv2.HttpMethod.POST, '/v1/vehicles/{vehicleId}/fillups', 'fillupCrud');
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}/fillups/{fillupId}', 'fillupCrud');
    addRoute(apigwv2.HttpMethod.PUT, '/v1/vehicles/{vehicleId}/fillups/{fillupId}', 'fillupCrud');
    addRoute(apigwv2.HttpMethod.DELETE, '/v1/vehicles/{vehicleId}/fillups/{fillupId}', 'fillupCrud');

    // Maintenance routes
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}/maintenance', 'maintenanceCrud');
    addRoute(apigwv2.HttpMethod.POST, '/v1/vehicles/{vehicleId}/maintenance', 'maintenanceCrud');
    addRoute(apigwv2.HttpMethod.PUT, '/v1/vehicles/{vehicleId}/maintenance/{recordId}', 'maintenanceCrud');
    addRoute(apigwv2.HttpMethod.DELETE, '/v1/vehicles/{vehicleId}/maintenance/{recordId}', 'maintenanceCrud');
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}/maintenance/reminders', 'maintenanceCrud');
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}/maintenance/schemas', 'maintenanceCrud');

    // Analytics routes
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}/analytics', 'analytics');
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}/analytics/yoy', 'analytics');
    addRoute(apigwv2.HttpMethod.POST, '/v1/vehicles/{vehicleId}/summary-card', 'analytics');

    // Export routes
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}/export/fillups', 'exportData');
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}/export/maintenance', 'exportData');
    addRoute(apigwv2.HttpMethod.POST, '/v1/vehicles/{vehicleId}/export/pdf', 'exportData');

    // Upload route
    addRoute(apigwv2.HttpMethod.POST, '/v1/upload/presign', 'presignUrl');

    // Admin routes
    addRoute(apigwv2.HttpMethod.GET, '/v1/admin/users', 'adminUsers');
    addRoute(apigwv2.HttpMethod.PATCH, '/v1/admin/users/{userId}/admin', 'adminUsers');
    addRoute(apigwv2.HttpMethod.GET, '/v1/admin/schemas', 'adminSchemas');
    addRoute(apigwv2.HttpMethod.POST, '/v1/admin/schemas', 'adminSchemas');
    addRoute(apigwv2.HttpMethod.PUT, '/v1/admin/schemas/{schemaId}', 'adminSchemas');
    addRoute(apigwv2.HttpMethod.PATCH, '/v1/admin/schemas/{schemaId}/active', 'adminSchemas');
    addRoute(apigwv2.HttpMethod.GET, '/v1/admin/stats', 'adminStats');

    // Import and recalculate routes
    addRoute(apigwv2.HttpMethod.POST, '/v1/vehicles/{vehicleId}/import/{type}', 'importData');
    addRoute(apigwv2.HttpMethod.POST, '/v1/vehicles/{vehicleId}/recalculate', 'importData');

    // Public client metadata (no auth: apps check it before signing in, #23)
    addRoute(apigwv2.HttpMethod.GET, '/v1/meta', 'meta', false);

    // Sharing routes
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/shared', 'sharingCrud');
    addRoute(apigwv2.HttpMethod.GET, '/v1/vehicles/{vehicleId}/sharing', 'sharingCrud');
    addRoute(apigwv2.HttpMethod.POST, '/v1/vehicles/{vehicleId}/sharing', 'sharingCrud');
    addRoute(apigwv2.HttpMethod.DELETE, '/v1/vehicles/{vehicleId}/sharing/{shareId}', 'sharingCrud');

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'ApiId', { value: this.httpApi.httpApiId });
    if (domainName) {
      new cdk.CfnOutput(this, 'ApiDomain', { value: config.apiDomain });
      new cdk.CfnOutput(this, 'ApiDomainRegionalDomainName', { value: domainName.regionalDomainName });
    }
  }
}
