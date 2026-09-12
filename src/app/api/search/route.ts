import { errorDetail } from "@/lib/openai";

const SEARCH_MODEL = "gpt-5.6-luna";
const TIMEOUT_MS = 15_000;

type Source = { title: string; url: string };
type SearchResult = { provider: "exa" | "openai"; answer?: string; excerpts?: string[]; sources: Source[] };

// Web lookup for the voice agent: Exa when a key is set, otherwise OpenAI web search.
// The OpenAI search is forced so answers are grounded in a real page, not model memory.
export async function POST(request: Request) {
  const { query } = (await request.json().catch(() => ({}))) as { query?: unknown };
  if (typeof query !== "string" || !query.trim()) return Response.json({ error: "query is required" }, { status: 400 });

  const errors: string[] = [];
  if (process.env.EXA_API_KEY) {
    try {
      return Response.json(await searchExa(query));
    } catch (err) {
      errors.push(`Exa: ${describeError(err)}`);
    }
  }
  try {
    return Response.json(await searchOpenAI(query));
  } catch (err) {
    errors.push(`OpenAI: ${describeError(err)}`);
  }
  return Response.json({ error: errors.join("; ") }, { status: 502 });
}

async function searchExa(query: string): Promise<SearchResult> {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": process.env.EXA_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ query, numResults: 3, contents: { highlights: true } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await errorDetail(res));

  const data = (await res.json()) as { results?: { title?: string; url: string; highlights?: string[] }[] };
  const results = data.results ?? [];
  if (results.length === 0) throw new Error("no results");
  return {
    provider: "exa",
    excerpts: results.flatMap((r) => r.highlights ?? []).slice(0, 6),
    sources: results.map((r) => ({ title: r.title ?? r.url, url: r.url })),
  };
}

async function searchOpenAI(query: string): Promise<SearchResult> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: SEARCH_MODEL,
      reasoning: { effort: "low" },
      tools: [{ type: "web_search", search_context_size: "low" }],
      tool_choice: { type: "web_search" },
      instructions:
        "You research for a voice assistant that is guiding someone through a home setup job right now. " +
        "Answer in 2 to 4 short plain sentences with concrete specifics (sizes, lengths, weights, steps). No markdown.",
      input: query,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await errorDetail(res));

  type Annotation = { type: string; url?: string; title?: string };
  const data = (await res.json()) as {
    output?: { type: string; content?: { text?: string; annotations?: Annotation[] }[] }[];
  };
  const content = data.output?.filter((o) => o.type === "message").flatMap((o) => o.content ?? []) ?? [];
  // Drop inline markdown citations like "([site](url))" so the voice agent never reads URLs aloud.
  const answer = content
    .map((c) => c.text ?? "")
    .join("")
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
  if (!answer) throw new Error("empty answer");

  const citations = content.flatMap((c) => c.annotations ?? []).filter((a) => a.type === "url_citation" && a.url);
  const sources = [...new Map(citations.map((a) => [a.url, { title: a.title ?? a.url ?? "", url: a.url ?? "" }])).values()];
  return { provider: "openai", answer, sources };
}

function describeError(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
