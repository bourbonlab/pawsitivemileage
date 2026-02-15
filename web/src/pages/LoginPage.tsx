import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';

export default function LoginPage() {
  const { isAuthenticated, isLoading, signIn } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/garage" replace />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-bold">PawsitiveMileage</h1>
        <p className="text-muted-foreground">
          Track your fuel economy and vehicle maintenance
        </p>
      </div>
      <button
        onClick={() => signIn()}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
      >
        Sign in with Google
      </button>
    </div>
  );
}
