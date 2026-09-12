export type Frame = { url: string; kb: number };

// Grabs the current video frame as a JPEG data URL, downscaled so it stays small enough for the data channel.
export function captureFrame(video: HTMLVideoElement | null, maxWidth = 768): Frame | null {
  if (!video?.videoWidth) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.7);
  return { url, kb: Math.round((url.length * 3) / 4 / 1024) };
}

const SIGNATURE_WIDTH = 32;
const SIGNATURE_HEIGHT = 18;

// Tiny grayscale thumbnail used to tell whether the scene changed between watcher checks.
export function frameSignature(video: HTMLVideoElement | null): Uint8Array | null {
  if (!video?.videoWidth) return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIGNATURE_WIDTH;
  canvas.height = SIGNATURE_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  const { data } = ctx.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  const gray = new Uint8Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 3 + data[i * 4 + 1] * 6 + data[i * 4 + 2]) / 10;
  return gray;
}

// Mean absolute pixel difference between two signatures, from 0 (identical) to 1.
export function frameDifference(a: Uint8Array, b: Uint8Array) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}
