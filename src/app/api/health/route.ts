import { errorDetail, mintRealtimeSecret, REALTIME_MODEL } from "@/lib/openai";

type Check = { set: boolean; ok: boolean | null; detail?: string };

// Reports whether each credential is configured and actually works. Never returns key values.
export async function GET() {
  const [openai, exa] = await Promise.all([checkOpenAI(), checkExa()]);
  return Response.json({ openai, exa, realtimeModel: REALTIME_MODEL });
}

async function checkOpenAI(): Promise<Check> {
  if (!process.env.OPENAI_API_KEY) return { set: false, ok: null };
  try {
    // Minting a Realtime client secret proves both the key and Realtime model access, at no usage cost.
    const secret = await mintRealtimeSecret({});
    return secret.ok
      ? { set: true, ok: true, detail: `Realtime model ${REALTIME_MODEL} is available` }
      : { set: true, ok: false, detail: secret.error };
  } catch (err) {
    return { set: true, ok: false, detail: String(err) };
  }
}

async function checkExa(): Promise<Check> {
  const key = process.env.EXA_API_KEY;
  if (!key) return { set: false, ok: null, detail: "Optional: web lookups will use OpenAI search instead" };
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "how to use a stud finder", numResults: 1 }),
    });
    return res.ok
      ? { set: true, ok: true, detail: "Search request succeeded" }
      : { set: true, ok: false, detail: await errorDetail(res) };
  } catch (err) {
    return { set: true, ok: false, detail: String(err) };
  }
}
