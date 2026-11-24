const DEFAULT_MAX_SIDE = 1600;
const MAX_UPLOAD_BYTES = Math.floor(3.5 * 1024 * 1024); // Stay safely under Vercel Hobby's 4.5 MB rewrite body limit.
const QUALITY_STEPS = [0.82, 0.72, 0.6, 0.48] as const;

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

async function encodeWithinBudget(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob | null> {
  const preferredMimes = ["image/webp", "image/jpeg"] as const;
  let best: Blob | null = null;

  for (const mime of preferredMimes) {
    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, mime, quality);
      if (!blob) break;
      // Some browsers silently fall back to image/png when image/webp is unsupported.
      if (mime === "image/webp" && blob.type !== "image/webp") break;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= maxBytes) return blob;
    }
  }

  return best;
}

/**
 * Downscale and compress a photo before upload (default max 1600 px, WebP/JPEG,
 * targeting <= 3.5 MB for Vercel Hobby rewrite limits). Drawing to a canvas also
 * drops EXIF/GPS metadata on the client; the API strips it again server-side.
 * Falls back safely to the original file when canvas/ImageBitmap is unavailable
 * (e.g. jsdom/unit tests).
 */
export async function downscaleImage(
  file: File,
  maxSide = DEFAULT_MAX_SIDE,
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const baseScale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * baseScale));
    let height = Math.max(1, Math.round(bitmap.height * baseScale));

    let best: Blob | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return best ?? file;
      ctx.drawImage(bitmap, 0, 0, width, height);

      const candidate = await encodeWithinBudget(canvas, maxBytes);
      if (candidate && (!best || candidate.size < best.size)) {
        best = candidate;
      }
      if (candidate && candidate.size <= maxBytes) {
        return candidate;
      }

      // If still above the byte target, reduce dimensions by 25% and retry.
      width = Math.max(1, Math.round(width * 0.75));
      height = Math.max(1, Math.round(height * 0.75));
    }

    return best ?? file;
  } finally {
    bitmap.close();
  }
}
