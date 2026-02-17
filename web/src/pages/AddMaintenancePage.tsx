import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { ArrowLeft, Wrench, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PhotoUpload } from '@/components/PhotoUpload';
import { LocationPicker } from '@/components/LocationPicker';
import { useCreateMaintenance } from '@/api/maintenance';
import { useAdminSchemas } from '@/api/admin';
import { useSharedVehicles } from '@/api/sharing';

const CUSTOM_TYPE_VALUE = '__custom__';

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function AddMaintenancePage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();

  const createMaintenance = useCreateMaintenance(vehicleId ?? '');
  const schemasQuery = useAdminSchemas();
  const sharedVehiclesQuery = useSharedVehicles();
  const sharedEntry = sharedVehiclesQuery.data?.find(sv => sv.vehicle.vehicleId === vehicleId);
  const isSharedUser = !!sharedEntry;

  const activeSchemas = (schemasQuery.data ?? []).filter((s) => s.isActive);

  // Schema selection state
  const [selectedSchemaId, setSelectedSchemaId] = useState('');
  const [customTypeName, setCustomTypeName] = useState('');

  const isCustom = selectedSchemaId === CUSTOM_TYPE_VALUE;
  const selectedSchema = activeSchemas.find((s) => s.schemaId === selectedSchemaId);

  // Required fields
  const [date, setDate] = useState(todayISO());
  const [odometerAtService, setOdometerAtService] = useState('');
  const [cost, setCost] = useState('');

  // Optional fields
  const [notes, setNotes] = useState('');
  const [receiptPhotoKey, setReceiptPhotoKey] = useState<string | undefined>();
  const [locationLat, setLocationLat] = useState<number | undefined>();
  const [locationLng, setLocationLng] = useState<number | undefined>();
  const [stationName, setStationName] = useState<string | undefined>();
  const [address, setAddress] = useState<string | undefined>();

  function handleSchemaChange(value: string) {
    setSelectedSchemaId(value);
    if (value !== CUSTOM_TYPE_VALUE) {
      setCustomTypeName('');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const odometer = parseFloat(odometerAtService);
    const costVal = parseFloat(cost);

    if (isNaN(odometer) || isNaN(costVal)) return;
    if (!selectedSchemaId) return;
    if (isCustom && !customTypeName.trim()) return;

    createMaintenance.mutate(
      {
        schemaId: isCustom ? undefined : selectedSchemaId,
        schemaName: isCustom ? undefined : selectedSchema?.name,
        customTypeName: isCustom ? customTypeName.trim() : undefined,
        datePerformed: date,
        odometerAtService: odometer,
        cost: costVal,
        locationLat,
        locationLng,
        stationName,
        address,
        notes: notes.trim() || undefined,
        receiptPhotoKey,
      },
      {
        onSuccess: () => navigate(`/vehicles/${vehicleId}`),
      },
    );
  }

  const canSubmit =
    !!selectedSchemaId &&
    (!isCustom || !!customTypeName.trim()) &&
    !!date &&
    !!odometerAtService &&
    !!cost &&
    !createMaintenance.isPending;

  if (isSharedUser && sharedEntry?.permission !== 'maintenance' && sharedEntry?.permission !== 'full') {
    return (
      <div className="container mx-auto max-w-lg space-y-6 p-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/vehicles/${vehicleId}`}>
            <ArrowLeft className="size-4" /> Back to Vehicle
          </Link>
        </Button>
        <p className="py-16 text-center text-sm text-destructive" role="alert">
          You don't have permission to add maintenance records to this vehicle.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-lg space-y-6 p-4">
      {/* Back button */}
      <Button variant="ghost" size="sm" asChild>
        <Link to={`/vehicles/${vehicleId}`}>
          <ArrowLeft className="size-4" /> Back to Vehicle
        </Link>
      </Button>

      <div className="flex items-center gap-2">
        <Wrench className="size-6 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold">Add Maintenance</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Maintenance type selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Maintenance Type</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="maint-type">Type</Label>
              <Select value={selectedSchemaId} onValueChange={handleSchemaChange}>
                <SelectTrigger id="maint-type">
                  <SelectValue placeholder="Select maintenance type…" />
                </SelectTrigger>
                <SelectContent>
                  {activeSchemas.map((schema) => (
                    <SelectItem key={schema.schemaId} value={schema.schemaId}>
                      <span className="font-medium">{schema.name}</span>
                      {schema.description && (
                        <span className="ml-1 text-muted-foreground">
                          — {schema.description}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_TYPE_VALUE}>Custom…</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isCustom && (
              <div className="grid gap-1.5">
                <Label htmlFor="maint-custom-name">Custom Type Name</Label>
                <Input
                  id="maint-custom-name"
                  placeholder="e.g. Windshield Replacement"
                  value={customTypeName}
                  onChange={(e) => setCustomTypeName(e.target.value)}
                  required
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Required fields */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Service Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="maint-date">Date</Label>
              <Input
                id="maint-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="maint-odometer">Odometer at Service</Label>
              <Input
                id="maint-odometer"
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="Current mileage"
                value={odometerAtService}
                onChange={(e) => setOdometerAtService(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="maint-cost">Cost ($)</Label>
              <Input
                id="maint-cost"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                required
              />
            </div>
          </CardContent>
        </Card>

        {/* Optional fields */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Optional</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="maint-notes">Notes</Label>
              <Textarea
                id="maint-notes"
                placeholder="Any notes about this service…"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {vehicleId && (
              <div className="grid gap-1.5">
                <Label>Receipt Photo</Label>
                <PhotoUpload
                  uploadType="receipt-photo"
                  vehicleId={vehicleId}
                  onUploadComplete={setReceiptPhotoKey}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Location (optional) */}
        <LocationPicker
          onLocationChange={(loc) => {
            setLocationLat(loc.locationLat);
            setLocationLng(loc.locationLng);
            setStationName(loc.stationName);
            setAddress(loc.address);
          }}
        />

        {/* Error display */}
        {createMaintenance.isError && (
          <p className="text-sm text-destructive" role="alert">
            {createMaintenance.error instanceof Error
              ? createMaintenance.error.message
              : 'Failed to save maintenance record. Please try again.'}
          </p>
        )}

        {/* Submit */}
        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {createMaintenance.isPending && (
            <Loader2 className="size-4 animate-spin" />
          )}
          {createMaintenance.isPending ? 'Saving…' : 'Save Maintenance'}
        </Button>
      </form>
    </div>
  );
}
