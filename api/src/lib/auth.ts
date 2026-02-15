/**
 * Extract the authenticated userId from an API Gateway v2 JWT authorizer event.
 * Returns the Cognito `sub` claim.
 */
export function getUserId(event: { requestContext?: { authorizer?: { jwt?: { claims?: Record<string, string> } } } }): string | null {
  return event.requestContext?.authorizer?.jwt?.claims?.sub ?? null;
}
