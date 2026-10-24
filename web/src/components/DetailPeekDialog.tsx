import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import { icon } from 'leaflet';
import { MapPin, Pencil, Receipt } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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
  /** Headline figures shown as tiles (odometer, cost, MPG…) */
  stats?: { label: string; value: string }[];
  receiptPhotoKey?: string | null;
  notes?: string | null;
  stationName?: string | null;
  address?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  /** Extra key/value pairs shown as a definition list */
  extras?: { label: string; value: string }[];
  /** Small badges rendered below the title */
  badges?: { label: string; variant?: 'default' | 'secondary' | 'outline' }[];
}

interface DetailPeekDialogProps {
  data: DetailPeekData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shows an Edit button (omit for read-only viewers) */
  onEdit?: () => void;
}

/** Read-only view of a fillup or maintenance record: figures, notes, location, map and receipt */
export function DetailPeekDialog({ data, open, onOpenChange, onEdit }: DetailPeekDialogProps) {
  if (!data) return null;

  const hasLocation = data.locationLat != null && data.locationLng != null;
  const hasNotes = !!data.notes;
  const hasStation = !!(data.stationName || data.address);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{data.title}</DialogTitle>
          <DialogDescription className="sr-only">
            Details for {data.title}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 text-sm">
          {/* Headline figures */}
          {data.stats && data.stats.length > 0 && (
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border">
              {data.stats.map((s) => (
                <div key={s.label} className="bg-card px-2.5 py-2.5 sm:px-3">
                  <dt className="text-xs text-muted-foreground">{s.label}</dt>
                  <dd className="truncate font-mono text-[15px] font-semibold tabular-nums sm:text-base">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}

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
              <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2">{data.notes}</p>
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
            <div className="overflow-hidden rounded-xl border" style={{ height: 180 }}>
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

          {/* Receipt */}
          {data.receiptPhotoKey && (
            <div className="grid gap-1">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide flex items-center gap-1">
                <Receipt className="size-3" aria-hidden="true" />
                Receipt
              </p>
              <a href={`/photos/${data.receiptPhotoKey}`} target="_blank" rel="noopener noreferrer" className="block">
                <img
                  src={`/photos/${data.receiptPhotoKey}`}
                  alt="Receipt photo (opens full size)"
                  className="max-h-64 w-full rounded-xl border bg-muted object-contain"
                />
              </a>
            </div>
          )}

          {!hasNotes && !hasStation && !hasLocation && !data.receiptPhotoKey && (
            <p className="text-muted-foreground">No notes, location or receipt on this record.</p>
          )}
        </div>

        {onEdit && (
          <DialogFooter>
            <Button variant="outline" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
