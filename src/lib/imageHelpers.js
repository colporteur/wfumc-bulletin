// Client-side image helpers for sending photos to Claude vision.

const ANTHROPIC_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB Claude API limit

// Robust "prepare an image for upload" pipeline:
//   1. Try canvas downsize (fast, small payload, costs less to send)
//   2. If canvas can't decode it (HEIC, weird codec, etc.), fall back to
//      sending the original file IF it's already under the API size limit
//   3. Otherwise throw with a clear message about the file's type and size
//
// Returns { blob, mediaType } — the second value is what to put in the
// Anthropic image source's media_type field.
export async function prepareImageForUpload(
  file,
  maxDim = 1600,
  quality = 0.85
) {
  try {
    const blob = await downsizeViaCanvas(file, maxDim, quality);
    return { blob, mediaType: 'image/jpeg' };
  } catch (canvasErr) {
    // Canvas couldn't decode the image. Fall back to the original file
    // if it's small enough for the Anthropic API to accept directly.
    // eslint-disable-next-line no-console
    console.warn(
      `Canvas downsize failed (${canvasErr?.message || canvasErr}); falling back to original file.`
    );
    if (file.size <= ANTHROPIC_MAX_IMAGE_BYTES) {
      // Anthropic accepts: image/jpeg, image/png, image/gif, image/webp
      const acceptable = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const mediaType = acceptable.includes(file.type) ? file.type : 'image/jpeg';
      return { blob: file, mediaType };
    }
    throw new Error(
      `Image is too large to send (${(file.size / (1024 * 1024)).toFixed(1)} MB; max 5 MB) and the browser couldn't downsize it. Try a smaller or different photo. (file type: ${file.type || 'unknown'})`
    );
  }
}

// Internal: downscale via Image + canvas. Throws if the browser can't
// decode the file as an Image (common with HEIC, AVIF, or unusual codecs).
function downsizeViaCanvas(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const { naturalWidth: w, naturalHeight: h } = img;
        if (!w || !h) {
          URL.revokeObjectURL(url);
          return reject(new Error('Image has zero dimensions.'));
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
        ctx.drawImage(img, 0, 0, nw, nh);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error('Canvas toBlob returned null.'));
            resolve(blob);
          },
          'image/jpeg',
          quality
        );
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          `Browser could not decode image of type "${file.type || 'unknown'}".`
        )
      );
    };
    img.src = url;
  });
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
