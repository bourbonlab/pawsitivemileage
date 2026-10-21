import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { icon } from 'leaflet';
import { MapPinOff } from 'lucide-react';
import type { Fillup } from '@pawsitivemileage/sdk';

import 'leaflet/dist/leaflet.css';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';

const defaultIcon = icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface FillupMapProps {
  fillups: Fillup[];
}

export function FillupMap({ fillups }: FillupMapProps) {
  const geoFillups = useMemo(
    () => fillups.filter((f) => f.locationLat != null && f.locationLng != null),
    [fillups],
  );

  if (geoFillups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <MapPinOff className="size-8" aria-hidden="true" />
        <p className="text-sm">No fillups with location data.</p>
      </div>
    );
  }

  // Auto-fit bounds: compute center and a reasonable zoom
  const lats = geoFillups.map((f) => f.locationLat!);
  const lngs = geoFillups.map((f) => f.locationLng!);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  return (
    <div className="overflow-hidden rounded-md border" style={{ height: 400 }}>
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={geoFillups.length === 1 ? 13 : 10}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {geoFillups.map((f) => (
          <Marker
            key={f.fillupId}
            position={[f.locationLat!, f.locationLng!]}
            icon={defaultIcon}
          >
            <Popup>
              <div className="space-y-1 text-sm">
                {f.stationName && (
                  <p className="font-semibold">{f.stationName}</p>
                )}
                <p>{new Date(f.date + 'T00:00:00').toLocaleDateString()}</p>
                {f.pricePerGallon != null && (
                  <p>${f.pricePerGallon.toFixed(2)}/gal</p>
                )}
                <p>${f.currencySpent.toFixed(2)} &middot; {f.gallonsAdded.toFixed(2)} gal</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
