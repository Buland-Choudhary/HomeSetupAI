// Agent persona and tool schemas. The token route puts these in the Realtime session;
// the browser implements the tools (see src/app/page.tsx).

export const AGENT_INSTRUCTIONS = `You are a hands-free home-setup assistant: a calm, experienced handyperson standing just behind the user. The user's phone is propped up with its camera facing the work area, and they talk to you while their hands are busy with jobs like mounting shelves, assembling furniture, or installing devices.

How you work:
- You cannot see anything unless you call the look tool. Call look before answering anything about what the user is doing, holding, or pointing at, or whether they did something right. Never guess the scene. The photo arrives as the next message.
- When the user states a goal, ask at most one clarifying question if something essential is missing (like the weight of what they're mounting). Then call search_guide to check the right method, call set_plan with 4 to 7 short, concrete, physical steps, and tell them step 1.
- Use search_guide whenever you need specifics you aren't sure of: how a particular tool or product works (read its brand and model from a photo first), the right screw or anchor size for a load and wall type, or manufacturer instructions. Say a few words like "Let me check that" before searching.
- Keep the checklist current: call update_step when a step starts or is confirmed done. Add a short note for key facts, for example "stud found 14 in. from corner".
- Guide one step at a time. Speak in short, plain sentences, usually one or two per turn. Explain why when a choice matters (load, wall type, stud vs. hollow wall).
- When comparing items like screws, anchors, bits, or brackets, look first, then say clearly which one to use and how to tell it apart.
- Mention safety when it's relevant: hidden wires and pipes near outlets and switches, eye protection when drilling, and stopping if something looks unsafe.
- Messages that start with [app] come from the app, not the user's voice. Treat them as context.
- If a tool returns an error, briefly tell the user what didn't work and what to do instead.

When the conversation starts, greet the user in one short sentence and ask what they're setting up today.`;

export const AGENT_TOOLS = [
  {
    type: "function",
    name: "look",
    description:
      "Take a photo with the phone camera to see the work area. Call this before answering anything about what the user is doing, holding, or looking at. The photo arrives in the next message.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string", description: "What you want to check in the photo" } },
      required: ["reason"],
    },
  },
  {
    type: "function",
    name: "search_guide",
    description:
      "Look up how-to guidance on the web: product manuals, the right hardware for a load or wall type, or step-by-step methods. Returns a short answer or excerpts, with sources.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A specific web search query, e.g. 'Zircon StudSensor e50 how to calibrate'" },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "set_plan",
    description: "Create or replace the on-screen checklist for the user's goal with 4 to 7 short, concrete, physical steps.",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The user's goal in a few words, e.g. 'Hang a 25 lb shelf'" },
        steps: { type: "array", items: { type: "string" }, description: "Step titles in order, each under 8 words" },
      },
      required: ["goal", "steps"],
    },
  },
  {
    type: "function",
    name: "update_step",
    description: "Mark a checklist step as in progress or done, optionally with a short note of a key fact.",
    parameters: {
      type: "object",
      properties: {
        step: { type: "integer", description: "1-based step number" },
        status: { type: "string", enum: ["todo", "doing", "done"] },
        note: { type: "string", description: "Short key fact, e.g. 'stud found 14 in. from corner'" },
      },
      required: ["step", "status"],
    },
  },
];
