import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowLeft, Loader2, LogOut, Trash2, User, ShieldCheck,
  Users, Wrench, BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/auth/AuthProvider';
import { apiClient } from '@/api/client';

export default function AccountPage() {
  const { user, isAdmin, isLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await signOut();
      navigate('/login');
    } catch {
      setIsLoggingOut(false);
    }
  }

  async function handleDeleteAccount() {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await apiClient('/v1/user/profile', { method: 'DELETE' });
      await signOut();
      navigate('/login');
    } catch {
      setDeleteError('Failed to delete account. Please try again.');
      setIsDeleting(false);
    }
  }

  function handleCloseDeleteDialog() {
    if (isDeleting) return;
    setShowDeleteDialog(false);
    setDeleteConfirmText('');
    setDeleteError(null);
  }

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <div className="flex items-center justify-center py-24" role="status">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading account…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto p-4">
        <p className="py-16 text-center text-sm text-muted-foreground">
          Unable to load account information.
        </p>
      </div>
    );
  }

  const canDelete = deleteConfirmText === 'DELETE';

  return (
    <div className="container mx-auto max-w-2xl space-y-6 p-4">
      {/* Back button */}
      <Button variant="ghost" size="sm" asChild>
        <Link to="/garage">
          <ArrowLeft className="size-4" /> Back to Garage
        </Link>
      </Button>

      {/* Page header */}
      <div className="flex items-center gap-2">
        <User className="size-6 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold">Account Settings</h1>
      </div>

      {/* Profile section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <User className="size-6 text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-lg font-medium">{user.displayName}</p>
                {isAdmin && (
                  <Badge variant="secondary" className="shrink-0">
                    <ShieldCheck className="mr-1 size-3" aria-hidden="true" />
                    Admin
                  </Badge>
                )}
              </div>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin links */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Administration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to="/admin/users">
                <Users className="size-4" /> User Management
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to="/admin/schemas">
                <Wrench className="size-4" /> Maintenance Schemas
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link to="/admin/stats">
                <BarChart3 className="size-4" /> Platform Stats
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Logout */}
      <Card>
        <CardContent className="p-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            {isLoggingOut ? 'Signing out…' : 'Sign Out'}
          </Button>
        </CardContent>
      </Card>

      <Separator />

      {/* Danger zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>
          <Button
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="size-4" />
            Delete Account
          </Button>
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={handleCloseDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              This will permanently delete your account and all associated data including:
            </DialogDescription>
          </DialogHeader>

          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            <li>All vehicles in your garage</li>
            <li>All fuel fillup records</li>
            <li>All maintenance records</li>
            <li>All uploaded photos and receipts</li>
          </ul>

          <p className="text-sm font-medium">
            Type <span className="font-mono text-destructive">DELETE</span> to confirm.
          </p>

          <div>
            <Label htmlFor="delete-confirm" className="sr-only">
              Type DELETE to confirm
            </Label>
            <Input
              id="delete-confirm"
              placeholder="Type DELETE to confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={isDeleting}
              autoComplete="off"
            />
          </div>

          {deleteError && (
            <p className="text-sm text-destructive" role="alert">{deleteError}</p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCloseDeleteDialog}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={!canDelete || isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete My Account'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
