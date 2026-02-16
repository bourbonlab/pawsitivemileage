import { useState } from 'react';
import { ArrowUpDown, Trash2, Pencil, Wrench, Loader2, ImageIcon } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { PhotoUpload } from '@/components/PhotoUpload';
import { LocationPicker } from '@/components/LocationPicker';
import type { MaintenanceRecord } from '@/types';

type SortField = 'datePerformed' | 'odometerAtService' | 'cost';

export interface MaintenanceEditData {
  datePerformed: string;
  odometerAtService: number;
  cost: number;
  location?: string;
  locationLat?: number;
  locationLng?: number;
  stationName?: string;
  address?: string;
  notes?: string;
  receiptPhotoKey?: string | null;
}

interface MaintenanceListProps {
  records: MaintenanceRecord[];
  vehicleId: string;
  onDelete: (recordId: string) => void;
  onEdit: (recordId: string, data: MaintenanceEditData) => void;
  isDeleting?: boolean;
  isEditing?: boolean;
}

export function MaintenanceList({ records, vehicleId, onDelete, onEdit, isDeleting, isEditing }: MaintenanceListProps) {
  const [sortField, setSortField] = useState<SortField>('datePerformed');
  const [sortAsc, setSortAsc] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MaintenanceRecord | null>(null);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  }

  const sorted = [...records].sort((a, b) => {
    const valA = a[sortField];
    const valB = b[sortField];
    const cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  });

  if (!records.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <Wrench className="size-8" aria-hidden="true" />
        <p className="text-sm">No maintenance records yet.</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Date" field="datePerformed" current={sortField} asc={sortAsc} onToggle={toggleSort} />
              <TableHead>Type</TableHead>
              <SortableHead label="Odometer" field="odometerAtService" current={sortField} asc={sortAsc} onToggle={toggleSort} />
              <SortableHead label="Cost" field="cost" current={sortField} asc={sortAsc} onToggle={toggleSort} />
              <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.recordId}>
                <TableCell className="whitespace-nowrap">{new Date(r.datePerformed + 'T00:00:00').toLocaleDateString()}</TableCell>
                <TableCell>{r.schemaName || r.customTypeName || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{r.odometerAtService.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">${r.cost.toFixed(2)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {r.receiptPhotoKey && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => window.open(`/photos/${r.receiptPhotoKey}`, '_blank')}
                        aria-label={`View receipt photo from ${new Date(r.datePerformed + 'T00:00:00').toLocaleDateString()}`}
                      >
                        <ImageIcon className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => setEditingRecord(r)}
                      aria-label={`Edit maintenance from ${new Date(r.datePerformed + 'T00:00:00').toLocaleDateString()}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => onDelete(r.recordId)}
                      disabled={isDeleting}
                      aria-label={`Delete maintenance from ${new Date(r.datePerformed + 'T00:00:00').toLocaleDateString()}`}
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

      {editingRecord && (
        <EditMaintenanceDialog
          record={editingRecord}
          vehicleId={vehicleId}
          open={!!editingRecord}
          onOpenChange={(open) => { if (!open) setEditingRecord(null); }}
          onSave={(data) => {
            onEdit(editingRecord.recordId, data);
            setEditingRecord(null);
          }}
          isSaving={isEditing}
        />
      )}
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
/*  Edit Maintenance Dialog                                            */
/* ------------------------------------------------------------------ */

function EditMaintenanceDialog({
  record,
  vehicleId,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  record: MaintenanceRecord;
  vehicleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: MaintenanceEditData) => void;
  isSaving?: boolean;
}) {
  const [receiptPhotoKey, setReceiptPhotoKey] = useState<string | null | undefined>(
    record.receiptPhotoKey,
  );
  const [locationLat, setLocationLat] = useState<number | undefined>(record.locationLat);
  const [locationLng, setLocationLng] = useState<number | undefined>(record.locationLng);
  const [stationName, setStationName] = useState<string | undefined>(record.stationName);
  const [locationAddress, setLocationAddress] = useState<string | undefined>(record.address);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const datePerformed = (fd.get('datePerformed') as string).trim();
    const odometerAtService = parseFloat(fd.get('odometerAtService') as string);
    const cost = parseFloat(fd.get('cost') as string);
    const notes = (fd.get('notes') as string)?.trim() || undefined;

    if (!datePerformed || isNaN(odometerAtService) || isNaN(cost)) return;

    onSave({ datePerformed, odometerAtService, cost, locationLat, locationLng, stationName, address: locationAddress, notes, receiptPhotoKey });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Maintenance</DialogTitle>
          <DialogDescription>
            Update the maintenance record details.
          </DialogDescription>
        </DialogHeader>

        <form id="edit-maint-form" onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-maint-date">Date</Label>
            <Input
              id="edit-maint-date"
              name="datePerformed"
              type="date"
              defaultValue={record.datePerformed}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-maint-odometer">Odometer at Service</Label>
            <Input
              id="edit-maint-odometer"
              name="odometerAtService"
              type="number"
              inputMode="numeric"
              min="0"
              defaultValue={record.odometerAtService}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-maint-cost">Cost ($)</Label>
            <Input
              id="edit-maint-cost"
              name="cost"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              defaultValue={record.cost}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-maint-notes">Notes</Label>
            <Textarea
              id="edit-maint-notes"
              name="notes"
              rows={2}
              defaultValue={record.notes ?? ''}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Receipt Photo</Label>
            <PhotoUpload
              uploadType="receipt-photo"
              vehicleId={vehicleId}
              onUploadComplete={setReceiptPhotoKey}
              onPhotoRemoved={() => setReceiptPhotoKey(null)}
              currentPhotoKey={receiptPhotoKey ?? undefined}
            />
          </div>

          <LocationPicker
            initialData={{
              locationLat: record.locationLat,
              locationLng: record.locationLng,
              stationName: record.stationName,
              address: record.address,
            }}
            onLocationChange={(loc) => {
              setLocationLat(loc.locationLat);
              setLocationLng(loc.locationLng);
              setStationName(loc.stationName);
              setLocationAddress(loc.address);
            }}
          />
        </form>

        <DialogFooter>
          <Button
            type="submit"
            form="edit-maint-form"
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
