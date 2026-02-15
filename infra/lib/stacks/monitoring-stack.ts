import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config.js';
import { ApiStack } from './api-stack.js';
import { DatabaseStack } from './database-stack.js';

export interface MonitoringStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  apiStack: ApiStack;
  databaseStack: DatabaseStack;
}

export class MonitoringStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { config, apiStack, databaseStack } = props;

    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${config.resourcePrefix}-dashboard`,
    });

    // API Gateway metrics
    const apiMetricProps = {
      namespace: 'AWS/ApiGateway',
      dimensionsMap: { ApiId: apiStack.httpApi.httpApiId },
      period: cdk.Duration.minutes(5),
    };

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Latency (ms)',
        width: 12,
        left: [
          new cloudwatch.Metric({ ...apiMetricProps, metricName: 'Latency', statistic: 'p50', label: 'p50' }),
          new cloudwatch.Metric({ ...apiMetricProps, metricName: 'Latency', statistic: 'p95', label: 'p95' }),
          new cloudwatch.Metric({ ...apiMetricProps, metricName: 'Latency', statistic: 'p99', label: 'p99' }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'API Request Count & Errors',
        width: 12,
        left: [
          new cloudwatch.Metric({ ...apiMetricProps, metricName: 'Count', statistic: 'Sum', label: 'Requests' }),
        ],
        right: [
          new cloudwatch.Metric({ ...apiMetricProps, metricName: '4xx', statistic: 'Sum', label: '4xx Errors' }),
          new cloudwatch.Metric({ ...apiMetricProps, metricName: '5xx', statistic: 'Sum', label: '5xx Errors' }),
        ],
      }),
    );

    // Lambda metrics — cold starts and errors per function
    const lambdaWidgets: cloudwatch.IWidget[] = [];
    const coldStartMetrics: cloudwatch.IMetric[] = [];
    const errorMetrics: cloudwatch.IMetric[] = [];
    const durationMetrics: cloudwatch.IMetric[] = [];

    for (const [name, appFn] of Object.entries(apiStack.lambdaFunctions)) {
      const dims = { FunctionName: appFn.function.functionName };
      coldStartMetrics.push(new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'ColdStart',
        dimensionsMap: dims,
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
        label: name,
      }));
      errorMetrics.push(new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: dims,
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
        label: name,
      }));
      durationMetrics.push(new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        dimensionsMap: dims,
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
        label: name,
      }));
    }

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration p95 (ms)',
        width: 12,
        left: durationMetrics,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        width: 12,
        left: errorMetrics,
      }),
    );

    // DynamoDB consumed capacity
    const tables = [
      { table: databaseStack.usersTable, label: 'Users' },
      { table: databaseStack.vehiclesTable, label: 'Vehicles' },
      { table: databaseStack.fillupsTable, label: 'Fillups' },
      { table: databaseStack.maintenanceTable, label: 'Maintenance' },
      { table: databaseStack.schemasTable, label: 'Schemas' },
    ];

    const readCapacityMetrics: cloudwatch.IMetric[] = [];
    const writeCapacityMetrics: cloudwatch.IMetric[] = [];

    for (const { table, label } of tables) {
      readCapacityMetrics.push(new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ConsumedReadCapacityUnits',
        dimensionsMap: { TableName: table.tableName },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
        label,
      }));
      writeCapacityMetrics.push(new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ConsumedWriteCapacityUnits',
        dimensionsMap: { TableName: table.tableName },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
        label,
      }));
    }

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Read Capacity (units)',
        width: 12,
        left: readCapacityMetrics,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Write Capacity (units)',
        width: 12,
        left: writeCapacityMetrics,
      }),
    );

    // Outputs
    new cdk.CfnOutput(this, 'DashboardName', { value: this.dashboard.dashboardName });
  }
}
