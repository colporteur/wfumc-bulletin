// Client-side image helpers for sending photos to Claude vision.

// Downscale an image (Blob/File) to fit within `maxDim` pixels on the
// longer side, returning a JPEG blob. Phone photos are usually 4-12 MB;
// this gets them down to a few hundred KB while still being plenty
// readable for OCR.
export function downsizeImage(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const { naturalWidth: w, naturalHeight: h } = img;
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
            if (!blob) return reject(new Error('Image conversion failed.'));
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
      reject(new Error('Could not load image.'));
    };
    img.src = url;
  });
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
