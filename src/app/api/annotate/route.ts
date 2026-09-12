import { structuredVisionResponse } from "@/lib/openai";

const ANNOTATE_MODEL = "gpt-5.6-terra";
const TIMEOUT_MS = 12_000;

const ANNOTATE_INSTRUCTIONS = `You mark up a photo from a home-setup job so the user can see exactly what the voice assistant means.
- Mark only what was asked, with at most 4 marks.
- Coordinates are fractions of the image: x from 0 (left) to 1 (right), y from 0 (top) to 1 (bottom).
- "circle": put x,y on the center of the object. Set x2 and y2 to null.
- "line": a line to follow, like along a stud or where to draw a level line, from x,y to x2,y2.
- Labels are at most 4 words, like "Use this screw" or "Stud center".
- If you can't find what was asked, return no marks and explain why in note. Otherwise note is an empty string.`;

const MARKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["marks", "note"],
  properties: {
    marks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "shape", "x", "y", "x2", "y2"],
        properties: {
          label: { type: "string" },
          shape: { type: "string", enum: ["circle", "line"] },
          x: { type: "number" },
          y: { type: "number" },
          x2: { type: ["number", "null"] },
          y2: { type: ["number", "null"] },
        },
      },
    },
    note: { type: "string" },
  },
};

// Finds what the agent asked to mark in a photo and returns circles/lines in normalized coordinates.
export async function POST(request: Request) {
  const { image, request: what } = (await request.json().catch(() => ({}))) as { image?: unknown; request?: unknown };
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return Response.json({ error: "image must be an image data URL" }, { status: 400 });
  }
  if (typeof what !== "string" || !what.trim()) return Response.json({ error: "request is required" }, { status: 400 });

  try {
    const result = await structuredVisionResponse({
      model: ANNOTATE_MODEL,
      instructions: ANNOTATE_INSTRUCTIONS,
      text: `Mark: ${what}`,
      image,
      schemaName: "photo_marks",
      schema: MARKS_SCHEMA,
      timeoutMs: TIMEOUT_MS,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
