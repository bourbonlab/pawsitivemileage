import { useNavigate } from 'react-router';
import { Car } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Vehicle } from '@/types';

interface VehicleCardProps {
  vehicle: Vehicle;
  className?: string;
}

export function VehicleCard({ vehicle, className }: VehicleCardProps) {
  const navigate = useNavigate();

  return (
    <Card
      className={cn(
        'cursor-pointer transition-shadow hover:shadow-md',
        className,
      )}
      onClick={() => navigate(`/vehicles/${vehicle.vehicleId}`)}
      role="link"
      tabIndex={0}
      aria-label={`View ${vehicle.nickname}`}
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
              src={`${import.meta.env.VITE_PHOTOS_URL ?? ''}/${vehicle.photoKey}`}
              alt={vehicle.nickname}
              className="size-full object-cover"
            />
          ) : (
            <Car className="size-8 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{vehicle.nickname}</p>
          <p className="truncate text-sm text-muted-foreground">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
