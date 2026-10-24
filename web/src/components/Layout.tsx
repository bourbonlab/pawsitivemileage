import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Car, CircleUser, LogOut, Menu, Moon, Plus, Shield, Sun, Warehouse, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from '@/lib/useTheme';
import { useVehicles } from '@/api/vehicles';
import { useSharedVehicles } from '@/api/sharing';
import { Button } from '@/components/ui/button';
import { AppVersion } from '@/components/AppVersion';
import { cn } from '@/lib/utils';

/**
 * App shell. Desktop gets a fixed sidebar with the vehicle switcher (Night Drive layout);
 * phones get a compact top bar whose menu opens the same sidebar as a drawer.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the drawer after navigating
  useEffect(() => setDrawerOpen(false), [pathname]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <SidebarContent />
        </div>
      </aside>

      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/90 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/75 lg:hidden">
          <DialogPrimitive.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu className="size-5" />
            </Button>
          </DialogPrimitive.Trigger>
          <Brand />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 lg:hidden" />
          <DialogPrimitive.Content
            className="fixed inset-y-0 left-0 z-50 flex w-[min(85vw,300px)] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl outline-none lg:hidden"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" className="absolute top-3 right-2" aria-label="Close menu">
                <X className="size-5" />
              </Button>
            </DialogPrimitive.Close>
            <SidebarContent />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-h-[calc(100vh-3.5rem)] min-w-0 flex-col lg:min-h-screen">
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/garage" className="flex items-center gap-2.5 rounded-md px-1.5 py-1">
      <img src="/WebLogo.png" alt="" className="size-8 rounded" />
      <span className="text-[16px] font-bold tracking-tight">
        Pawsitive<span className="text-brand">Mileage</span>
      </span>
    </Link>
  );
}

function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const { isDark, toggle } = useTheme();
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  if (withLabel) {
    return (
      <SidebarButton onClick={toggle} aria-label={label}>
        {isDark ? <Sun /> : <Moon />}
        {isDark ? 'Light mode' : 'Dark mode'}
      </SidebarButton>
    );
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={label}>
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

const sidebarItem =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0';

function SidebarButton(props: React.ComponentProps<'button'>) {
  return <button type="button" {...props} className={cn(sidebarItem, props.className)} />;
}

function SidebarLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(sidebarItem, isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground')
      }
    >
      {children}
    </NavLink>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase">
      {children}
    </div>
  );
}

function VehicleThumb({ photoKey }: { photoKey?: string }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-[repeating-linear-gradient(135deg,var(--muted)_0_6px,var(--border)_6px_12px)]">
      {photoKey ? (
        <img src={`/photos/${photoKey}`} alt="" className="size-full object-cover" />
      ) : (
        <Car className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  );
}

function VehicleLink({ to, nickname, detail, photoKey }: { to: string; nickname: string; detail: string; photoKey?: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-sidebar-accent',
          isActive && 'bg-sidebar-accent',
        )
      }
    >
      <VehicleThumb photoKey={photoKey} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{nickname}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </NavLink>
  );
}

function SidebarContent() {
  const { signOut, isAdmin } = useAuth();
  const vehicles = useVehicles('active');
  const shared = useSharedVehicles();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 px-3 py-5">
      <div className="px-1">
        <Brand />
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto" aria-label="Vehicles">
        <div className="flex flex-col gap-0.5">
          <SectionLabel>My garage</SectionLabel>
          <SidebarLink to="/garage">
            <Warehouse /> All vehicles
          </SidebarLink>
          {vehicles.data?.map((v) => (
            <VehicleLink
              key={v.vehicleId}
              to={`/vehicles/${v.vehicleId}`}
              nickname={v.nickname}
              detail={`${v.year} ${v.make} ${v.model}`}
              photoKey={v.photoKey ?? undefined}
            />
          ))}
          <Link to="/garage?add=1" className={sidebarItem}>
            <Plus /> Add vehicle
          </Link>
        </div>

        <div className="flex flex-col gap-0.5">
          <SectionLabel>Shared with me</SectionLabel>
          {shared.data?.length ? (
            shared.data.map((sv) => (
              <VehicleLink
                key={sv.shareId}
                to={`/vehicles/${sv.vehicle.vehicleId}`}
                nickname={sv.vehicle.nickname}
                detail={`from ${sv.ownerDisplayName}`}
                photoKey={sv.vehicle.photoKey ?? undefined}
              />
            ))
          ) : (
            <p className="px-2.5 py-1 text-[13px] text-muted-foreground/80">Nothing yet</p>
          )}
        </div>
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-sidebar-border pt-3">
        {isAdmin && (
          <SidebarLink to="/admin/stats">
            <Shield /> Admin
          </SidebarLink>
        )}
        <SidebarLink to="/account">
          <CircleUser /> Account
        </SidebarLink>
        <ThemeToggle withLabel />
        <SidebarButton onClick={() => signOut()}>
          <LogOut /> Sign out
        </SidebarButton>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t px-4 py-4 sm:px-6 lg:px-8">
      <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground sm:flex-row sm:justify-between">
        <span>&copy; {new Date().getFullYear()} PawsitiveMileage</span>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1" aria-label="Footer">
          <Link to="/privacy" className="transition-colors hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms" className="transition-colors hover:text-foreground">
            Terms of Service
          </Link>
          <Link to="/delete-account" className="transition-colors hover:text-foreground">
            Delete account
          </Link>
          {import.meta.env.VITE_SOURCE_CODE_URL && (
            <a href={import.meta.env.VITE_SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">
              Source Code
            </a>
          )}
          <AppVersion className="transition-colors hover:text-foreground" />
        </nav>
      </div>
    </footer>
  );
}
