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
