import { structuredVisionResponse } from "@/lib/openai";

const WATCH_MODEL = "gpt-5.6-terra";
const TIMEOUT_MS = 10_000;

const WATCH_INSTRUCTIONS = `You silently watch a home-setup job through a propped-up phone camera, alongside a voice assistant who is guiding the user. Look at the frame and the plan, then report exactly one event:
- "mistake": something visibly wrong or unsafe right now that the user should hear about. Examples: using a tool incorrectly (starting a stud finder scan on top of a stud, sliding it too fast), marking or drilling in the wrong spot, picking hardware that doesn't match the plan, drilling near an outlet or switch.
- "step_done": clear visual evidence that the step marked [doing] (or the next [todo] step) is now complete. Set step to that step number.
- "none": anything else, including when you're unsure, the view is blocked or blurry, or nothing relevant changed. Most frames are "none".
Never repeat your last alert unless the situation got worse. Write message as one short sentence (under 20 words) describing what you see, for the voice assistant to relay. Use an empty message for "none".`;

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["event", "step", "message"],
  properties: {
    event: { type: "string", enum: ["none", "mistake", "step_done"] },
    step: { type: ["integer", "null"] },
    message: { type: "string" },
  },
};

type PlanStep = { title: string; status: string; note?: string };

// One watcher check: compares a camera frame against the plan and reports a clear mistake or a finished step.
export async function POST(request: Request) {
  const { image, goal, steps, lastMessage } = (await request.json().catch(() => ({}))) as {
    image?: unknown;
    goal?: unknown;
    steps?: PlanStep[];
    lastMessage?: unknown;
  };
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return Response.json({ error: "image must be an image data URL" }, { status: 400 });
  }

  const planText = Array.isArray(steps)
    ? steps.map((s, i) => `${i + 1}. ${s.title} [${s.status}]${s.note ? ` (${s.note})` : ""}`).join("\n")
    : "No plan yet.";

  try {
    const verdict = await structuredVisionResponse({
      model: WATCH_MODEL,
      instructions: WATCH_INSTRUCTIONS,
      text: `Goal: ${goal}\nPlan:\n${planText}\n\nYour last alert: ${lastMessage || "none"}`,
      image,
      schemaName: "watcher_verdict",
      schema: VERDICT_SCHEMA,
      timeoutMs: TIMEOUT_MS,
    });
    return Response.json(verdict);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
