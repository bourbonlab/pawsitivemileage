import { useState } from 'react';
import { Plus, Loader2, Car } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VehicleCard } from '@/components/VehicleCard';
import { useVehicles, useCreateVehicle } from '@/api/vehicles';

export default function GaragePage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const activeQuery = useVehicles('active');
  const archivedQuery = useVehicles('archived');

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Garage</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> Add Vehicle
            </Button>
          </DialogTrigger>
          <AddVehicleDialog onClose={() => setDialogOpen(false)} />
        </Dialog>
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <VehicleGrid
            vehicles={activeQuery.data}
            isLoading={activeQuery.isLoading}
            isError={activeQuery.isError}
            emptyMessage="No vehicles yet. Add your first vehicle to get started!"
          />
        </TabsContent>

        <TabsContent value="archived">
          <VehicleGrid
            vehicles={archivedQuery.data}
            isLoading={archivedQuery.isLoading}
            isError={archivedQuery.isError}
            emptyMessage="No archived vehicles."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Vehicle Grid                                                       */
/* ------------------------------------------------------------------ */

import type { Vehicle } from '@/types';

interface VehicleGridProps {
  vehicles: Vehicle[] | undefined;
  isLoading: boolean;
  isError: boolean;
  emptyMessage: string;
}

function VehicleGrid({ vehicles, isLoading, isError, emptyMessage }: VehicleGridProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" role="status">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading vehicles…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-16 text-center text-sm text-destructive" role="alert">
        Failed to load vehicles. Please try again.
      </p>
    );
  }

  if (!vehicles?.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
        <Car className="size-10" aria-hidden="true" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-3">
      {vehicles.map((v) => (
        <VehicleCard key={v.vehicleId} vehicle={v} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Vehicle Dialog                                                 */
/* ------------------------------------------------------------------ */

function AddVehicleDialog({ onClose }: { onClose: () => void }) {
  const createVehicle = useCreateVehicle();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const nickname = (fd.get('nickname') as string).trim();
    const make = (fd.get('make') as string).trim();
    const model = (fd.get('model') as string).trim();
    const yearStr = (fd.get('year') as string).trim();

    if (!nickname || !make || !model || !yearStr) return;

    createVehicle.mutate(
      { nickname, make, model, year: Number(yearStr) },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Add Vehicle</DialogTitle>
        <DialogDescription>
          Enter your vehicle details. You can add more info later.
        </DialogDescription>
      </DialogHeader>

      <form id="add-vehicle-form" onSubmit={handleSubmit} className="grid gap-4 py-2">
        <div className="grid gap-1.5">
          <Label htmlFor="nickname">Nickname</Label>
          <Input id="nickname" name="nickname" placeholder="e.g. Daily Driver" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="make">Make</Label>
          <Input id="make" name="make" placeholder="e.g. Toyota" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="model">Model</Label>
          <Input id="model" name="model" placeholder="e.g. Camry" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="year">Year</Label>
          <Input
            id="year"
            name="year"
            type="number"
            min={1900}
            max={new Date().getFullYear() + 2}
            placeholder="e.g. 2024"
            required
          />
        </div>
      </form>

      <DialogFooter>
        <Button
          type="submit"
          form="add-vehicle-form"
          disabled={createVehicle.isPending}
        >
          {createVehicle.isPending && <Loader2 className="animate-spin" />}
          {createVehicle.isPending ? 'Adding…' : 'Add Vehicle'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
