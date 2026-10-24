import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import {
  ArrowLeft, Fuel, Loader2, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PhotoUpload } from '@/components/PhotoUpload';
import { LocationPicker } from '@/components/LocationPicker';
import { useCreateFillup } from '@/api/fillups';
import { useFillups } from '@/api/fillups';
import { useSharedVehicles } from '@/api/sharing';
import { previewMetrics } from '@/lib/metrics';
import { canEditRecords } from '@/lib/sharing';

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function AddFillupPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();

  const createFillup = useCreateFillup(vehicleId ?? '');
  const fillupsQuery = useFillups(vehicleId);
  const sharedVehiclesQuery = useSharedVehicles();
  const sharedEntry = sharedVehiclesQuery.data?.find(sv => sv.vehicle.vehicleId === vehicleId);

  // Form state — required fields
  const [date, setDate] = useState(todayISO());
  const [currencySpent, setCurrencySpent] = useState('');
  const [gallonsAdded, setGallonsAdded] = useState('');
  const [odometerReading, setOdometerReading] = useState('');

  // Form state — optional fields
  const [isPartialFill, setIsPartialFill] = useState(false);
  const [isBusiness, setIsBusiness] = useState(false);
  const [notes, setNotes] = useState('');
  const [receiptPhotoKey, setReceiptPhotoKey] = useState<string | undefined>();
  const [locationLat, setLocationLat] = useState<number | undefined>();
  const [locationLng, setLocationLng] = useState<number | undefined>();
  const [stationName, setStationName] = useState<string | undefined>();
  const [address, setAddress] = useState<string | undefined>();

  // Derive previous fillup (most recent by date/odometer)
  const previousFillup = useMemo(() => {
    if (!fillupsQuery.data || fillupsQuery.data.length === 0) return null;
    const sorted = [...fillupsQuery.data].sort(
      (a, b) => b.odometerReading - a.odometerReading,
    );
    return sorted[0];
  }, [fillupsQuery.data]);

  const isFirstFillup = !previousFillup;

  // Live metrics preview
  const metrics = useMemo(() => {
    const spent = parseFloat(currencySpent);
    const gallons = parseFloat(gallonsAdded);
    const odometer = parseFloat(odometerReading);

    if (isNaN(spent) || isNaN(gallons) || isNaN(odometer)) {
      return null;
    }

    if (isPartialFill) {
      // Partial fills only show price per gallon
      if (gallons > 0 && spent > 0) {
        return {
          pricePerGallon: spent / gallons,
          milesSinceLastFillup: previousFillup
            ? odometer - previousFillup.odometerReading
            : null,
          mpg: null,
          costPerMile: null,
        };
      }
      return null;
    }

    return previewMetrics({
      currencySpent: spent,
      gallonsAdded: gallons,
      odometerReading: odometer,
      previousOdometer: previousFillup?.odometerReading,
      previousDate: previousFillup?.date,
      currentDate: date,
    });
  }, [currencySpent, gallonsAdded, odometerReading, date, isPartialFill, previousFillup]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const spent = parseFloat(currencySpent);
    const gallons = parseFloat(gallonsAdded);
    const odometer = parseFloat(odometerReading);

    if (isNaN(spent) || isNaN(gallons) || isNaN(odometer)) return;

    createFillup.mutate(
      {
        date,
        currencySpent: spent,
        gallonsAdded: gallons,
        odometerReading: odometer,
        isPartialFill: isPartialFill || undefined,
        isBusiness: isBusiness || undefined,
        locationLat,
        locationLng,
        stationName,
        address,
        receiptPhotoKey,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => navigate(`/vehicles/${vehicleId}`),
      },
    );
  }

  const canSubmit =
    !!currencySpent && !!gallonsAdded && !!odometerReading && !!date && !createFillup.isPending;

  if (!canEditRecords(sharedEntry?.permission)) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/vehicles/${vehicleId}`}>
            <ArrowLeft className="size-4" /> Back to Vehicle
          </Link>
        </Button>
        <p className="py-16 text-center text-sm text-destructive" role="alert">
          You don't have permission to add fillups to this vehicle.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      {/* Back button */}
      <Button variant="ghost" size="sm" asChild>
        <Link to={`/vehicles/${vehicleId}`}>
          <ArrowLeft className="size-4" /> Back to Vehicle
        </Link>
      </Button>

      <div className="flex items-center gap-2">
        <Fuel className="size-6 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold">Add Fillup</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Required fields */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Fillup Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="fillup-date">Date</Label>
              <Input
                id="fillup-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="fillup-spent">Amount Spent ($)</Label>
              <Input
                id="fillup-spent"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={currencySpent}
                onChange={(e) => setCurrencySpent(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="fillup-gallons">Gallons</Label>
              <Input
                id="fillup-gallons"
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0.001"
                placeholder="0.000"
                value={gallonsAdded}
                onChange={(e) => setGallonsAdded(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="fillup-odometer">Odometer Reading</Label>
              <Input
                id="fillup-odometer"
                type="number"
                inputMode="numeric"
                min="1"
                placeholder="Current mileage"
                value={odometerReading}
                onChange={(e) => setOdometerReading(e.target.value)}
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
            <div className="flex items-center justify-between">
              <Label htmlFor="fillup-partial" className="cursor-pointer">
                Partial Fill
              </Label>
              <Switch
                id="fillup-partial"
                checked={isPartialFill}
                onCheckedChange={setIsPartialFill}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="fillup-business" className="cursor-pointer">
                Business
              </Label>
              <Switch
                id="fillup-business"
                checked={isBusiness}
                onCheckedChange={setIsBusiness}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="fillup-notes">Notes</Label>
              <Textarea
                id="fillup-notes"
                placeholder="Any notes about this fillup…"
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

        {/* Metrics preview */}
        <MetricsPreview
          metrics={metrics}
          isFirstFillup={isFirstFillup}
          isPartialFill={isPartialFill}
        />

        {/* Error display */}
        {createFillup.isError && (
          <p className="text-sm text-destructive" role="alert">
            {createFillup.error instanceof Error
              ? createFillup.error.message
              : 'Failed to save fillup. Please try again.'}
          </p>
        )}

        {/* Submit */}
        <Button
          type="submit"
          className="w-full"
          disabled={!canSubmit}
        >
          {createFillup.isPending && <Loader2 className="size-4 animate-spin" />}
          {createFillup.isPending ? 'Saving…' : 'Save Fillup'}
        </Button>
      </form>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Metrics Preview Card                                               */
/* ------------------------------------------------------------------ */

function fmt(value: number | null, decimals = 2): string {
  if (value == null) return '—';
  return value.toFixed(decimals);
}

function MetricsPreview({
  metrics,
  isFirstFillup,
  isPartialFill,
}: {
  metrics: ReturnType<typeof previewMetrics> | null;
  isFirstFillup: boolean;
  isPartialFill: boolean;
}) {
  if (!metrics) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Calculated Metrics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(isFirstFillup || isPartialFill) && (
          <div className="flex items-start gap-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {isFirstFillup
                ? 'First fillup — only price per gallon available.'
                : 'Partial fill — MPG will be calculated on the next full fill.'}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <MetricItem
            label="Price / Gallon"
            value={metrics.pricePerGallon != null ? `$${fmt(metrics.pricePerGallon)}` : '—'}
          />
          <MetricItem
            label="Miles Driven"
            value={metrics.milesSinceLastFillup != null ? fmt(metrics.milesSinceLastFillup, 0) : '—'}
          />
          <MetricItem
            label="MPG"
            value={metrics.mpg != null ? fmt(metrics.mpg, 1) : '—'}
          />
          <MetricItem
            label="Cost / Mile"
            value={metrics.costPerMile != null ? `$${fmt(metrics.costPerMile)}` : '—'}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
