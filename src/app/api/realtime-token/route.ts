import { AGENT_AUDIO_INPUT, AGENT_INSTRUCTIONS, AGENT_TOOLS } from "@/lib/agent";
import { mintRealtimeSecret, REALTIME_MODEL, REALTIME_VOICE } from "@/lib/openai";

// Mints a short-lived Realtime key with the agent's instructions, tools, and audio tuning baked into the session.
export async function POST() {
  const secret = await mintRealtimeSecret({
    instructions: AGENT_INSTRUCTIONS,
    tools: AGENT_TOOLS,
    tool_choice: "auto",
    audio: { input: AGENT_AUDIO_INPUT, output: { voice: REALTIME_VOICE } },
  });
  if (!secret.ok) return Response.json({ error: secret.error }, { status: 502 });
  return Response.json({ value: secret.value, model: REALTIME_MODEL });
}
