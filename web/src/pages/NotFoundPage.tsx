import { Link } from 'react-router';
import { MapPinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center px-4">
          <Link to="/" className="flex items-center gap-2">
            <img src="/WebLogo.png" alt="PawsitiveMileage logo" className="h-8 w-8 rounded" />
            <span className="text-lg font-semibold">PawsitiveMileage</span>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <MapPinOff className="size-16 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-4xl font-bold">404</h1>
        <p className="text-lg text-muted-foreground">
          Looks like you took a wrong turn. This page doesn't exist.
        </p>
        <Button asChild className="mt-2">
          <Link to="/garage">Back to Garage</Link>
        </Button>
      </main>

      <footer className="border-t py-4">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} PawsitiveMileage. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
