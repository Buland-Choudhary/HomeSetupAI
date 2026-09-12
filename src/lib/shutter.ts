// A short synthesized camera-shutter click, so no audio file is needed.
export function playShutter(ctx: AudioContext | null) {
  if (!ctx) return;
  for (const offset of [0, 0.07]) {
    const duration = 0.05;
    const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * duration), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 3;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.4;
    source.connect(gain).connect(ctx.destination);
    source.start(ctx.currentTime + offset);
  }
}
