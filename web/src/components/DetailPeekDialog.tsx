import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import { icon } from 'leaflet';
import { MapPin, StickyNote } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

import 'leaflet/dist/leaflet.css';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';

const markerIcon = icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  shadowSize: [41, 41],
});

export interface DetailPeekData {
  /** Dialog title, e.g. "Fillup — 1/15/2026" */
  title: string;
  notes?: string;
  stationName?: string;
  address?: string;
  locationLat?: number;
  locationLng?: number;
  /** Extra key/value pairs shown as a definition list */
  extras?: { label: string; value: string }[];
  /** Small badges rendered below the title */
  badges?: { label: string; variant?: 'default' | 'secondary' | 'outline' }[];
}

interface DetailPeekDialogProps {
  data: DetailPeekData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Returns true when there's at least one piece of detail worth showing. */
export function hasDetails(d: {
  notes?: string;
  stationName?: string;
  address?: string;
  locationLat?: number;
  locationLng?: number;
}): boolean {
  return !!(d.notes || d.stationName || d.address || (d.locationLat != null && d.locationLng != null));
}

export function DetailPeekDialog({ data, open, onOpenChange }: DetailPeekDialogProps) {
  if (!data) return null;

  const hasLocation = data.locationLat != null && data.locationLng != null;
  const hasNotes = !!data.notes;
  const hasStation = !!(data.stationName || data.address);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <StickyNote className="size-4 shrink-0" aria-hidden="true" />
            {data.title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Details for {data.title}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 text-sm">
          {/* Badges */}
          {data.badges && data.badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.badges.map((b) => (
                <Badge key={b.label} variant={b.variant ?? 'secondary'}>{b.label}</Badge>
              ))}
            </div>
          )}

          {/* Extra metrics */}
          {data.extras && data.extras.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {data.extras.map((e) => (
                <div key={e.label} className="contents">
                  <dt className="text-muted-foreground">{e.label}</dt>
                  <dd className="text-right tabular-nums">{e.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {/* Notes */}
          {hasNotes && (
            <div className="grid gap-1">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Notes</p>
              <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2">{data.notes}</p>
            </div>
          )}

          {/* Location */}
          {hasStation && (
            <div className="grid gap-1">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide flex items-center gap-1">
                <MapPin className="size-3" aria-hidden="true" />
                Location
              </p>
              {data.stationName && <p className="font-medium">{data.stationName}</p>}
              {data.address && <p className="text-muted-foreground">{data.address}</p>}
            </div>
          )}

          {/* Mini map */}
          {hasLocation && (
            <div className="overflow-hidden rounded-md border" style={{ height: 180 }}>
              <MapContainer
                center={[data.locationLat!, data.locationLng!]}
                zoom={14}
                scrollWheelZoom={false}
                dragging={false}
                zoomControl={false}
                attributionControl={false}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Marker position={[data.locationLat!, data.locationLng!]} icon={markerIcon} />
              </MapContainer>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
