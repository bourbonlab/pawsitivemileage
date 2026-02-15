import { useState, useRef, useCallback } from 'react';
import { Camera, Upload, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePresignedUpload, uploadFileToS3 } from '@/api/upload';

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

interface PhotoUploadProps {
  uploadType: 'vehicle-photo' | 'receipt-photo';
  vehicleId: string;
  fillupId?: string;
  onUploadComplete: (s3Key: string) => void;
  currentPhotoKey?: string;
  className?: string;
}

export function PhotoUpload({
  uploadType,
  vehicleId,
  fillupId,
  onUploadComplete,
  currentPhotoKey,
  className,
}: PhotoUploadProps) {
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const presignMutation = usePresignedUpload();

  const existingPhotoUrl = currentPhotoKey
    ? `${import.meta.env.VITE_PHOTOS_URL ?? ''}/${currentPhotoKey}`
    : null;

  const displayImage = preview ?? existingPhotoUrl;

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Show local preview immediately
      setPreview(URL.createObjectURL(file));
      setUploadState('uploading');
      setErrorMessage(null);

      try {
        const { uploadUrl, s3Key } = await presignMutation.mutateAsync({
          uploadType,
          vehicleId,
          fillupId,
          contentType: file.type,
          fileName: file.name,
        });

        await uploadFileToS3(uploadUrl, file);

        setUploadState('success');
        onUploadComplete(s3Key);
      } catch (err) {
        setUploadState('error');
        setErrorMessage(
          err instanceof Error ? err.message : 'Upload failed',
        );
      }
    },
    [uploadType, vehicleId, fillupId, onUploadComplete, presignMutation],
  );

  const handleClear = useCallback(() => {
    setPreview(null);
    setUploadState('idle');
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const label =
    uploadType === 'vehicle-photo' ? 'Vehicle Photo' : 'Receipt Photo';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
        aria-label={`Upload ${label}`}
      />

      {displayImage ? (
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
              aria-label="Remove photo"
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
            <div className="absolute bottom-1 right-1 rounded-full bg-green-600 p-1">
              <Check className="size-3 text-white" />
            </div>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-28 w-full flex-col gap-1"
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadType === 'receipt-photo' ? (
            <Camera className="size-6 text-muted-foreground" />
          ) : (
            <Upload className="size-6 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">{label}</span>
        </Button>
      )}

      {displayImage && uploadState !== 'uploading' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera className="mr-1 size-3" />
          Change Photo
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
