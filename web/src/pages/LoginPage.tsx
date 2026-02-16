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
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center px-4">
          <span className="text-lg font-semibold">PawsitiveMileage</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
        <img
          src="/WebLogo.png"
          alt="PawsitiveMileage logo"
          className="h-44 w-44 rounded-2xl"
        />
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-3xl font-bold">PawsitiveMileage</h1>
          <p className="text-muted-foreground">
            Track your fuel economy and vehicle maintenance
          </p>
        </div>
        <button
          type="button"
          onClick={signIn}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
        >
          Sign in with Google
        </button>
      </main>

      <footer className="border-t py-4">
        <div className="container mx-auto flex flex-col items-center gap-2 px-4 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <span>&copy; {new Date().getFullYear()} PawsitiveMileage. All rights reserved.</span>
          <nav className="flex gap-4" aria-label="Footer">
            <a href="/privacy" className="hover:text-foreground transition-colors">
              Privacy Policy
            </a>
            <a href="/terms" className="hover:text-foreground transition-colors">
              Terms of Service
            </a>
            {import.meta.env.VITE_SOURCE_CODE_URL && (
              <a href={import.meta.env.VITE_SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                Source Code
              </a>
            )}
          </nav>
        </div>
      </footer>
    </div>
  );
}
