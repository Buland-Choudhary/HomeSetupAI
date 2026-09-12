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
