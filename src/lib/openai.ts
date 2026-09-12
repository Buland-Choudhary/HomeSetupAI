export const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
export const REALTIME_VOICE = "marin";

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

// Mints a short-lived key the browser can use to open a Realtime WebRTC session.
// The real OPENAI_API_KEY never leaves the server.
export async function mintRealtimeSecret(session: Record<string, unknown>) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false as const, error: "OPENAI_API_KEY is not set" };

  const res = await fetch(CLIENT_SECRETS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session: { type: "realtime", model: REALTIME_MODEL, ...session } }),
  });
  if (!res.ok) return { ok: false as const, error: await errorDetail(res) };

  const data = (await res.json()) as { value: string; expires_at?: number };
  return { ok: true as const, value: data.value, expiresAt: data.expires_at };
}

// One Responses API call with an image whose reply must match a JSON schema. Returns the parsed reply.
export async function structuredVisionResponse<T>(options: {
  model: string;
  instructions: string;
  text: string;
  image: string;
  schemaName: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
}): Promise<T> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: options.schemaName, strict: true, schema: options.schema } },
      instructions: options.instructions,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: options.text },
            { type: "input_image", image_url: options.image },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!res.ok) throw new Error(await errorDetail(res));

  const data = (await res.json()) as { output?: { type: string; content?: { text?: string }[] }[] };
  const text = data.output?.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("");
  if (!text) throw new Error("empty model reply");
  return JSON.parse(text) as T;
}

// Readable error text from a failed API response, with anything key-like scrubbed
// because these messages can reach a public page.
export async function errorDetail(res: Response) {
  const body = await res.text();
  let message = body;
  try {
    message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
  } catch {}
  return `${res.status}: ${message.replace(/(sk|ek)-[\w*-]+/g, "$1-…").slice(0, 300)}`;
}
