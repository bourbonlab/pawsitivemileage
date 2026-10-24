import { useState, useRef, useCallback } from 'react';
import { Upload, Check, X, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePresignedUpload, uploadFileToS3 } from '@/api/upload';
import { photoKeyFilename } from '@/lib/photos';

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

const ACCEPTED_FILE_TYPES = 'image/*,.pdf,.doc,.docx';

function isImageFile(file: File | null, url: string | null): boolean {
  if (file) return file.type.startsWith('image/');
  if (url) return !url.endsWith('.pdf') && !url.endsWith('.doc') && !url.endsWith('.docx');
  return false;
}

function truncateName(name: string): string {
  return name.length > 30 ? name.slice(0, 27) + '...' : name;
}

interface PhotoUploadProps {
  uploadType: 'vehicle-photo' | 'receipt-photo';
  vehicleId: string;
  onUploadComplete: (s3Key: string) => void;
  onPhotoRemoved?: () => void;
  currentPhotoKey?: string;
  className?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function PhotoUpload({
  uploadType,
  vehicleId,
  onUploadComplete,
  onPhotoRemoved,
  currentPhotoKey,
  className,
}: PhotoUploadProps) {
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const presignMutation = usePresignedUpload();

  const existingPhotoUrl = currentPhotoKey
    ? `/photos/${currentPhotoKey}`
    : null;

  const displayImage = preview ?? existingPhotoUrl;

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Enforce 10 MB file size limit
      if (file.size > MAX_FILE_SIZE) {
        setUploadState('error');
        setErrorMessage('File is too large. Maximum size is 10 MB.');
        return;
      }

      setSelectedFile(file);

      // Show local preview for images only
      if (file.type.startsWith('image/')) {
        setPreview(URL.createObjectURL(file));
      } else {
        setPreview(null);
      }

      setUploadState('uploading');
      setErrorMessage(null);

      try {
        const { url, key, contentType } = await presignMutation.mutateAsync({
          uploadType,
          vehicleId,
          file,
        });

        await uploadFileToS3(url, file, contentType);

        setUploadState('success');
        onUploadComplete(key);
      } catch (err) {
        setUploadState('error');
        setErrorMessage(
          err instanceof Error ? err.message : 'Upload failed',
        );
      }
    },
    [uploadType, vehicleId, onUploadComplete, presignMutation],
  );

  const handleClear = useCallback(() => {
    setPreview(null);
    setSelectedFile(null);
    setUploadState('idle');
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    // Notify parent that the existing photo was removed
    if (currentPhotoKey && onPhotoRemoved) {
      onPhotoRemoved();
    }
  }, [currentPhotoKey, onPhotoRemoved]);

  const label =
    uploadType === 'vehicle-photo' ? 'Vehicle Photo' : 'Receipt';

  const hasFile = preview || selectedFile || existingPhotoUrl;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept={uploadType === 'receipt-photo' ? ACCEPTED_FILE_TYPES : 'image/*'}
        onChange={handleFileSelect}
        className="hidden"
        aria-label={`Upload ${label}`}
      />

      {hasFile ? (
        isImageFile(selectedFile, existingPhotoUrl) && displayImage ? (
          <div className="relative">
            <img
              src={displayImage}
              alt={label}
              className="h-40 w-full rounded-md border object-cover"
            />
            {uploadState !== 'uploading' && (
              <Button
                type="button"
                variant="destructive"
                size="icon-xs"
                className="absolute top-1 right-1"
                onClick={handleClear}
                aria-label="Remove file"
              >
                <X />
              </Button>
            )}
            {uploadState === 'uploading' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40">
                <Loader2 className="size-6 animate-spin text-white" />
              </div>
            )}
            {uploadState === 'success' && (
              <div className="absolute bottom-1 right-1 rounded-full bg-success p-1">
                <Check className="size-3 text-background" />
              </div>
            )}
          </div>
        ) : (
          <div className="relative flex h-28 w-full items-center justify-center gap-2 rounded-md border bg-muted/50">
            <FileText className="size-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {selectedFile ? truncateName(selectedFile.name) : currentPhotoKey ? truncateName(photoKeyFilename(currentPhotoKey)) : 'Document'}
            </span>
            {uploadState !== 'uploading' && (
              <Button
                type="button"
                variant="destructive"
                size="icon-xs"
                className="absolute top-1 right-1"
                onClick={handleClear}
                aria-label="Remove file"
              >
                <X />
              </Button>
            )}
            {uploadState === 'uploading' && (
              <Loader2 className="absolute size-5 animate-spin text-muted-foreground" />
            )}
            {uploadState === 'success' && (
              <div className="absolute bottom-1 right-1 rounded-full bg-success p-1">
                <Check className="size-3 text-background" />
              </div>
            )}
          </div>
        )
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-28 w-full flex-col gap-1"
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadType === 'receipt-photo' ? (
            <Upload className="size-6 text-muted-foreground" />
          ) : (
            <Upload className="size-6 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">{label}</span>
        </Button>
      )}

      {hasFile && uploadState !== 'uploading' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mr-1 size-3" />
          Change File
        </Button>
      )}

      {uploadState === 'error' && errorMessage && (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
