import { useState, useRef } from 'react';
import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { usePresignedUpload, uploadFileToS3 } from '@/api/upload';
import { useImportCsv } from '@/api/import';

interface ImportDialogProps {
  vehicleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

type ImportType = 'fuelups' | 'maintenance';
type DialogState = 'idle' | 'uploading' | 'importing' | 'success' | 'error';

interface ImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: string[];
}

export function ImportDialog({
  vehicleId,
  open,
  onOpenChange,
  onImportComplete,
}: ImportDialogProps) {
  const [state, setState] = useState<DialogState>('idle');
  const [importType, setImportType] = useState<ImportType>('fuelups');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const presign = usePresignedUpload();
  const importCsv = useImportCsv(vehicleId);

  function reset() {
    setState('idle');
    setFile(null);
    setResult(null);
    setErrorMessage('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  async function handleImport() {
    if (!file) return;

    try {
      // Step 1: Get presigned URL
      setState('uploading');
      const presignResult = await presign.mutateAsync({
        uploadType: 'csv-import',
        vehicleId,
        contentType: 'text/csv',
        file,
      });

      // Step 2: Upload to S3
      await uploadFileToS3(presignResult.url, file);

      // Step 3: Call import API
      setState('importing');
      const importResult = await importCsv.mutateAsync({
        type: importType,
        s3Key: presignResult.key,
      });

      setResult(importResult);
      setState('success');
      onImportComplete();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'An unexpected error occurred',
      );
      setState('error');
    }
  }

  const isProcessing = state === 'uploading' || state === 'importing';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Fuelly Data</DialogTitle>
          <DialogDescription>
            Upload a CSV file exported from Fuelly to import your historical
            data.
          </DialogDescription>
        </DialogHeader>

        {state === 'idle' && (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="import-type">CSV Type</Label>
              <Select
                value={importType}
                onValueChange={(v) => setImportType(v as ImportType)}
              >
                <SelectTrigger id="import-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fuelups">Fuelups</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="csv-file">CSV File</Label>
              <input
                ref={fileInputRef}
                id="csv-file"
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="border-input bg-background file:bg-muted file:text-foreground flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs file:mr-3 file:border-0 file:px-2 file:py-0.5 file:text-sm file:font-medium"
              />
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="text-primary size-8 animate-spin" />
            <p className="text-muted-foreground text-sm">
              {state === 'uploading'
                ? 'Uploading CSV file…'
                : 'Importing records…'}
            </p>
          </div>
        )}

        {state === 'success' && result && (
          <Alert>
            <CheckCircle className="size-4" />
            <AlertTitle>Import Complete</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 space-y-0.5">
                <li>Total rows: {result.totalRows}</li>
                <li>Imported: {result.imported}</li>
                <li>Skipped: {result.skipped}</li>
                <li>Duplicates: {result.duplicates}</li>
              </ul>
              {result.errors.length > 0 && (
                <p className="text-destructive mt-2 text-xs">
                  {result.errors.length} error(s): {result.errors.join(', ')}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {state === 'error' && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Import Failed</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          {state === 'idle' && (
            <Button onClick={handleImport} disabled={!file}>
              <Upload className="mr-2 size-4" />
              Import
            </Button>
          )}
          {(state === 'success' || state === 'error') && (
            <div className="flex gap-2">
              {state === 'error' && (
                <Button variant="outline" onClick={reset}>
                  Try Again
                </Button>
              )}
              <Button
                variant={state === 'success' ? 'default' : 'outline'}
                onClick={() => handleOpenChange(false)}
              >
                {state === 'success' ? 'Done' : 'Close'}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
