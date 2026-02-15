import { useMutation } from '@tanstack/react-query';
import { apiClient } from './client';

interface PresignRequest {
  uploadType: 'vehicle-photo' | 'receipt-photo';
  vehicleId: string;
  fillupId?: string;
  contentType: string;
  fileName: string;
}

interface PresignResponse {
  uploadUrl: string;
  s3Key: string;
}

export function usePresignedUpload() {
  return useMutation({
    mutationFn: (data: PresignRequest) =>
      apiClient<PresignResponse>('/v1/upload/presign', {
        method: 'POST',
        body: JSON.stringify(data),
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


