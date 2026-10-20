import { useState } from 'react';
import { Trash2, Plus, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useVehicleShares, useCreateShare, useDeleteShare } from '@/api/sharing';
import { permissionLabel, permissionVariant, selectablePermissions as permissions } from '@/lib/sharing';
import type { SharePermission } from '@/types';

interface SharingManagementDialogProps {
  vehicleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SharingManagementDialog({
  vehicleId,
  open,
  onOpenChange,
}: SharingManagementDialogProps) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<SharePermission>('readonly');
  const [error, setError] = useState<string | null>(null);

  const { data: shares, isLoading } = useVehicleShares(vehicleId);
  const createShare = useCreateShare(vehicleId);
  const deleteShare = useDeleteShare(vehicleId);

  const handleAdd = () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setError(null);
    createShare.mutate(
      { email: trimmed, permission },
      {
        onSuccess: () => {
          setEmail('');
          setPermission('readonly');
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Failed to add share');
        },
      },
    );
  };

  const handlePermissionChange = (sharedEmail: string, newPermission: SharePermission) => {
    setError(null);
    createShare.mutate(
      { email: sharedEmail, permission: newPermission },
      {
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Failed to update permission');
        },
      },
    );
  };

  const handleDelete = (shareId: string) => {
    setError(null);
    deleteShare.mutate(
      { shareId },
      {
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Failed to remove share');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Sharing</DialogTitle>
          <DialogDescription>
            Share this vehicle with others by email address. Fuel &amp; Maintenance lets
            them add and edit fillups and maintenance; Full Access also allows CSV import.
          </DialogDescription>
        </DialogHeader>

        {/* Add share form */}
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                aria-label="Email address to share with"
              />
            </div>
            <Select
              value={permission}
              onValueChange={(v) => setPermission(v as SharePermission)}
            >
              <SelectTrigger className="w-[170px]" aria-label="Permission level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {permissions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {permissionLabel[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!email.trim() || createShare.isPending}
              aria-label="Add share"
            >
              {createShare.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Shares table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8" role="status">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="sr-only">Loading shares…</span>
          </div>
        ) : !shares?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No one has access to this vehicle yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Permission</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shares.map((share) => (
                <TableRow key={share.shareId}>
                  <TableCell className="max-w-[180px] truncate">
                    {share.sharedEmail}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={share.permission}
                      onValueChange={(v) =>
                        handlePermissionChange(share.sharedEmail, v as SharePermission)
                      }
                    >
                      <SelectTrigger className="h-7 w-[170px]" aria-label={`Permission for ${share.sharedEmail}`}>
                        <Badge variant={permissionVariant[share.permission]} className="pointer-events-none">
                          {permissionLabel[share.permission]}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {permissions.map((p) => (
                          <SelectItem key={p} value={p}>
                            {permissionLabel[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleDelete(share.shareId)}
                      disabled={deleteShare.isPending}
                      aria-label={`Remove ${share.sharedEmail}`}
                    >
                      {deleteShare.isPending ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Trash2 className="size-3" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
