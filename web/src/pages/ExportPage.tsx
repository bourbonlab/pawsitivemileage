import { useState } from 'react';
import { useParams, Link } from 'react-router';
import {
  ArrowLeft, Download, FileSpreadsheet, FileText, Loader2,
  AlertCircle, CheckCircle2,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useVehicle } from '@/api/vehicles';
import { apiClient } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Date helpers                                                       */
/* ------------------------------------------------------------------ */

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function oneYearAgoISO(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  API response types                                                 */
/* ------------------------------------------------------------------ */

interface CsvExportResponse {
  downloadUrl: string;
  recordCount: number;
}

interface PdfExportResponse {
  downloadUrl: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Download helper                                                    */
/* ------------------------------------------------------------------ */

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ------------------------------------------------------------------ */
/*  Export Page                                                         */
/* ------------------------------------------------------------------ */

export default function ExportPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const vehicleQuery = useVehicle(vehicleId);

  const [startDate, setStartDate] = useState(oneYearAgoISO);
  const [endDate, setEndDate] = useState(todayISO);

  /* ---- Export mutations ---- */

  const exportFillups = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const qs = params.toString();
      return apiClient<CsvExportResponse>(
        `/v1/vehicles/${vehicleId}/export/fillups${qs ? `?${qs}` : ''}`,
      );
    },
    onSuccess: (data) => {
      triggerDownload(data.downloadUrl, `fillups-${vehicleId}.csv`);
    },
  });

  const exportMaintenance = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const qs = params.toString();
      return apiClient<CsvExportResponse>(
        `/v1/vehicles/${vehicleId}/export/maintenance${qs ? `?${qs}` : ''}`,
      );
    },
    onSuccess: (data) => {
      triggerDownload(data.downloadUrl, `maintenance-${vehicleId}.csv`);
    },
  });

  const exportPdf = useMutation({
    mutationFn: () =>
      apiClient<PdfExportResponse>(
        `/v1/vehicles/${vehicleId}/export/pdf`,
        {
          method: 'POST',
          body: JSON.stringify({
            startDate: startDate || undefined,
            endDate: endDate || undefined,
          }),
        },
      ),
    onSuccess: (data) => {
      triggerDownload(data.downloadUrl, `report-${vehicleId}.json`);
    },
  });

  const anyPending =
    exportFillups.isPending || exportMaintenance.isPending || exportPdf.isPending;

  /* ---- Loading state ---- */
  if (vehicleQuery.isLoading) {
    return (
      <div className="container mx-auto p-4">
        <BackButton vehicleId={vehicleId} />
        <div className="flex items-center justify-center py-24" role="status">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading vehicle…</span>
        </div>
      </div>
    );
  }

  /* ---- Error state ---- */
  if (vehicleQuery.isError) {
    return (
      <div className="container mx-auto p-4">
        <BackButton vehicleId={vehicleId} />
        <p className="py-16 text-center text-sm text-destructive" role="alert">
          Failed to load vehicle data. Please try again.
        </p>
      </div>
    );
  }

  const vehicle = vehicleQuery.data;

  return (
    <div className="container mx-auto max-w-lg space-y-6 p-4">
      <BackButton vehicleId={vehicleId} />

      {/* Page header */}
      <div className="flex items-center gap-2">
        <Download className="size-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Export Data</h1>
          {vehicle && (
            <p className="text-sm text-muted-foreground">
              {vehicle.nickname} — {vehicle.year} {vehicle.make} {vehicle.model}
            </p>
          )}
        </div>
      </div>

      {/* Date range picker */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Date Range</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="export-start-date">Start Date</Label>
            <Input
              id="export-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="export-end-date">End Date</Label>
            <Input
              id="export-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Export options */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Export Format</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* CSV Fillups */}
          <ExportOption
            icon={<FileSpreadsheet className="size-5 text-green-600" aria-hidden="true" />}
            title="Fillups CSV"
            description="All fillup records with calculated metrics"
            isPending={exportFillups.isPending}
            isSuccess={exportFillups.isSuccess}
            isError={exportFillups.isError}
            error={exportFillups.error}
            successMessage={
              exportFillups.data
                ? `Downloaded ${exportFillups.data.recordCount} record${exportFillups.data.recordCount !== 1 ? 's' : ''}`
                : undefined
            }
            disabled={anyPending}
            onExport={() => exportFillups.mutate()}
          />

          <Separator />

          {/* CSV Maintenance */}
          <ExportOption
            icon={<FileSpreadsheet className="size-5 text-blue-600" aria-hidden="true" />}
            title="Maintenance CSV"
            description="All maintenance records and service history"
            isPending={exportMaintenance.isPending}
            isSuccess={exportMaintenance.isSuccess}
            isError={exportMaintenance.isError}
            error={exportMaintenance.error}
            successMessage={
              exportMaintenance.data
                ? `Downloaded ${exportMaintenance.data.recordCount} record${exportMaintenance.data.recordCount !== 1 ? 's' : ''}`
                : undefined
            }
            disabled={anyPending}
            onExport={() => exportMaintenance.mutate()}
          />

          <Separator />

          {/* PDF Report */}
          <ExportOption
            icon={<FileText className="size-5 text-red-600" aria-hidden="true" />}
            title="PDF Report"
            description="Summary report with charts and statistics"
            isPending={exportPdf.isPending}
            isSuccess={exportPdf.isSuccess}
            isError={exportPdf.isError}
            error={exportPdf.error}
            successMessage="Report downloaded"
            disabled={anyPending}
            onExport={() => exportPdf.mutate()}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Back button                                                        */
/* ------------------------------------------------------------------ */

function BackButton({ vehicleId }: { vehicleId: string | undefined }) {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to={vehicleId ? `/vehicles/${vehicleId}` : '/garage'}>
        <ArrowLeft className="size-4" /> Back to Vehicle
      </Link>
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/*  Export option row                                                   */
/* ------------------------------------------------------------------ */

function ExportOption({
  icon,
  title,
  description,
  isPending,
  isSuccess,
  isError,
  error,
  successMessage,
  disabled,
  onExport,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  successMessage?: string;
  disabled: boolean;
  onExport: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={onExport}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {isPending ? 'Exporting…' : 'Export'}
        </Button>
      </div>

      {/* Success feedback */}
      {isSuccess && successMessage && (
        <div className="flex items-center gap-1.5 text-xs text-green-600" role="status">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          {successMessage}
        </div>
      )}

      {/* Error feedback */}
      {isError && (
        <div className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
          <AlertCircle className="size-3.5" aria-hidden="true" />
          {error instanceof Error ? error.message : 'Export failed. Please try again.'}
        </div>
      )}
    </div>
  );
}
