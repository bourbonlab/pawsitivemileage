import { Link, useNavigate } from 'react-router';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';

export function Layout({ children }: { children: React.ReactNode }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link to="/garage" className="flex items-center gap-2">
            <img src="/WebLogo.png" alt="PawsitiveMileage logo" className="h-8 w-8 rounded" />
            <span className="text-lg font-semibold">PawsitiveMileage</span>
          </Link>
          <Button variant="ghost" size="sm" onClick={handleSignOut} aria-label="Sign out">
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t py-4">
        <div className="container mx-auto flex flex-col items-center gap-2 px-4 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <span>&copy; {new Date().getFullYear()} PawsitiveMileage. All rights reserved.</span>
          <nav className="flex gap-4" aria-label="Footer">
            <Link to="/privacy" className="hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">
              Terms of Service
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
