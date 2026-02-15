import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let docClient: DynamoDBDocumentClient | null = null;

/**
 * Returns a singleton DynamoDB Document Client.
 * Reused across invocations within the same Lambda container.
 */
export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const client = new DynamoDBClient({});
    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

/**
 * Resolve a DynamoDB table name from environment variables.
 * Throws if the variable is not set.
 */
export function getTableName(envVar: string): string {
  const name = process.env[envVar];
  if (!name) {
    throw new Error(`Missing environment variable: ${envVar}`);
  }
  return name;
}
