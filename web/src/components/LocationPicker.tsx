import { useState, useCallback } from 'react';
import { MapPin, Navigation, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface LocationData {
  locationLat?: number;
  locationLng?: number;
  stationName?: string;
  address?: string;
}

interface LocationPickerProps {
  onLocationChange: (location: LocationData) => void;
  /** Stored values; the API returns null for unset fields */
  initialData?: { [K in keyof LocationData]?: LocationData[K] | null };
  className?: string;
}

type GeoStatus = 'idle' | 'loading' | 'success' | 'denied' | 'unavailable' | 'error';

export function LocationPicker({ onLocationChange, initialData, className }: LocationPickerProps) {
  const [geoStatus, setGeoStatus] = useState<GeoStatus>(
    initialData?.locationLat != null ? 'success' : 'idle',
  );
  const [lat, setLat] = useState<number | undefined>(initialData?.locationLat ?? undefined);
  const [lng, setLng] = useState<number | undefined>(initialData?.locationLng ?? undefined);
  const [stationName, setStationName] = useState(initialData?.stationName ?? '');
  const [address, setAddress] = useState(initialData?.address ?? '');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const emitChange = useCallback(
    (updates: Partial<LocationData>) => {
      const next: LocationData = {
        locationLat: updates.locationLat ?? lat,
        locationLng: updates.locationLng ?? lng,
        stationName: updates.stationName ?? (stationName || undefined),
        address: updates.address ?? (address || undefined),
      };
      onLocationChange(next);
    },
    [lat, lng, stationName, address, onLocationChange],
  );

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus('unavailable');
      setErrorMsg('Geolocation is not supported by your browser.');
      return;
    }

    setGeoStatus('loading');
    setErrorMsg(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const newLat = position.coords.latitude;
        const newLng = position.coords.longitude;
        setLat(newLat);
        setLng(newLng);
        setGeoStatus('success');
        emitChange({ locationLat: newLat, locationLng: newLng });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGeoStatus('denied');
          setErrorMsg('Location permission denied. You can enter an address manually below.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGeoStatus('error');
          setErrorMsg('Location unavailable. Try entering an address manually.');
        } else {
          setGeoStatus('error');
          setErrorMsg('Could not get location. Try entering an address manually.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [emitChange]);

  const handleStationNameChange = useCallback(
    (value: string) => {
      setStationName(value);
      emitChange({ stationName: value || undefined });
    },
    [emitChange],
  );

  const handleAddressChange = useCallback(
    (value: string) => {
      setAddress(value);
      emitChange({ address: value || undefined });
    },
    [emitChange],
  );

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="size-4" aria-hidden="true" />
          Location (Optional)
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Geolocation button */}
        <div className="grid gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={handleGeolocate}
            disabled={geoStatus === 'loading'}
          >
            {geoStatus === 'loading' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Navigation className="size-4" />
            )}
            {geoStatus === 'loading' ? 'Getting location…' : 'Use My Location'}
          </Button>

          {/* Geolocation result */}
          {geoStatus === 'success' && lat != null && lng != null && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 p-2 text-xs text-green-700 dark:bg-green-950 dark:text-green-300">
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Location detected: {lat.toFixed(5)}, {lng.toFixed(5)}
              </span>
            </div>
          )}

          {/* Error / denied message */}
          {(geoStatus === 'denied' || geoStatus === 'unavailable' || geoStatus === 'error') &&
            errorMsg && (
              <div className="flex items-start gap-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{errorMsg}</span>
              </div>
            )}
        </div>

        {/* Station name */}
        <div className="grid gap-1.5">
          <Label htmlFor="location-station">Station Name</Label>
          <Input
            id="location-station"
            type="text"
            placeholder="e.g. Shell, Costco Gas"
            value={stationName}
            onChange={(e) => handleStationNameChange(e.target.value)}
          />
        </div>

        {/* Address */}
        <div className="grid gap-1.5">
          <Label htmlFor="location-address">Address</Label>
          <Input
            id="location-address"
            type="text"
            placeholder="e.g. 123 Main St, City, State"
            value={address}
            onChange={(e) => handleAddressChange(e.target.value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
