import { useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft, Loader2, Wrench, Plus, Pencil, Search, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  useAdminSchemas, useCreateSchema, useUpdateSchema, useToggleSchemaActive,
} from '@/api/admin';
import type { MaintenanceSchema } from '@pawsitivemileage/sdk';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  'Engine',
  'Transmission',
  'Brakes',
  'Tires',
  'Fluids',
  'Electrical',
  'Body',
  'Other',
] as const;

/* ------------------------------------------------------------------ */
/*  Form state                                                         */
/* ------------------------------------------------------------------ */

interface SchemaFormData {
  name: string;
  description: string;
  category: string;
  defaultMileageInterval: string;
  defaultTimeIntervalDays: string;
}

const EMPTY_FORM: SchemaFormData = {
  name: '',
  description: '',
  category: '',
  defaultMileageInterval: '',
  defaultTimeIntervalDays: '',
};

function schemaToForm(s: MaintenanceSchema): SchemaFormData {
  return {
    name: s.name,
    description: s.description,
    category: s.category,
    defaultMileageInterval: s.defaultMileageInterval != null ? String(s.defaultMileageInterval) : '',
    defaultTimeIntervalDays: s.defaultTimeIntervalDays != null ? String(s.defaultTimeIntervalDays) : '',
  };
}

/* ------------------------------------------------------------------ */
/*  Admin Schemas Page                                                 */
/* ------------------------------------------------------------------ */

