import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, Loader2, Car, Upload, X } from 'lucide-react';
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
import { SharedGarageSection } from '@/components/SharedGarageSection';
import { useVehicles, useCreateVehicle } from '@/api/vehicles';
import { useSharedVehicles } from '@/api/sharing';
import { usePresignedUpload, uploadFileToS3 } from '@/api/upload';

export default function GaragePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(searchParams.get('add') === '1');

  const activeQuery = useVehicles('active');
  const archivedQuery = useVehicles('archived');
  const sharedQuery = useSharedVehicles();

  // The sidebar's "Add vehicle" links here with ?add=1
  useEffect(() => {
    if (searchParams.get('add') !== '1') return;
    setDialogOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const activeCount = activeQuery.data?.length ?? 0;
  const sharedCount = sharedQuery.data?.length ?? 0;
  const openAdd = () => setDialogOpen(true);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <Tabs defaultValue="active" className="gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Garage</h1>
            {activeQuery.data && (
              <p className="mt-1.5 text-sm text-muted-foreground sm:text-[15px]">
                {activeCount} vehicle{activeCount === 1 ? '' : 's'}
                {sharedCount > 0 && ` · ${sharedCount} shared with you`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
            </TabsList>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="ml-auto sm:ml-0">
                  <Plus /> Add vehicle
                </Button>
              </DialogTrigger>
              <AddVehicleDialog onClose={() => setDialogOpen(false)} />
            </Dialog>
          </div>
        </div>

        <TabsContent value="active">
          <VehicleGrid
            vehicles={activeQuery.data}
            isLoading={activeQuery.isLoading}
            isError={activeQuery.isError}
            emptyMessage="No vehicles yet. Add your first vehicle to get started!"
            onAdd={openAdd}
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

      <SharedGarageSection />
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Vehicle Grid                                                       */
/* ------------------------------------------------------------------ */

import type { Vehicle } from '@pawsitivemileage/sdk';

interface VehicleGridProps {
  vehicles: Vehicle[] | undefined;
  isLoading: boolean;
  isError: boolean;
  emptyMessage: string;
  /** Shows the dashed "add another" tile when set */
  onAdd?: () => void;
}

function VehicleGrid({ vehicles, isLoading, isError, emptyMessage, onAdd }: VehicleGridProps) {
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
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-16 text-muted-foreground">
        <Car className="size-10" aria-hidden="true" />
        <p className="text-sm">{emptyMessage}</p>
        {onAdd && (
          <Button variant="outline" onClick={onAdd}>
            <Plus /> Add vehicle
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {vehicles.map((v) => (
        <VehicleCard key={v.vehicleId} vehicle={v} />
      ))}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-input p-6 text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
        >
          <span className="grid size-11 place-items-center rounded-full bg-muted text-foreground">
            <Plus className="size-5" aria-hidden="true" />
          </span>
          <span className="font-semibold text-foreground">Add another vehicle</span>
          <span className="text-xs">Then import your history from a Fuelly CSV</span>
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Vehicle Dialog                                                 */
/* ------------------------------------------------------------------ */

function AddVehicleDialog({ onClose }: { onClose: () => void }) {
  const createVehicle = useCreateVehicle();
  const presignMutation = usePresignedUpload();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setPreview(URL.createObjectURL(file));
  }, []);

  const handleClearPhoto = useCallback(() => {
    setPendingFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const nickname = (fd.get('nickname') as string).trim();
    const make = (fd.get('make') as string).trim();
    const model = (fd.get('model') as string).trim();
    const yearStr = (fd.get('year') as string).trim();
    const vin = (fd.get('vin') as string).trim();
    const licensePlate = (fd.get('licensePlate') as string).trim();

    if (!nickname || !make || !model || !yearStr) return;

    setIsSaving(true);
    try {
      const vehicle = await createVehicle.mutateAsync(
        { nickname, make, model, year: Number(yearStr), ...(vin && { vin }), ...(licensePlate && { licensePlate }) },
      );

      // If a photo was selected, upload it and update the vehicle
      if (pendingFile && vehicle.vehicleId) {
        try {
          const { url, key, contentType } = await presignMutation.mutateAsync({
            uploadType: 'vehicle-photo',
            vehicleId: vehicle.vehicleId,
            file: pendingFile,
          });
          await uploadFileToS3(url, pendingFile, contentType);

          // Fire-and-forget update — vehicle is already created
          const { api } = await import('@/api/client');
          await api.updateVehicle({ params: { vehicleId: vehicle.vehicleId }, body: { photoKey: key } });
        } catch {
          // Vehicle created successfully, photo upload failed — not blocking
          console.warn('Vehicle photo upload failed, vehicle was still created');
        }
      }

      onClose();
    } catch {
      // createVehicle error is handled by TanStack Query
    } finally {
      setIsSaving(false);
    }
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
        {/* Vehicle photo */}
        <div className="grid gap-1.5">
          <Label>Vehicle Photo</Label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelect}
            className="hidden"
            aria-label="Upload vehicle photo"
          />
          {preview ? (
            <div className="relative">
              <img
                src={preview}
                alt="Vehicle preview"
                className="h-40 w-full rounded-md border object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon-xs"
                className="absolute top-1 right-1"
                onClick={handleClearPhoto}
                aria-label="Remove photo"
              >
                <X />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-28 w-full flex-col gap-1"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Vehicle Photo</span>
            </Button>
          )}
        </div>

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
        <div className="grid gap-1.5">
          <Label htmlFor="vin">VIN</Label>
          <Input id="vin" name="vin" maxLength={17} placeholder="e.g. 1HGBH41JXMN109186" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="licensePlate">License Plate</Label>
          <Input id="licensePlate" name="licensePlate" maxLength={20} placeholder="e.g. ABC-1234" />
        </div>
      </form>

      <DialogFooter>
        <Button
          type="submit"
          form="add-vehicle-form"
          disabled={isSaving}
        >
          {isSaving && <Loader2 className="animate-spin" />}
          {isSaving ? 'Adding…' : 'Add Vehicle'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
