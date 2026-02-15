import { useState, useMemo } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft, Loader2, Users, Search, ShieldCheck, ShieldOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAdminUsers, useToggleAdmin } from '@/api/admin';
import type { AdminUserStats } from '@/api/admin';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Never';
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatDate(iso);
}

/* ------------------------------------------------------------------ */
/*  Admin Users Page                                                   */
/* ------------------------------------------------------------------ */

export default function AdminUsersPage() {
  const { data: users, isLoading, isError } = useAdminUsers();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!users) return [];
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    );
  }, [users, search]);

  /* ---- Loading state ---- */
  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <BackButton />
        <div className="flex items-center justify-center py-24" role="status">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading users…</span>
        </div>
      </div>
    );
  }

  /* ---- Error state ---- */
  if (isError) {
    return (
      <div className="container mx-auto p-4">
        <BackButton />
        <p className="py-16 text-center text-sm text-destructive" role="alert">
          Failed to load users. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-4">
      <BackButton />

      {/* Page header */}
      <div className="flex items-center gap-2">
        <Users className="size-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-sm text-muted-foreground">
            {users?.length ?? 0} registered user{users?.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          aria-label="Search users"
        />
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <Users className="size-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {search.trim() ? 'No users match your search.' : 'No users found.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table — hidden on small screens */}
          <div className="hidden md:block">
            <UsersTable users={filtered} />
          </div>

          {/* Mobile cards — visible on small screens */}
          <div className="grid gap-3 md:hidden">
            {filtered.map((user) => (
              <UserCard key={user.userId} user={user} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Back button                                                        */
/* ------------------------------------------------------------------ */

function BackButton() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/garage">
        <ArrowLeft className="size-4" /> Back to Garage
      </Link>
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop table                                                      */
/* ------------------------------------------------------------------ */

function UsersTable({ users }: { users: AdminUserStats[] }) {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="text-center">Vehicles</TableHead>
            <TableHead className="text-center">Fillups</TableHead>
            <TableHead>Last Active</TableHead>
            <TableHead className="text-center">Admin</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.userId}>
              <TableCell className="font-medium">
                {user.displayName}
                {user.isAdmin && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">Admin</Badge>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{user.email}</TableCell>
              <TableCell className="text-center">{user.vehicleCount}</TableCell>
              <TableCell className="text-center">{user.fillupCount}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatRelative(user.lastActive)}
              </TableCell>
              <TableCell className="text-center">
                <AdminToggle user={user} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile card                                                        */
/* ------------------------------------------------------------------ */

function UserCard({ user }: { user: AdminUserStats }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {user.displayName}
              {user.isAdmin && (
                <Badge variant="secondary" className="ml-2 text-[10px]">Admin</Badge>
              )}
            </p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
          <AdminToggle user={user} />
        </div>

        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{user.vehicleCount} vehicle{user.vehicleCount !== 1 ? 's' : ''}</span>
          <span>{user.fillupCount} fillup{user.fillupCount !== 1 ? 's' : ''}</span>
        </div>

        <p className="text-xs text-muted-foreground">
          Last active: {formatRelative(user.lastActive)}
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin toggle switch                                                */
/* ------------------------------------------------------------------ */

function AdminToggle({ user }: { user: AdminUserStats }) {
  const toggleAdmin = useToggleAdmin();
  const switchId = `admin-toggle-${user.userId}`;

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={switchId}
        checked={user.isAdmin}
        disabled={toggleAdmin.isPending}
        onCheckedChange={(checked: boolean) =>
          toggleAdmin.mutate({ userId: user.userId, isAdmin: checked })
        }
        aria-label={`${user.isAdmin ? 'Remove' : 'Grant'} admin access for ${user.displayName}`}
      />
      <Label htmlFor={switchId} className="sr-only">
        Admin
      </Label>
      {user.isAdmin ? (
        <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
      ) : (
        <ShieldOff className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}
