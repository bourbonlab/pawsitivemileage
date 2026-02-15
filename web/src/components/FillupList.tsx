import { useState } from 'react';
import { ArrowUpDown, Trash2, Fuel, Loader2 } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { Fillup } from '@/types';

type SortField = 'date' | 'odometerReading' | 'gallonsAdded' | 'currencySpent' | 'mpg' | 'costPerMile';

interface FillupListProps {
  fillups: Fillup[];
  onDelete: (fillupId: string) => void;
  isDeleting?: boolean;
}

export function FillupList({ fillups, onDelete, isDeleting }: FillupListProps) {
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortAsc, setSortAsc] = useState(false);

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
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Date" field="date" current={sortField} asc={sortAsc} onToggle={toggleSort} />
            <SortableHead label="Odometer" field="odometerReading" current={sortField} asc={sortAsc} onToggle={toggleSort} />
            <SortableHead label="Gallons" field="gallonsAdded" current={sortField} asc={sortAsc} onToggle={toggleSort} />
            <SortableHead label="Cost" field="currencySpent" current={sortField} asc={sortAsc} onToggle={toggleSort} />
            <SortableHead label="MPG" field="mpg" current={sortField} asc={sortAsc} onToggle={toggleSort} />
            <SortableHead label="$/Mile" field="costPerMile" current={sortField} asc={sortAsc} onToggle={toggleSort} />
            <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((f) => (
            <TableRow key={f.fillupId}>
              <TableCell className="whitespace-nowrap">{new Date(f.date).toLocaleDateString()}</TableCell>
              <TableCell className="text-right tabular-nums">{f.odometerReading.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{f.gallonsAdded.toFixed(2)}</TableCell>
              <TableCell className="text-right tabular-nums">${f.currencySpent.toFixed(2)}</TableCell>
              <TableCell className="text-right tabular-nums">{f.mpg != null ? f.mpg.toFixed(1) : '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{f.costPerMile != null ? `$${f.costPerMile.toFixed(2)}` : '—'}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  onClick={() => onDelete(f.fillupId)}
                  disabled={isDeleting}
                  aria-label={`Delete fillup from ${new Date(f.date).toLocaleDateString()}`}
                >
                  {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
