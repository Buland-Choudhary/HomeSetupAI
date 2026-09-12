import { mintRealtimeSecret, REALTIME_MODEL, REALTIME_VOICE } from "@/lib/openai";

const SETUP_CHECK_INSTRUCTIONS =
  "You are the voice of a hands-free home-setup assistant, currently running a setup check. " +
  "When the conversation starts, say: 'Voice check passed. I can hear you.' " +
  "If you are shown a photo, describe what you see in one short sentence. Keep every reply to one short sentence.";

export async function POST() {
  const secret = await mintRealtimeSecret({
    instructions: SETUP_CHECK_INSTRUCTIONS,
    audio: { output: { voice: REALTIME_VOICE } },
  });
  if (!secret.ok) return Response.json({ error: secret.error }, { status: 502 });
  return Response.json({ value: secret.value, model: REALTIME_MODEL });
}
