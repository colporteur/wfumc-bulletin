// Client-side image helpers for sending photos to Claude vision.
//
// Anthropic's API only accepts image/jpeg, image/png, image/gif, image/webp.
// So we always need to *convert* whatever the user picked into JPEG via
// a canvas. If the browser can't decode the source image at all (some
// HEIC files, AVIF, raw camera files, PDFs accidentally selected), we
// throw a clear error rather than sending bytes Anthropic will reject.

// Try to decode an image file into something we can drawImage(). Returns
// either an ImageBitmap (preferred, supports more formats including HEIC
// on many browsers) or an HTMLImageElement.
async function decodeImage(file) {
  // 1. createImageBitmap — modern, robust, can decode HEIC on browsers
  //    where the OS provides codec support (most recent Android/iOS).
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> fallback
    }
  }

  // 2. HTMLImageElement fallback (older browsers, narrower codec support)
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          `Browser couldn't decode "${file.type || 'unknown format'}".`
        )
      );
    };
    img.src = url;
  });
}

// Prepare an image for upload to Claude vision: decode → downscale to fit
// `maxDim` on the longer side → re-encode as JPEG. Returns { blob, mediaType }.
export async function prepareImageForUpload(
  file,
  maxDim = 1600,
  quality = 0.85
) {
  let source;
  try {
    source = await decodeImage(file);
  } catch (decodeErr) {
    throw new Error(
      `Couldn't read this image (${file.type || 'unknown format'}). ` +
        `Some phone photo formats (like HEIC) aren't supported on every ` +
        `browser. Try the Camera button (which always saves as JPEG), ` +
        `or save the picture in your gallery as JPEG/PNG before uploading.`
    );
  }

  const w = source.width || source.naturalWidth || 0;
  const h = source.height || source.naturalHeight || 0;
  if (!w || !h) {
    throw new Error('Decoded image has zero dimensions — the file may be corrupted.');
  }

  let nw = w;
  let nh = h;
  const longer = Math.max(w, h);
  if (longer > maxDim) {
    const ratio = maxDim / longer;
    nw = Math.round(w * ratio);
    nh = Math.round(h * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, nw, nh);

  // ImageBitmap supports .close() for cleanup; HTMLImageElement doesn't need it.
  if (typeof source.close === 'function') {
    try {
      source.close();
    } catch {
      /* noop */
    }
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error('Canvas toBlob returned null — out of memory?')),
      'image/jpeg',
      quality
    );
  });

  return { blob, mediaType: 'image/jpeg' };
}

// Backwards-compat wrapper: returns just the blob (uses the new pipeline).
export function downsizeImage(file, maxDim = 1600, quality = 0.85) {
  return prepareImageForUpload(file, maxDim, quality).then(({ blob }) => blob);
}

// Convert a Blob to a base64 string (without the "data:..." prefix).
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Read failed.'));
    reader.readAsDataURL(blob);
  });
}
