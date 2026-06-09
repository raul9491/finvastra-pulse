/**
 * Client-side image compression — runs in the browser before upload so the large
 * original never leaves the device (cheapest way to keep Storage usage tiny).
 *
 * Resizes to a max dimension and re-encodes to JPEG. Respects EXIF orientation
 * (phone photos). Non-images and undecodable files (e.g. some HEIC) pass through
 * unchanged. PDFs are NOT compressed — pass them straight through.
 */
export async function compressImage(
  file: File,
  opts?: { maxDim?: number; quality?: number },
): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  const maxDim  = opts?.maxDim  ?? 1600;
  const quality = opts?.quality ?? 0.7;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    return file; // can't decode in this browser → upload the original
  }

  let { width, height } = bitmap;
  if (Math.max(width, height) > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width  = Math.round(width  * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close?.(); return file; }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file; // compression didn't help — keep original

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}

/** Human-readable file size, e.g. "284 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
