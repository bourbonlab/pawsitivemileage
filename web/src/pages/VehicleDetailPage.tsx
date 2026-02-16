import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import {
  ArrowLeft, Car, Loader2, Archive, ArchiveRestore,
  BarChart3, Download, Plus, Pencil, Upload, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useVehicle, useUpdateVehicle, useArchiveVehicle } from '@/api/vehicles';
import { useFillups, useDeleteFillup, useEditFillup } from '@/api/fillups';
import { useMaintenanceRecords, useReminders, useDeleteMaintenance, useEditMaintenance } from '@/api/maintenance';
import { FillupList } from '@/components/FillupList';
import type { FillupEditData } from '@/components/FillupList';
import { FillupMap } from '@/components/FillupMap';
import { MaintenanceList } from '@/components/MaintenanceList';
import type { MaintenanceEditData } from '@/components/MaintenanceList';
import { ReminderBanner } from '@/components/ReminderBanner';
import { PhotoUpload } from '@/components/PhotoUpload';
import { ImportDialog } from '@/components/ImportDialog';
import { useRecalculateMetrics } from '@/api/import';
import type { Vehicle } from '@/types';

export default function VehicleDetailPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();

  const vehicleQuery = useVehicle(vehicleId);
  const fillupsQuery = useFillups(vehicleId);
  const maintenanceQuery = useMaintenanceRecords(vehicleId);
  const remindersQuery = useReminders(vehicleId);

  const deleteFillup = useDeleteFillup(vehicleId ?? '');
  const editFillup = useEditFillup(vehicleId ?? '');
  const deleteMaintenance = useDeleteMaintenance(vehicleId ?? '');
  const editMaintenance = useEditMaintenance(vehicleId ?? '');
  const archiveVehicle = useArchiveVehicle(vehicleId ?? '');

  const [editOpen, setEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState('');

  const recalculate = useRecalculateMetrics(vehicleId ?? '');

  if (vehicleQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-24" role="status">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading vehicle…</span>
      </div>
    );
  }

  if (vehicleQuery.isError || !vehicleQuery.data) {
    return (
      <div className="container mx-auto p-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/garage')}>
          <ArrowLeft className="size-4" /> Back to Garage
        </Button>
        <p className="py-16 text-center text-sm text-destructive" role="alert">
          Failed to load vehicle. It may have been deleted.
        </p>
      </div>
    );
  }

  const vehicle = vehicleQuery.data;

  function handleArchiveToggle() {
    archiveVehicle.mutate(!vehicle.isArchived, {
      onSuccess: () => {
        if (!vehicle.isArchived) navigate('/garage');
      },
    });
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" asChild>
        <Link to="/garage">
          <ArrowLeft className="size-4" /> Back to Garage
        </Link>
      </Button>

      {/* Vehicle header */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
            {vehicle.photoKey ? (
              <img
                src={`/photos/${vehicle.photoKey}`}
                alt={vehicle.nickname}
                className="size-full object-cover"
              />
            ) : (
              <Car className="size-10 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold truncate">{vehicle.nickname}</h1>
              {vehicle.isArchived && <Badge variant="secondary">Archived</Badge>}
            </div>
            <p className="text-muted-foreground">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="size-4" /> Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleArchiveToggle}
          disabled={archiveVehicle.isPending}
        >
          {archiveVehicle.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : vehicle.isArchived ? (
            <ArchiveRestore className="size-4" />
          ) : (
            <Archive className="size-4" />
          )}
          {vehicle.isArchived ? 'Unarchive' : 'Archive'}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/vehicles/${vehicleId}/analytics`}>
            <BarChart3 className="size-4" /> Analytics
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/vehicles/${vehicleId}/export`}>
            <Download className="size-4" /> Export
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="size-4" /> Import Data
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={recalculate.isPending}
          onClick={() => {
            setRecalcMessage('');
            recalculate.mutate(undefined, {
              onSuccess: (data) => {
                setRecalcMessage(`Recalculated ${data.recalculatedCount} fillups`);
                setTimeout(() => setRecalcMessage(''), 5000);
              },
              onError: () => {
                setRecalcMessage('Recalculation failed. Please try again.');
                setTimeout(() => setRecalcMessage(''), 5000);
              },
            });
          }}
        >
          {recalculate.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Recalculate Metrics
        </Button>
      </div>

      {/* Recalculate feedback */}
      {recalcMessage && (
        <p className={`text-sm font-medium ${recalcMessage.includes('failed') ? 'text-destructive' : 'text-green-600'}`}>
          {recalcMessage}
        </p>
      )}

      {/* Reminder banner */}
      {remindersQuery.data && remindersQuery.data.length > 0 && (
        <ReminderBanner reminders={remindersQuery.data} />
      )}

      <Separator />

      {/* Fillups section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Fillups</h2>
          <Button size="sm" asChild>
            <Link to={`/vehicles/${vehicleId}/fillups/new`}>
              <Plus className="size-4" /> Add Fillup
            </Link>
          </Button>
        </div>
        {fillupsQuery.isLoading ? (
          <div className="flex justify-center py-8" role="status">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="sr-only">Loading fillups…</span>
          </div>
        ) : fillupsQuery.isError ? (
          <p className="py-8 text-center text-sm text-destructive" role="alert">
            Failed to load fillups.
          </p>
        ) : (
          <Tabs defaultValue="list">
            <TabsList>
              <TabsTrigger value="list">List</TabsTrigger>
              <TabsTrigger value="map">Map</TabsTrigger>
            </TabsList>
            <TabsContent value="list">
              <FillupList
                fillups={fillupsQuery.data ?? []}
                vehicleId={vehicleId!}
                onDelete={(id) => deleteFillup.mutate(id)}
                onEdit={(fillupId, data) => editFillup.mutate({ fillupId, data: data as Parameters<typeof editFillup.mutate>[0]['data'] })}
                isDeleting={deleteFillup.isPending}
                isEditing={editFillup.isPending}
              />
            </TabsContent>
            <TabsContent value="map">
              <FillupMap fillups={fillupsQuery.data ?? []} />
            </TabsContent>
          </Tabs>
        )}
      </section>

      <Separator />

      {/* Maintenance section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Maintenance</h2>
          <Button size="sm" asChild>
            <Link to={`/vehicles/${vehicleId}/maintenance/new`}>
              <Plus className="size-4" /> Add Maintenance
            </Link>
          </Button>
        </div>
        {maintenanceQuery.isLoading ? (
          <div className="flex justify-center py-8" role="status">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="sr-only">Loading maintenance records…</span>
          </div>
        ) : maintenanceQuery.isError ? (
          <p className="py-8 text-center text-sm text-destructive" role="alert">
            Failed to load maintenance records.
          </p>
        ) : (
          <MaintenanceList
            records={maintenanceQuery.data ?? []}
            vehicleId={vehicleId!}
            onDelete={(id) => deleteMaintenance.mutate(id)}
            onEdit={(recordId, data) => editMaintenance.mutate({ recordId, data: data as Parameters<typeof editMaintenance.mutate>[0]['data'] })}
            isDeleting={deleteMaintenance.isPending}
            isEditing={editMaintenance.isPending}
          />
        )}
      </section>

      {/* Import dialog */}
      <ImportDialog
        vehicleId={vehicleId!}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImportComplete={() => {
          fillupsQuery.refetch();
          maintenanceQuery.refetch();
          remindersQuery.refetch();
        }}
      />

      {/* Edit dialog */}
      <EditVehicleDialog
        vehicle={vehicle}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Edit Vehicle Dialog                                                */
/* ------------------------------------------------------------------ */

function EditVehicleDialog({
  vehicle,
  open,
  onOpenChange,
}: {
  vehicle: Vehicle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateVehicle = useUpdateVehicle(vehicle.vehicleId);
  const [photoKey, setPhotoKey] = useState<string | undefined>(vehicle.photoKey);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const nickname = (fd.get('nickname') as string).trim();
    const make = (fd.get('make') as string).trim();
    const model = (fd.get('model') as string).trim();
    const yearStr = (fd.get('year') as string).trim();

    if (!nickname || !make || !model || !yearStr) return;

    updateVehicle.mutate(
      { nickname, make, model, year: Number(yearStr), photoKey },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Vehicle</DialogTitle>
          <DialogDescription>Update your vehicle details.</DialogDescription>
        </DialogHeader>

        <form id="edit-vehicle-form" onSubmit={handleSubmit} className="grid gap-4 py-2">
          {/* Vehicle photo */}
          <div className="grid gap-1.5">
            <Label>Vehicle Photo</Label>
            <PhotoUpload
              uploadType="vehicle-photo"
              vehicleId={vehicle.vehicleId}
              onUploadComplete={(key) => setPhotoKey(key)}
              currentPhotoKey={vehicle.photoKey}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-nickname">Nickname</Label>
            <Input id="edit-nickname" name="nickname" defaultValue={vehicle.nickname} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-make">Make</Label>
            <Input id="edit-make" name="make" defaultValue={vehicle.make} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-model">Model</Label>
            <Input id="edit-model" name="model" defaultValue={vehicle.model} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-year">Year</Label>
            <Input
              id="edit-year"
              name="year"
              type="number"
              min={1900}
              max={new Date().getFullYear() + 2}
              defaultValue={vehicle.year}
              required
            />
          </div>
        </form>

        <DialogFooter>
          <Button
            type="submit"
            form="edit-vehicle-form"
            disabled={updateVehicle.isPending}
          >
            {updateVehicle.isPending && <Loader2 className="animate-spin" />}
            {updateVehicle.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
