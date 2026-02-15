import { useState } from 'react';
import { ArrowUpDown, Trash2, Wrench, Loader2 } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { MaintenanceRecord } from '@/types';

type SortField = 'datePerformed' | 'odometerAtService' | 'cost';

interface MaintenanceListProps {
  records: MaintenanceRecord[];
  onDelete: (recordId: string) => void;
  isDeleting?: boolean;
}

export function MaintenanceList({ records, onDelete, isDeleting }: MaintenanceListProps) {
  const [sortField, setSortField] = useState<SortField>('datePerformed');
  const [sortAsc, setSortAsc] = useState(false);

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
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Date" field="datePerformed" current={sortField} asc={sortAsc} onToggle={toggleSort} />
            <TableHead>Type</TableHead>
            <SortableHead label="Odometer" field="odometerAtService" current={sortField} asc={sortAsc} onToggle={toggleSort} />
            <SortableHead label="Cost" field="cost" current={sortField} asc={sortAsc} onToggle={toggleSort} />
            <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.recordId}>
              <TableCell className="whitespace-nowrap">{new Date(r.datePerformed).toLocaleDateString()}</TableCell>
              <TableCell>{r.schemaName || r.customTypeName || '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{r.odometerAtService.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">${r.cost.toFixed(2)}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  onClick={() => onDelete(r.recordId)}
                  disabled={isDeleting}
                  aria-label={`Delete maintenance from ${new Date(r.datePerformed).toLocaleDateString()}`}
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
