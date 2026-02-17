import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config.js';

export interface DatabaseStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class DatabaseStack extends cdk.Stack {
  public readonly usersTable: dynamodb.TableV2;
  public readonly vehiclesTable: dynamodb.TableV2;
  public readonly fillupsTable: dynamodb.TableV2;
  public readonly maintenanceTable: dynamodb.TableV2;
  public readonly schemasTable: dynamodb.TableV2;
  public readonly sharingTable: dynamodb.TableV2;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config } = props;
    const removalPolicy = config.envName === 'production'
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // Enable termination protection on stateful stacks
    if (config.envName === 'production') {
      this.terminationProtection = true;
    }

    // Users Table — PK: userId, GSI1: GSI1PK("USERS") / GSI1SK(createdAt)
    this.usersTable = new dynamodb.TableV2(this, 'UsersTable', {
      tableName: `pawsitivemileage-users-${config.envName}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // Vehicles Table — PK: userId, SK: vehicleId, GSI1: GSI1PK("VEHICLES") / GSI1SK(createdAt)
    this.vehiclesTable = new dynamodb.TableV2(this, 'VehiclesTable', {
      tableName: `pawsitivemileage-vehicles-${config.envName}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'vehicleId', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // Fillups Table — PK: vehicleId, SK: fillupDate#fillupId
    // GSI1: PK=userId, SK=date | GSI2: PK="FILLUPS", SK=date
    this.fillupsTable = new dynamodb.TableV2(this, 'FillupsTable', {
      tableName: `pawsitivemileage-fillups-${config.envName}`,
      partitionKey: { name: 'vehicleId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'fillupDateId', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
        },
        {
          indexName: 'GSI2',
          partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // Maintenance Table — PK: vehicleId, SK: serviceDate#recordId
    // GSI1: PK=userId, SK=datePerformed
    this.maintenanceTable = new dynamodb.TableV2(this, 'MaintenanceTable', {
      tableName: `pawsitivemileage-maintenance-${config.envName}`,
      partitionKey: { name: 'vehicleId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'serviceDateId', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // Schemas Table — PK: schemaId (no sort key)
    this.schemasTable = new dynamodb.TableV2(this, 'SchemasTable', {
      tableName: `pawsitivemileage-schemas-${config.envName}`,
      partitionKey: { name: 'schemaId', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    // Sharing Table — PK: ownerUserId, SK: vehicleId#sharedEmail
    // GSI1: PK=sharedEmail, SK=vehicleId
    this.sharingTable = new dynamodb.TableV2(this, 'SharingTable', {
      tableName: `pawsitivemileage-sharing-${config.envName}`,
      partitionKey: { name: 'ownerUserId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'vehicleEmailKey', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'UsersTableName', { value: this.usersTable.tableName });
    new cdk.CfnOutput(this, 'VehiclesTableName', { value: this.vehiclesTable.tableName });
    new cdk.CfnOutput(this, 'FillupsTableName', { value: this.fillupsTable.tableName });
    new cdk.CfnOutput(this, 'MaintenanceTableName', { value: this.maintenanceTable.tableName });
    new cdk.CfnOutput(this, 'SchemasTableName', { value: this.schemasTable.tableName });
    new cdk.CfnOutput(this, 'SharingTableName', { value: this.sharingTable.tableName });
  }
}
