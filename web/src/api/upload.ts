import { useMutation } from '@tanstack/react-query';
import type { OperationBody } from '@pawsitivemileage/sdk';
import { api } from './client';

type PresignBody = OperationBody<'presignUpload'>;

/**
 * Presigned S3 PUT URL for `file`. The content type defaults to the browser's `file.type`; the
 * API rejects types it doesn't accept.
 */
export function usePresignedUpload() {
  return useMutation({
    mutationFn: ({ file, contentType, ...rest }: Pick<PresignBody, 'uploadType' | 'vehicleId'> & { file: File; contentType?: PresignBody['contentType'] }) =>
      api.presignUpload({
        body: { ...rest, filename: file.name, fileSize: file.size, contentType: contentType ?? (file.type as PresignBody['contentType']) },
      }),
  });
}

/** PUT the file to the presigned S3 URL (not an API call, so no token) */
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
