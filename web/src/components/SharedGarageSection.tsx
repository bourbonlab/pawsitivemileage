import { Users, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { VehicleCard } from '@/components/VehicleCard';
import { useSharedVehicles } from '@/api/sharing';
import { permissionLabel } from '@/lib/sharing';

export function SharedGarageSection() {
  const { data: sharedVehicles, isLoading, isError } = useSharedVehicles();

  return (
    <section className="mt-10" aria-labelledby="shared-heading">
      <h2 id="shared-heading" className="mb-3 text-lg font-bold tracking-tight">
        Shared with you
      </h2>

      {isLoading && (
        <div className="flex items-center justify-center py-12" role="status">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading shared vehicles…</span>
        </div>
      )}

      {isError && (
        <p className="py-12 text-center text-sm text-destructive" role="alert">
          Failed to load shared vehicles. Please try again.
        </p>
      )}

      {!isLoading && !isError && !sharedVehicles?.length && (
        <div className="flex items-center gap-3 rounded-2xl bg-muted px-5 py-4 text-sm text-muted-foreground">
          <Users className="size-5 shrink-0" aria-hidden="true" />
          <p>No vehicles have been shared with you. When family adds you, their cars park here.</p>
        </div>
      )}

      {!isLoading && !isError && !!sharedVehicles?.length && (
        <div className="grid gap-4 xl:grid-cols-2">
          {sharedVehicles.map((sv) => (
            <VehicleCard
              key={sv.shareId}
              vehicle={sv.vehicle}
              note={`Shared by ${sv.ownerDisplayName}`}
              badge={<Badge variant="secondary">{permissionLabel[sv.permission]}</Badge>}
            />
          ))}
        </div>
      )}
    </section>
  );
}
