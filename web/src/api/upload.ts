import { useMutation } from '@tanstack/react-query';
import type { OperationBody } from '@pawsitivemileage/sdk';
import { api } from './client';

type PresignBody = OperationBody<'presignUpload'>;

/**
 * Presigned S3 PUT URL for `file`. The content type defaults to the browser's `file.type`; the
 * API rejects types it doesn't accept. The URL is signed for this content type and the file's
 * size, so the result carries the `contentType` to send with the upload.
 */
export function usePresignedUpload() {
  return useMutation({
    mutationFn: async ({ file, contentType, ...rest }: Pick<PresignBody, 'uploadType' | 'vehicleId'> & { file: File; contentType?: PresignBody['contentType'] }) => {
      const type = contentType ?? (file.type as PresignBody['contentType']);
      const result = await api.presignUpload({
        body: { ...rest, filename: file.name, fileSize: file.size, contentType: type },
      });
      return { ...result, contentType: type };
    },
  });
}

/**
 * PUT the file to the presigned S3 URL (not an API call, so no token). `contentType` must be the
 * type the URL was presigned for: S3 rejects any other.
 */
export async function uploadFileToS3(
  presignedUrl: string,
  file: File,
  contentType: string,
): Promise<void> {
  const res = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}
