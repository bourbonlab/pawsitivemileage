import { useMutation } from '@tanstack/react-query';
import { apiClient } from './client';

interface PresignRequest {
  uploadType: 'vehicle-photo' | 'receipt-photo' | 'csv-import';
  vehicleId: string;
  fillupId?: string;
  contentType: string;
  fileName: string;
  fileSize: number;
}

interface PresignResponse {
  url: string;
  key: string;
  expiresIn: number;
}

export function usePresignedUpload() {
  return useMutation({
    mutationFn: (data: PresignRequest) =>
      apiClient<PresignResponse>('/v1/upload/presign', {
        method: 'POST',
        body: JSON.stringify({
          uploadType: data.uploadType,
          vehicleId: data.vehicleId,
          filename: data.fileName,
          contentType: data.contentType,
          fileSize: data.fileSize,
        }),
      }),
  });
}

export async function uploadFileToS3(
  presignedUrl: string,
  file: File,
): Promise<void> {
  const res = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}


