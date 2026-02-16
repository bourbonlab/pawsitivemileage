import { useState } from 'react';
import { ArrowUpDown, Trash2, Pencil, Fuel, Loader2, ImageIcon, FileText } from 'lucide-react';
import { DetailPeekDialog, hasDetails } from '@/components/DetailPeekDialog';
import type { DetailPeekData } from '@/components/DetailPeekDialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PhotoUpload } from '@/components/PhotoUpload';
import { LocationPicker } from '@/components/LocationPicker';
import type { Fillup } from '@/types';

type SortField = 'date' | 'odometerReading' | 'gallonsAdded' | 'currencySpent' | 'mpg' | 'pricePerGallon';

interface FillupListProps {
  fillups: Fillup[];
  vehicleId: string;
  onDelete: (fillupId: string) => void;
  onEdit: (fillupId: string, data: FillupEditData) => void;
  isDeleting?: boolean;
  isEditing?: boolean;
}

export interface FillupEditData {
  date: string;
  currencySpent: number;
  gallonsAdded: number;
  odometerReading: number;
  isPartialFill?: boolean;
  isBusiness?: boolean;
  locationLat?: number;
  locationLng?: number;
  stationName?: string;
  address?: string;
  receiptPhotoKey?: string | null;
  notes?: string;
}

