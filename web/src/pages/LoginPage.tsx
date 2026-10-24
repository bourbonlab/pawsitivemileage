import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { AppVersion } from '../components/AppVersion';
import { Gauge } from '../components/Instruments';

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
      <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border bg-card md:grid-cols-2">
          <div className="relative flex flex-col items-center justify-center gap-5 bg-[#171411] px-6 py-10 text-[#eeeae4] md:py-14">
            <Gauge
              fraction={0.68}
              value="32.4"
              unit="mpg"
              ticks
              label="Example fuel economy"
              color="#f0c49a"
              className="size-40 [--gauge-track:#3a332c] [--muted-foreground:#a39a8f] md:size-52"
            />
            <p className="max-w-60 text-center font-mono text-xs text-[#a39a8f]">
              Every tank, every oil change, every mile. Good boy.
            </p>
          </div>
          <div className="flex flex-col items-center justify-center gap-6 px-6 py-10 text-center md:items-start md:px-10 md:text-left">
            <img src="/WebLogo.png" alt="PawsitiveMileage logo" className="size-20 rounded-2xl" />
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Pawsitive<span className="text-brand">Mileage</span>
              </h1>
              <p className="text-muted-foreground">Track your fuel economy and vehicle maintenance.</p>
            </div>
            <button
              type="button"
              onClick={signIn}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
            >
              Sign in with Google
            </button>
          </div>
        </div>
      </main>

      <footer className="border-t py-4">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-8">
          <span>&copy; {new Date().getFullYear()} PawsitiveMileage</span>
          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1" aria-label="Footer">
            <a href="/privacy" className="hover:text-foreground transition-colors">
              Privacy Policy
            </a>
            <a href="/terms" className="hover:text-foreground transition-colors">
              Terms of Service
            </a>
            <a href="/delete-account" className="hover:text-foreground transition-colors">
              Delete account
            </a>
            {import.meta.env.VITE_SOURCE_CODE_URL && (
              <a href={import.meta.env.VITE_SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                Source Code
              </a>
            )}
            <AppVersion className="hover:text-foreground transition-colors" />
          </nav>
        </div>
      </footer>
    </div>
  );
}
