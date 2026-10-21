import { fetchAuthSession } from 'aws-amplify/auth';
import { createClient } from '@pawsitivemileage/sdk';

export { ApiError } from '@pawsitivemileage/sdk';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** The web signs in through Amplify and sends the Cognito ID token */
async function getIdToken(): Promise<string | undefined> {
  const session = await fetchAuthSession();
  return session.tokens?.idToken?.toString();
}

/**
 * Typed API client (#19): one method per operation in @pawsitivemileage/contracts, so paths,
 * request bodies and response types come from the contract. In development, responses are also
 * validated against it, so drift shows up as an error instead of a blank field.
 */
export const api = createClient({
  baseUrl: API_BASE,
  getToken: getIdToken,
  validateResponses: import.meta.env.DEV,
});
