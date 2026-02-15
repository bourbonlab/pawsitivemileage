import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getAuthToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'No auth token available');
  return token;
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAuthToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let requestId: string | undefined;

    try {
      const body = await res.json();
      code = body.code ?? code;
      message = body.error ?? message;
      requestId = body.requestId;
    } catch {
      // Response body wasn't JSON — use defaults
    }

    throw new ApiError(res.status, code, message, requestId);
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T;

  const json = await res.json();

  // API wraps responses in { data, requestId } — unwrap automatically
  return (json.data !== undefined ? json.data : json) as T;
}
