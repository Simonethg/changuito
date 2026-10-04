/**
 * One photo on a chat turn.
 *
 * The bytes are a reference the model reads, the same way a SKU is a reference
 * the grid draws: the shopper does not type a price, and they do not have to
 * type a list that is already in the picture. The server checks the shape
 * before those bytes ever reach the model. A canvas on the browser re-encodes
 * the file first, so a renamed SVG cannot arrive here as an image.
 */

export const IMAGE_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export type ImageMediaType = (typeof IMAGE_MEDIA)[number];

export interface ChatImage {
  mediaType: ImageMediaType;
  /** Standard base64, no `data:` prefix. */
  data: string;
}

/**
 * About 600KB of JPEG. A grocery photo does not need more, and the bytes ride
 * every hop of the turn plus the hour they spend in the turn store.
 */
export const MAX_IMAGE_CHARS = 800_000;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function isChatImage(value: unknown): value is ChatImage {
  if (!value || typeof value !== 'object') return false;
  const v = value as { mediaType?: unknown; data?: unknown };
  if (typeof v.mediaType !== 'string' || !(IMAGE_MEDIA as readonly string[]).includes(v.mediaType)) return false;
  if (typeof v.data !== 'string' || v.data.length === 0 || v.data.length > MAX_IMAGE_CHARS) return false;
  if (v.data.length % 4 !== 0) return false;
  return B64.test(v.data);
}
