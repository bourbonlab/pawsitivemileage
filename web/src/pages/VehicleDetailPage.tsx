import { useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router';
import {
  ArrowLeft, Loader2, Archive, ArchiveRestore, BarChart3, Download, Fuel, Gauge,
  MoreHorizontal, Plus, Pencil, Upload, RefreshCw, Users, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { useSharedVehicles } from '@/api/sharing';
import { SharingManagementDialog } from '@/components/SharingManagementDialog';
import { VehicleDash } from '@/components/VehicleDash';
import { VehiclePhoto } from '@/components/VehicleCard';
import { canEditRecords, canImportData, permissionLabel } from '@/lib/sharing';
import type { Vehicle } from '@pawsitivemileage/sdk';

const TABS = ['dash', 'fillups', 'service'] as const;
type Tab = (typeof TABS)[number];

export default function VehicleDetailPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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
  const [sharingOpen, setSharingOpen] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState('');

  const sharedVehiclesQuery = useSharedVehicles();
  const sharedEntry = sharedVehiclesQuery.data?.find(sv => sv.vehicle.vehicleId === vehicleId);
  const isSharedUser = !!sharedEntry;
  const canEdit = canEditRecords(sharedEntry?.permission);
  const canImport = canImportData(sharedEntry?.permission);

  const recalculate = useRecalculateMetrics(vehicleId ?? '');
  const overdueCount = remindersQuery.data?.filter((r) => r.isOverdue).length ?? 0;

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
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
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

  const tab = TABS.includes(searchParams.get('tab') as Tab) ? (searchParams.get('tab') as Tab) : 'dash';
  const setTab = (next: string) => {
    setSearchParams(next === 'dash' ? {} : { tab: next }, { replace: true });
    window.scrollTo({ top: 0 });
  };

  function handleRecalculate() {
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
  }

  const identity = [`${vehicle.year} ${vehicle.make} ${vehicle.model}`, vehicle.licensePlate].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-5 pb-28 sm:px-6 sm:pb-10 lg:px-8 lg:pt-7">
      {/* Vehicle header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <VehiclePhoto photoKey={vehicle.photoKey ?? undefined} className="size-14 shrink-0 sm:size-16" />
          <div className="min-w-0">
            <p className="truncate font-mono text-[11px] tracking-wide text-muted-foreground uppercase sm:text-xs">{identity}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-[32px] sm:leading-tight">{vehicle.nickname}</h1>
              {vehicle.isArchived && <Badge variant="secondary">Archived</Badge>}
              {sharedEntry && <Badge variant="outline">{permissionLabel[sharedEntry.permission]}</Badge>}
            </div>
            {vehicle.vin && <p className="hidden truncate font-mono text-[11px] text-muted-foreground/80 sm:block">VIN {vehicle.vin}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" asChild className="flex-1 md:flex-none">
            <Link to={`/vehicles/${vehicleId}/analytics`}>
              <BarChart3 /> Analytics
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-10" aria-label="More actions">
                <MoreHorizontal className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/vehicles/${vehicleId}/export`}>
                  <Download /> Export
                </Link>
              </DropdownMenuItem>
              {canImport && (
                <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                  <Upload /> Import data
                </DropdownMenuItem>
              )}
              {canImport && (
                <DropdownMenuItem disabled={recalculate.isPending} onSelect={handleRecalculate}>
                  {recalculate.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Recalculate metrics
                </DropdownMenuItem>
              )}
              {!isSharedUser && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setSharingOpen(true)}>
                    <Users /> Manage sharing
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                    <Pencil /> Edit vehicle
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={archiveVehicle.isPending} onSelect={handleArchiveToggle}>
                    {vehicle.isArchived ? <ArchiveRestore /> : <Archive />}
                    {vehicle.isArchived ? 'Unarchive' : 'Archive'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {canEdit && (
            <Button asChild className="hidden sm:inline-flex">
              <Link to={`/vehicles/${vehicleId}/fillups/new`}>
                <Plus /> Fillup
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Recalculate feedback */}
      {recalcMessage && (
        <p
          className={`mt-3 text-sm font-medium ${recalcMessage.includes('failed') ? 'text-destructive' : 'text-success'}`}
          role="status"
        >
          {recalcMessage}
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab} className="mt-5 gap-4">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="dash">
            <Gauge className="hidden sm:block" /> Dash
          </TabsTrigger>
          <TabsTrigger value="fillups">
            <Fuel className="hidden sm:block" /> Fillups
          </TabsTrigger>
          <TabsTrigger value="service">
            <Wrench className="hidden sm:block" /> Service
            {overdueCount > 0 && (
              <span className="grid size-[18px] place-items-center rounded-full bg-destructive text-[10px] font-bold text-white">
                {overdueCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dash">
          {fillupsQuery.isLoading ? (
            <Spinner label="Loading fillups…" />
          ) : fillupsQuery.isError ? (
            <p className="py-8 text-center text-sm text-destructive" role="alert">
              Failed to load fillups.
            </p>
          ) : (
            <VehicleDash
              vehicleId={vehicleId!}
              fillups={fillupsQuery.data ?? []}
              reminders={remindersQuery.data ?? []}
              canEdit={canEdit}
              onShowFillups={() => setTab('fillups')}
              onShowService={() => setTab('service')}
            />
          )}
        </TabsContent>

        <TabsContent value="fillups">
          {fillupsQuery.isLoading ? (
            <Spinner label="Loading fillups…" />
          ) : fillupsQuery.isError ? (
            <p className="py-8 text-center text-sm text-destructive" role="alert">
              Failed to load fillups.
            </p>
          ) : (
            <Tabs defaultValue="list" className="gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold tracking-tight">Fillups</h2>
                <TabsList>
                  <TabsTrigger value="list">List</TabsTrigger>
                  <TabsTrigger value="map">Map</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="list">
                <FillupList
                  fillups={fillupsQuery.data ?? []}
                  vehicleId={vehicleId!}
                  onDelete={(id) => deleteFillup.mutate(id)}
                  onEdit={(fillupId, data) => editFillup.mutate({ fillupId, data: data as Parameters<typeof editFillup.mutate>[0]['data'] })}
                  isDeleting={deleteFillup.isPending}
                  isEditing={editFillup.isPending}
                  readOnly={!canEdit}
                />
              </TabsContent>
              <TabsContent value="map">
                <FillupMap fillups={fillupsQuery.data ?? []} />
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>

        <TabsContent value="service" className="flex flex-col gap-4">
          {remindersQuery.data && remindersQuery.data.length > 0 && (
            <ReminderBanner reminders={remindersQuery.data} />
          )}
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold tracking-tight">Maintenance</h2>
            {canEdit && (
              <Button variant="outline" asChild>
                <Link to={`/vehicles/${vehicleId}/maintenance/new`}>
                  <Plus /> Log service
                </Link>
              </Button>
            )}
          </div>
          {maintenanceQuery.isLoading ? (
            <Spinner label="Loading maintenance records…" />
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
              readOnly={!canEdit}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Phones: the main job at the pump is one thumb away */}
      {canEdit && (
        <Button
          asChild
          size="lg"
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 h-14 rounded-full px-6 text-base shadow-lg shadow-black/25 sm:hidden"
        >
          <Link to={`/vehicles/${vehicleId}/${tab === 'service' ? 'maintenance' : 'fillups'}/new`}>
            <Plus className="size-5" /> {tab === 'service' ? 'Service' : 'Fillup'}
          </Link>
        </Button>
      )}

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

      {/* Sharing management dialog (owner only) */}
      {!isSharedUser && (
        <SharingManagementDialog
          vehicleId={vehicleId!}
          open={sharingOpen}
          onOpenChange={setSharingOpen}
        />
      )}
    </div>
  );
}


function Spinner({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-10" role="status">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <span className="sr-only">{label}</span>
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
  const [photoKey, setPhotoKey] = useState<string | undefined>(vehicle.photoKey ?? undefined);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const nickname = (fd.get('nickname') as string).trim();
    const make = (fd.get('make') as string).trim();
    const model = (fd.get('model') as string).trim();
    const yearStr = (fd.get('year') as string).trim();
    const vin = (fd.get('vin') as string).trim() || undefined;
    const licensePlate = (fd.get('licensePlate') as string).trim() || undefined;

    if (!nickname || !make || !model || !yearStr) return;

    updateVehicle.mutate(
      { nickname, make, model, year: Number(yearStr), photoKey, vin, licensePlate },
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
              currentPhotoKey={vehicle.photoKey ?? undefined}
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
          <div className="grid gap-1.5">
            <Label htmlFor="edit-vin">VIN</Label>
            <Input
              id="edit-vin"
              name="vin"
              maxLength={17}
              defaultValue={vehicle.vin ?? ''}
              placeholder="e.g. 1HGBH41JXMN109186"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-licensePlate">License Plate</Label>
            <Input
              id="edit-licensePlate"
              name="licensePlate"
              maxLength={20}
              defaultValue={vehicle.licensePlate ?? ''}
              placeholder="e.g. ABC-1234"
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