export function FillupList({ fillups, vehicleId, onDelete, onEdit, isDeleting, isEditing }: FillupListProps) {
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [editingFillup, setEditingFillup] = useState<Fillup | null>(null);
  const [peekingFillup, setPeekingFillup] = useState<Fillup | null>(null);

  function buildPeekData(f: Fillup): DetailPeekData {
    const badges: DetailPeekData['badges'] = [];
    if (f.isPartialFill) badges.push({ label: 'Partial Fill', variant: 'outline' });
    if (f.isBusiness) badges.push({ label: 'Business', variant: 'secondary' });

    const extras: DetailPeekData['extras'] = [];
    if (f.costPerMile != null) extras.push({ label: 'Cost / Mile', value: `$${f.costPerMile.toFixed(2)}` });
    if (f.milesSinceLastFillup != null) extras.push({ label: 'Miles Driven', value: f.milesSinceLastFillup.toLocaleString() });
    if (f.daysSinceLastFillup != null) extras.push({ label: 'Days Between', value: String(f.daysSinceLastFillup) });

    return {
      title: `Fillup — ${new Date(f.date + 'T00:00:00').toLocaleDateString()}`,
      notes: f.notes,
      stationName: f.stationName,
      address: f.address,
      locationLat: f.locationLat,
      locationLng: f.locationLng,
      badges,
      extras: extras.length > 0 ? extras : undefined,
    };
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  }

  const sorted = [...fillups].sort((a, b) => {
    const valA = a[sortField];
    const valB = b[sortField];
    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;
    const cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  });

  if (!fillups.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <Fuel className="size-8" aria-hidden="true" />
        <p className="text-sm">No fillups recorded yet.</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Date" field="date" current={sortField} asc={sortAsc} onToggle={toggleSort} />
              <SortableHead label="Odometer" field="odometerReading" current={sortField} asc={sortAsc} onToggle={toggleSort} />
              <SortableHead label="Gallons" field="gallonsAdded" current={sortField} asc={sortAsc} onToggle={toggleSort} />
              <SortableHead label="Cost" field="currencySpent" current={sortField} asc={sortAsc} onToggle={toggleSort} />
              <SortableHead label="MPG" field="mpg" current={sortField} asc={sortAsc} onToggle={toggleSort} />
              <SortableHead label="$/Gal" field="pricePerGallon" current={sortField} asc={sortAsc} onToggle={toggleSort} />
              <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((f) => (
              <TableRow key={f.fillupId}>
                <TableCell className="whitespace-nowrap">{new Date(f.date + 'T00:00:00').toLocaleDateString()}</TableCell>
                <TableCell className="text-right tabular-nums">{f.odometerReading.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{f.gallonsAdded.toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums">${f.currencySpent.toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums">{f.mpg != null ? f.mpg.toFixed(1) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{f.pricePerGallon != null ? `${f.pricePerGallon.toFixed(2)}` : '—'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {hasDetails(f) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setPeekingFillup(f)}
                        aria-label={`View details for fillup from ${new Date(f.date + 'T00:00:00').toLocaleDateString()}`}
                      >
                        <FileText className="size-4" />
                      </Button>
                    )}
                    {f.receiptPhotoKey && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => window.open(`/photos/${f.receiptPhotoKey}`, '_blank')}
                        aria-label={`View receipt photo from ${new Date(f.date + 'T00:00:00').toLocaleDateString()}`}
                      >
                        <ImageIcon className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => setEditingFillup(f)}
                      aria-label={`Edit fillup from ${new Date(f.date + 'T00:00:00').toLocaleDateString()}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => onDelete(f.fillupId)}
                      disabled={isDeleting}
                      aria-label={`Delete fillup from ${new Date(f.date + 'T00:00:00').toLocaleDateString()}`}
                    >
                      {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editingFillup && (
        <EditFillupDialog
          fillup={editingFillup}
          vehicleId={vehicleId}
          open={!!editingFillup}
          onOpenChange={(open) => { if (!open) setEditingFillup(null); }}
          onSave={(data) => {
            onEdit(editingFillup.fillupId, data);
            setEditingFillup(null);
          }}
          isSaving={isEditing}
        />
      )}

      <DetailPeekDialog
        data={peekingFillup ? buildPeekData(peekingFillup) : null}
        open={!!peekingFillup}
        onOpenChange={(open) => { if (!open) setPeekingFillup(null); }}
      />
    </>
  );
}

function SortableHead({
  label, field, current, asc, onToggle,
}: {
  label: string; field: SortField; current: SortField; asc: boolean;
  onToggle: (f: SortField) => void;
}) {
  return (
    <TableHead>
      <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => onToggle(field)}>
        {label}
        <ArrowUpDown className="ml-1 size-3" />
      </Button>
    </TableHead>
  );
}


/* ------------------------------------------------------------------ */
/*  Edit Fillup Dialog                                                 */
/* ------------------------------------------------------------------ */

function EditFillupDialog({
  fillup,
  vehicleId,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  fillup: Fillup;
  vehicleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: FillupEditData) => void;
  isSaving?: boolean;
}) {
  const [receiptPhotoKey, setReceiptPhotoKey] = useState<string | null | undefined>(
    fillup.receiptPhotoKey,
  );
  const [locationLat, setLocationLat] = useState<number | undefined>(fillup.locationLat);
  const [locationLng, setLocationLng] = useState<number | undefined>(fillup.locationLng);
  const [stationName, setStationName] = useState<string | undefined>(fillup.stationName);
  const [address, setAddress] = useState<string | undefined>(fillup.address);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const date = (fd.get('date') as string).trim();
    const currencySpent = parseFloat(fd.get('currencySpent') as string);
    const gallonsAdded = parseFloat(fd.get('gallonsAdded') as string);
    const odometerReading = parseFloat(fd.get('odometerReading') as string);
    const isPartialFill = fd.get('isPartialFill') === 'on';
    const isBusiness = fd.get('isBusiness') === 'on';
    const notes = (fd.get('notes') as string)?.trim() || undefined;

    if (!date || isNaN(currencySpent) || isNaN(gallonsAdded) || isNaN(odometerReading)) return;

    onSave({ date, currencySpent, gallonsAdded, odometerReading, isPartialFill, isBusiness, locationLat, locationLng, stationName, address, receiptPhotoKey, notes });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Fillup</DialogTitle>
          <DialogDescription>
            Update the fillup details. Metrics will be recalculated automatically.
          </DialogDescription>
        </DialogHeader>

        <form id="edit-fillup-form" onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-fillup-date">Date</Label>
            <Input
              id="edit-fillup-date"
              name="date"
              type="date"
              defaultValue={fillup.date}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-fillup-spent">Amount Spent ($)</Label>
            <Input
              id="edit-fillup-spent"
              name="currencySpent"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              defaultValue={fillup.currencySpent}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-fillup-gallons">Gallons</Label>
            <Input
              id="edit-fillup-gallons"
              name="gallonsAdded"
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0.001"
              defaultValue={fillup.gallonsAdded}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-fillup-odometer">Odometer Reading</Label>
            <Input
              id="edit-fillup-odometer"
              name="odometerReading"
              type="number"
              inputMode="numeric"
              min="1"
              defaultValue={fillup.odometerReading}
              required
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="edit-fillup-partial" className="cursor-pointer">
              Partial Fill
            </Label>
            <Switch
              id="edit-fillup-partial"
              name="isPartialFill"
              defaultChecked={fillup.isPartialFill}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="edit-fillup-business" className="cursor-pointer">
              Business
            </Label>
            <Switch
              id="edit-fillup-business"
              name="isBusiness"
              defaultChecked={fillup.isBusiness ?? false}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-fillup-notes">Notes</Label>
            <Textarea
              id="edit-fillup-notes"
              name="notes"
              rows={2}
              defaultValue={fillup.notes ?? ''}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Receipt Photo</Label>
            <PhotoUpload
              uploadType="receipt-photo"
              vehicleId={vehicleId}
              fillupId={fillup.fillupId}
              onUploadComplete={setReceiptPhotoKey}
              onPhotoRemoved={() => setReceiptPhotoKey(null)}
              currentPhotoKey={receiptPhotoKey ?? undefined}
            />
          </div>

          <LocationPicker
            initialData={{
              locationLat: fillup.locationLat,
              locationLng: fillup.locationLng,
              stationName: fillup.stationName,
              address: fillup.address,
            }}
            onLocationChange={(loc) => {
              setLocationLat(loc.locationLat);
              setLocationLng(loc.locationLng);
              setStationName(loc.stationName);
              setAddress(loc.address);
            }}
          />
        </form>

        <DialogFooter>
          <Button
            type="submit"
            form="edit-fillup-form"
            disabled={isSaving}
          >
            {isSaving && <Loader2 className="size-4 animate-spin" />}
            {isSaving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
