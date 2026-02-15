import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  getCurrentUser,
  fetchAuthSession,
  fetchUserAttributes,
  signInWithRedirect,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';

interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUserProfile = useCallback(async (idToken?: string) => {
    if (!idToken) return;
    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl) return;

    try {
      const res = await fetch(`${apiUrl}/v1/user/profile`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const json = await res.json();
        const profile = json.data ?? json;
        setIsAdmin(profile.isAdmin === true);
      }
    } catch {
      // Profile fetch failed — default to non-admin
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkAuth() {
    try {
      const currentUser = await getCurrentUser();
      const session = await fetchAuthSession();

      if (!session.tokens) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      const attrs = await fetchUserAttributes();

      const authUser: AuthUser = {
        userId: currentUser.userId,
        email: attrs.email ?? '',
        displayName: attrs.name ?? attrs.email ?? '',
      };
      setUser(authUser);

      await fetchUserProfile(session.tokens.idToken?.toString());
    } catch {
      // Not authenticated or token refresh failed — redirect handled by ProtectedRoute
      setUser(null);
      setIsAdmin(false);
    } finally {
      setIsLoading(false);
    }
  }

  const signIn = useCallback(async () => {
    try {
      await signInWithRedirect({ provider: 'Google' });
    } catch (err: unknown) {
      // If already authenticated, just re-check auth state
      if (err instanceof Error && err.name === 'UserAlreadyAuthenticatedException') {
        await checkAuth();
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = useCallback(async () => {
    setUser(null);
    setIsAdmin(false);

    // Clear local Amplify tokens/session without triggering OAuth redirect
    try {
      await amplifySignOut();
    } catch {
      // Ignore — we'll redirect manually
    }

    // Manually construct the Cognito logout URL with the correct parameters.
    // Amplify v6 sometimes sends `logout_uri` instead of `redirect_uri`,
    // which Cognito rejects with "Required String parameter 'redirect_uri' is not present".
    const domain = import.meta.env.VITE_COGNITO_DOMAIN;
    const clientId = import.meta.env.VITE_COGNITO_APP_CLIENT_ID;
    const redirectUrl = encodeURIComponent(window.location.origin);

    if (domain && clientId) {
      window.location.href =
        `https://${domain}/logout?client_id=${clientId}&logout_uri=${redirectUrl}&redirect_uri=${redirectUrl}&response_type=code`;
    } else {
      window.location.href = '/';
    }
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isAdmin,
    isLoading,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