export default function AdminSchemasPage() {
  const { data: schemas, isLoading, isError } = useAdminSchemas();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchema, setEditingSchema] = useState<MaintenanceSchema | null>(null);
  const [previewSchema, setPreviewSchema] = useState<MaintenanceSchema | null>(null);

  const filtered = (schemas ?? []).filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  });

  function openCreate() {
    setEditingSchema(null);
    setDialogOpen(true);
  }

  function openEdit(schema: MaintenanceSchema) {
    setEditingSchema(schema);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingSchema(null);
  }

  /* ---- Loading ---- */
  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <BackButton />
        <div className="flex items-center justify-center py-24" role="status">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading schemas…</span>
        </div>
      </div>
    );
  }

  /* ---- Error ---- */
  if (isError) {
    return (
      <div className="container mx-auto p-4">
        <BackButton />
        <p className="py-16 text-center text-sm text-destructive" role="alert">
          Failed to load maintenance schemas. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-4">
      <BackButton />

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="size-6 text-primary" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold">Maintenance Schemas</h1>
            <p className="text-sm text-muted-foreground">
              {schemas?.length ?? 0} schema{schemas?.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" /> Add Schema
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          placeholder="Search schemas…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          aria-label="Search schemas"
        />
      </div>

      {/* Empty */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <Wrench className="size-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {search.trim() ? 'No schemas match your search.' : 'No schemas yet. Create one to get started.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <SchemasTable schemas={filtered} onEdit={openEdit} onPreview={setPreviewSchema} />
          </div>

          {/* Mobile cards */}
          <div className="grid gap-3 md:hidden">
            {filtered.map((s) => (
              <SchemaCard key={s.schemaId} schema={s} onEdit={openEdit} onPreview={setPreviewSchema} />
            ))}
          </div>
        </>
      )}

      {/* Create / Edit dialog */}
      <SchemaDialog
        open={dialogOpen}
        onClose={closeDialog}
        schema={editingSchema}
      />

      {/* Preview dialog */}
      <PreviewDialog
        schema={previewSchema}
        onClose={() => setPreviewSchema(null)}
      />
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Back button                                                        */
/* ------------------------------------------------------------------ */

function BackButton() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/garage">
        <ArrowLeft className="size-4" /> Back to Garage
      </Link>
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/*  Active toggle                                                      */
/* ------------------------------------------------------------------ */

function ActiveToggle({ schema }: { schema: MaintenanceSchema }) {
  const toggle = useToggleSchemaActive(schema.schemaId);
  const switchId = `active-toggle-${schema.schemaId}`;

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={switchId}
        checked={schema.isActive}
        disabled={toggle.isPending}
        onCheckedChange={(checked: boolean) => toggle.mutate(checked)}
        aria-label={`${schema.isActive ? 'Deactivate' : 'Activate'} ${schema.name}`}
      />
      <Label htmlFor={switchId} className="sr-only">
        Active
      </Label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop table                                                      */
/* ------------------------------------------------------------------ */

function SchemasTable({
  schemas,
  onEdit,
  onPreview,
}: {
  schemas: MaintenanceSchema[];
  onEdit: (s: MaintenanceSchema) => void;
  onPreview: (s: MaintenanceSchema) => void;
}) {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-center">Mileage Interval</TableHead>
            <TableHead className="text-center">Time Interval</TableHead>
            <TableHead className="text-center">Status</TableHead>
            <TableHead className="text-center">Active</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schemas.map((s) => (
            <TableRow key={s.schemaId}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell>
                <Badge variant="outline">{s.category}</Badge>
              </TableCell>
              <TableCell className="text-center">
                {s.defaultMileageInterval != null
                  ? `${s.defaultMileageInterval.toLocaleString()} mi`
                  : '—'}
              </TableCell>
              <TableCell className="text-center">
                {s.defaultTimeIntervalDays != null
                  ? `${s.defaultTimeIntervalDays} days`
                  : '—'}
              </TableCell>
              <TableCell className="text-center">
                <Badge variant={s.isActive ? 'default' : 'secondary'}>
                  {s.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell className="text-center">
                <ActiveToggle schema={s} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onPreview(s)}
                    aria-label={`Preview ${s.name}`}
                  >
                    <Eye className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(s)}
                    aria-label={`Edit ${s.name}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile card                                                        */
/* ------------------------------------------------------------------ */

function SchemaCard({
  schema,
  onEdit,
  onPreview,
}: {
  schema: MaintenanceSchema;
  onEdit: (s: MaintenanceSchema) => void;
  onPreview: (s: MaintenanceSchema) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{schema.name}</p>
              <Badge variant={schema.isActive ? 'default' : 'secondary'} className="text-[10px]">
                {schema.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">{schema.description}</p>
          </div>
          <ActiveToggle schema={schema} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{schema.category}</Badge>
          {schema.defaultMileageInterval != null && (
            <Badge variant="outline">
              {schema.defaultMileageInterval.toLocaleString()} mi
            </Badge>
          )}
          {schema.defaultTimeIntervalDays != null && (
            <Badge variant="outline">{schema.defaultTimeIntervalDays} days</Badge>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onPreview(schema)}>
            <Eye className="size-3.5" /> Preview
          </Button>
          <Button variant="outline" size="sm" onClick={() => onEdit(schema)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


/* ------------------------------------------------------------------ */
/*  Create / Edit dialog                                               */
/* ------------------------------------------------------------------ */

function SchemaDialog({
  open,
  onClose,
  schema,
}: {
  open: boolean;
  onClose: () => void;
  schema: MaintenanceSchema | null;
}) {
  const isEdit = schema !== null;
  const [form, setForm] = useState<SchemaFormData>(EMPTY_FORM);
  const createMutation = useCreateSchema();
  const updateMutation = useUpdateSchema(schema?.schemaId ?? '');

  const mutation = isEdit ? updateMutation : createMutation;

  // Reset form when dialog opens
  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setForm(schema ? schemaToForm(schema) : EMPTY_FORM);
    } else {
      onClose();
    }
  }

  // Also reset when schema changes while open
  // (handled by key prop on Dialog or manual effect)
  function onOpenAutoFill() {
    setForm(schema ? schemaToForm(schema) : EMPTY_FORM);
  }

  function setField(field: keyof SchemaFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const canSubmit =
    form.name.trim() !== '' &&
    form.description.trim() !== '' &&
    form.category !== '' &&
    !mutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      category: form.category,
      defaultMileageInterval: form.defaultMileageInterval
        ? Number(form.defaultMileageInterval)
        : null,
      defaultTimeIntervalDays: form.defaultTimeIntervalDays
        ? Number(form.defaultTimeIntervalDays)
        : null,
    };

    mutation.mutate(payload, {
      onSuccess: () => {
        onClose();
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={() => onOpenAutoFill()}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Schema' : 'Add Schema'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the maintenance schema details.'
              : 'Create a new maintenance schema available to all users.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="grid gap-1.5">
            <Label htmlFor="schema-name">Name *</Label>
            <Input
              id="schema-name"
              placeholder="e.g. Oil Change"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="grid gap-1.5">
            <Label htmlFor="schema-description">Description *</Label>
            <Textarea
              id="schema-description"
              placeholder="Brief description of this maintenance type"
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={2}
              required
            />
          </div>

          {/* Category */}
          <div className="grid gap-1.5">
            <Label htmlFor="schema-category">Category *</Label>
            <Select
              value={form.category}
              onValueChange={(v) => setField('category', v)}
            >
              <SelectTrigger id="schema-category">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mileage interval */}
          <div className="grid gap-1.5">
            <Label htmlFor="schema-mileage">Mileage Interval (miles)</Label>
            <Input
              id="schema-mileage"
              type="number"
              min={0}
              placeholder="e.g. 5000"
              value={form.defaultMileageInterval}
              onChange={(e) => setField('defaultMileageInterval', e.target.value)}
            />
          </div>

          {/* Time interval */}
          <div className="grid gap-1.5">
            <Label htmlFor="schema-time">Time Interval (days)</Label>
            <Input
              id="schema-time"
              type="number"
              min={0}
              placeholder="e.g. 180"
              value={form.defaultTimeIntervalDays}
              onChange={(e) => setField('defaultTimeIntervalDays', e.target.value)}
            />
          </div>

          {/* Error */}
          {mutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {mutation.error instanceof Error
                ? mutation.error.message
                : 'Something went wrong. Please try again.'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {isEdit ? 'Save Changes' : 'Create Schema'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Preview dialog — shows how the schema appears to end users         */
/* ------------------------------------------------------------------ */

function PreviewDialog({
  schema,
  onClose,
}: {
  schema: MaintenanceSchema | null;
  onClose: () => void;
}) {
  if (!schema) return null;

  return (
    <Dialog open={!!schema} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>End-User Preview</DialogTitle>
          <DialogDescription>
            How this schema appears when users log maintenance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Simulated maintenance form preview */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Wrench className="size-5 text-primary" aria-hidden="true" />
                <p className="font-medium">{schema.name}</p>
              </div>
              <p className="text-sm text-muted-foreground">{schema.description}</p>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Category</p>
                  <p className="font-medium">{schema.category}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Badge variant={schema.isActive ? 'default' : 'secondary'}>
                    {schema.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>

              {(schema.defaultMileageInterval != null || schema.defaultTimeIntervalDays != null) && (
                <div className="rounded-md border p-3 text-sm">
                  <p className="mb-1 font-medium text-muted-foreground">
                    Recommended Intervals
                  </p>
                  {schema.defaultMileageInterval != null && (
                    <p>Every {schema.defaultMileageInterval.toLocaleString()} miles</p>
                  )}
                  {schema.defaultTimeIntervalDays != null && (
                    <p>Every {schema.defaultTimeIntervalDays} days</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
