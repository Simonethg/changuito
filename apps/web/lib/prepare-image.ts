import { MAX_IMAGE_CHARS, type ChatImage } from './chat-image.ts';

/** A phone photo is often 8–12MB. Past this we do not even decode it. */
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 1280;

export type PrepareImageResult =
  | { ok: true; image: ChatImage }
  | { ok: false; reason: 'unread' | 'huge' };

/**
 * Shrink a picked or captured photo to a JPEG the turn can carry.
 *
 * Re-encoding is the check, not the file extension: the canvas only paints
 * pixels, so whatever the shopper attached comes out as a JPEG or it does
 * not come out at all.
 */
export async function prepareImage(file: File): Promise<PrepareImageResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'huge' };
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { ok: false, reason: 'unread' };
      ctx.drawImage(bitmap, 0, 0, width, height);
      let quality = 0.72;
      let data = await canvasToBase64(canvas, quality);
      while (data && data.length > MAX_IMAGE_CHARS && quality > 0.4) {
        quality -= 0.12;
        data = await canvasToBase64(canvas, quality);
      }
      if (!data || data.length > MAX_IMAGE_CHARS) return { ok: false, reason: 'huge' };
      return { ok: true, image: { mediaType: 'image/jpeg', data } };
    } finally {
      bitmap.close();
    }
  } catch {
    return { ok: false, reason: 'unread' };
  }
}

function canvasToBase64(canvas: HTMLCanvasElement, quality: number): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const url = typeof reader.result === 'string' ? reader.result : '';
          const comma = url.indexOf(',');
          resolve(comma >= 0 ? url.slice(comma + 1) : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}
