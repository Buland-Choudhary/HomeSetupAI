import { AGENT_INSTRUCTIONS, AGENT_TOOLS } from "@/lib/agent";
import { mintRealtimeSecret, REALTIME_MODEL, REALTIME_VOICE } from "@/lib/openai";

// Mints a short-lived Realtime key with the agent's instructions and tools baked into the session.
export async function POST() {
  const secret = await mintRealtimeSecret({
    instructions: AGENT_INSTRUCTIONS,
    tools: AGENT_TOOLS,
    tool_choice: "auto",
    audio: {
      input: { turn_detection: { type: "semantic_vad" } },
      output: { voice: REALTIME_VOICE },
    },
  });
  if (!secret.ok) return Response.json({ error: secret.error }, { status: 502 });
  return Response.json({ value: secret.value, model: REALTIME_MODEL });
}
