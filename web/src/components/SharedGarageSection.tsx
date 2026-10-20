import { useNavigate } from 'react-router';
import { Users, Car, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useSharedVehicles } from '@/api/sharing';
import { permissionLabel, permissionVariant } from '@/lib/sharing';
import type { SharedVehicle } from '@/types';

function SharedVehicleCard({ item }: { item: SharedVehicle }) {
  const navigate = useNavigate();
  const { vehicle, ownerDisplayName, permission } = item;

  return (
    <Card
      className={cn('cursor-pointer transition-shadow hover:shadow-md')}
      onClick={() => navigate(`/vehicles/${vehicle.vehicleId}`)}
      role="link"
      tabIndex={0}
      aria-label={`View shared vehicle ${vehicle.nickname}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/vehicles/${vehicle.vehicleId}`);
        }
      }}
    >
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {vehicle.photoKey ? (
            <img
              src={`/photos/${vehicle.photoKey}`}
              alt={vehicle.nickname}
              className="size-full object-cover"
            />
          ) : (
            <Car className="size-8 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{vehicle.nickname}</p>
            <Badge variant={permissionVariant[permission]}>
              {permissionLabel[permission]}
            </Badge>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            Shared by {ownerDisplayName}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SharedGarageSection() {
  const { data: sharedVehicles, isLoading, isError } = useSharedVehicles();

  return (
    <div className="mt-8">
      <Separator className="mb-6" />
      <div className="mb-4 flex items-center gap-2">
        <Users className="size-5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Shared with You</h2>
      </div>

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
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <Users className="size-10" aria-hidden="true" />
          <p className="text-sm">No vehicles have been shared with you</p>
        </div>
      )}

      {!isLoading && !isError && !!sharedVehicles?.length && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sharedVehicles.map((sv) => (
            <SharedVehicleCard key={sv.shareId} item={sv} />
          ))}
        </div>
      )}
    </div>
  );
}
