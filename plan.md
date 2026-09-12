# Build plan — Home Setup Agent (working title)

> **Status: wrapped up.** The team moved to a friend's project. The Vercel deployment has been taken down, so the links below are historical.

Written 2026-09-12 12:35 PM EDT. **Build ends 3:30 PM · planned submission 3:30–4:00 · hard portal cutoff 4:30 PM.**
Decisions come from [PROJECT.md](PROJECT.md); API details and measurements are in [TECH_NOTES.md](TECH_NOTES.md).

## What we're building
A phone web app you prop up facing your work area. You say your goal ("I want to hang a shelf"). The agent looks things up online, builds a step checklist, and guides you by voice. It takes a snapshot when you ask, marks things up on the photo (the right screw, the stud line), and watches every few seconds, speaking up on its own when you make a mistake or finish a step.

**Why it scores (rubric):** your hands are busy and the context is the physical scene, so a chatbox can't do this (Innovation). Tool use, a watcher loop and failure handling (Technical). A real problem with a clear, controllable voice UX (Usefulness).

---

## Tool choices (researched and tested)

| Need | Choice | Evidence | Rejected alternatives |
|---|---|---|---|
| Voice conversation | **OpenAI Realtime `gpt-realtime-2.1`** over WebRTC; `gpt-realtime-2.1-mini` as a cheaper or faster fallback | Voice and image input **verified on the user's phone**; both models are on the account | Claude has no realtime voice API. Gemini Live isn't a sponsor and would mean a second stack. |
| Connection code | **Raw WebRTC + `oai-events` data channel**, with our own function-call plumbing (~50 lines) | Already working in `src/app/page.tsx` | `@openai/agents/realtime`: nicer API, but its docs didn't load and raw WebRTC is already proven |
| Watcher (periodic vision check) | **Responses API `gpt-5.6-terra`, `reasoning.effort: "low"`**, JSON output; `gpt-5.6-luna` as the cheap fallback | Measured with a 768×432 image: terra-low **1.9s**, luna-low 2.2s, luna-none 3.0s. `minimal` effort is rejected on 5.6 models. | Streaming video frames into Realtime: noisy, and it pollutes the conversation. OpenRouter: not needed. |
| Web lookup (manuals, screw/anchor guidance) | **OpenAI Responses `web_search` tool** (terra/luna, `search_context_size: "low"`); **Exa** used automatically if `EXA_API_KEY` is set | Measured 2.3–2.7s with good answers, **but 0 citations came back**, so it probably didn't search. At build time, force search (`tool_choice`) for model-specific lookups. | Exa-only: no key yet |
| Photo markup | **Grid-overlay technique**: draw a labeled grid on the snapshot and ask for cells or normalized points. The client draws circles and lines on a canvas. | Known weakness: GPT-class vision is imprecise with raw bounding boxes, and a grid improves grounding ([Medium, 2026](https://medium.com/@silverskytechnology/why-gpt-vision-struggles-with-bounding-boxes-and-how-we-fixed-it-1b5d3db5914b)) | Object detection models (YOLO): too much setup for today |
| App and hosting | **Next.js 16 + TypeScript on Vercel**, repo on GitHub | Live at https://home-setup-agent.vercel.app · https://github.com/Buland-Choudhary/HomeSetupAI | Cloud Run: gcloud isn't installed |
| Phone APIs | `getUserMedia` (back camera), Screen Wake Lock, `<audio>` for the WebRTC voice | All verified on the phone | — |

Not used (with reasons): **CopilotKit** is built around chat, and wiring it to live voice costs too much time. **Ambiguous AI** doesn't fit naturally. **Trigger.dev / Auth0** aren't needed. **OpenRouter** isn't needed.

---

## Architecture

```
Phone browser (Next.js page)
 ├─ Camera preview + canvas overlay (markup)      ├─ Checklist panel     ├─ Speaking indicator / debug log
 ├─ WebRTC ⇄ OpenAI Realtime (gpt-realtime-2.1)   ← voice in/out, images, function calls
 │    tools handled in the browser:
 │      look(reason)              → capture frame → function_call_output + input_image → response.create
 │      set_plan(goal, steps[])   → render checklist
 │      update_step(id, status, note)
 │      search_guide(query)       → POST /api/search
 │      mark_up(what_to_mark)     → POST /api/annotate (last snapshot) → draw shapes
 └─ Watcher loop (every ~6s, only if the frame changed) → POST /api/watch
        → {event: none | mistake | step_done, message, step_id}
        → if not speaking & not in cooldown: inject "[watcher] …" item + response.create

Server (Vercel functions, OPENAI_API_KEY never leaves the server)
 ├─ /api/realtime-token  mints ephemeral key with agent instructions + tool schemas
 ├─ /api/search          Exa if key, else Responses + web_search
 ├─ /api/watch           Responses (terra, low effort, JSON schema) with checklist state + frame
 └─ /api/annotate        Responses with grid-overlaid frame → normalized shapes
```

**Rules for when the agent speaks up** (so the watcher doesn't talk over people):
- Only inject when the agent isn't talking (track `output_audio_buffer.started/stopped`) and the user isn't talking (`input_audio_buffer.speech_started/stopped`).
- 10s cooldown after any unprompted message; skip a message that matches the last one.
- Skip the watcher call when the downscaled frame barely changed (cheap pixel diff in the browser).

**Failure handling** (the rubric rewards "thoughtful failure handling"):
- A tool error returns a `function_call_output` with `{error}` so the agent says so out loud.
- When the watcher or search times out, drop the call silently or tell the user.
- If the voice connection fails or drops, show a "Reconnect" button.
- A manual "Look now" button backs up `look` in case voice misfires.

---

## Timeline and milestones

Commit and push at the end of every milestone, then redeploy (`npx vercel deploy --prod --yes`) and test on the phone.

| # | Time (EDT) | Milestone | Done when |
|---|---|---|---|
| M0 | ✅ 12:18 | Setup check, keys, deploy, repo | All phone checks pass (done) |
| **M1** ✅ deployed 12:33 (awaiting phone test) | 12:40–1:20 | **Agent core**: move the setup check to `/check`; new `/` = full-screen camera, big Start button, speaking indicator, checklist panel. Token route carries real instructions and tool schemas. Function-call dispatcher. `look`, `set_plan`, `update_step`. | On the phone: "I want to hang a shelf" → the agent makes a checklist; "what do you see?" → the agent calls `look` and describes the scene |
| **M2** ✅ built 12:42 (search ~4–5s, grounded with sources) | 1:20–1:50 | **Web lookup**: `/api/search` (web_search with forced search; Exa if key) + `search_guide` tool; the agent uses it at kickoff and for "how do I use this stud finder?" | Spoken answer grounded in a lookup (visible in debug log) |
| **M3** ✅ built 12:50 (watch check ~2s, terra low) | 1:50–2:30 | **Watcher**: frame-diff gate, `/api/watch` with JSON schema, the rules for speaking up, `step_done` → `update_step` | Agent speaks up unprompted when a step is visibly done or something's wrong |
| **M4** ✅ built 12:50 (annotate ~1.5s; normalized coordinates were accurate in a synthetic test, so the grid overlay is now only a fallback) | 2:30–2:55 | **Marked-up snapshot**: `/api/annotate` with grid overlay → circles, arrows and lines with labels drawn over the photo; `mark_up` tool | "Which screw should I use?" → the photo shows that screw circled |
| M4.5 | ~1:00 | **Conversation UX** (the user's phone test found voice hiccups in the noisy venue): live captions for both sides, activity feed, swappable camera/details screens, shutter sound on photos, far-field noise reduction + server VAD threshold 0.65, agent takes photos on its own | User confirms captions show what was misheard; fewer cut-offs |
| 🧊 | **2:55** | **Feature freeze** | — |
| M5 | 2:55–3:30 | Make the demo path reliable (prompt tuning, error states, reconnect); write README; **record 2-min video** | Video recorded |
| M6 | 3:30–4:00 | Submit: title, description, public repo ✓, video, social post tagging sponsors | Portal submission confirmed (hard cutoff 4:30) |

**If we fall behind, cut in this order:**
1. Photo markup becomes a text label on screen.
2. The watcher's `step_done` goes (keep mistakes only).
3. The frame-diff gate goes (fixed 8s interval instead).
4. Exa goes (OpenAI search only).

Never cut: M1, working voice + `look`, the watcher speaking up about mistakes.

---

## Agent behavior (for `/api/realtime-token` instructions)
- **Persona:** a calm, experienced handyperson standing behind you. Short spoken sentences, one step at a time, and it confirms before moving on.
- **Kickoff:** when the user states a goal → `search_guide` for the task (and any tool or product model it can see or hear) → `set_plan` with 4–7 concrete steps → say step 1.
- **"What do you see / am I doing this right / what's next"** → `look` before answering; never guess the scene.
- **Choosing between items** (screws, anchors, bits) → `look` then `mark_up` to circle the chosen one, and explain *why* (load, wall type, stud vs. hollow).
- **Safety:** mention hidden wires and pipes near outlets and switches before drilling; stop if something looks dangerous.
- **`[watcher]` messages:** treat them as its own observations, stay brief, and don't repeat itself.
- Stays general across home-setup tasks; nothing is hardcoded to the demo items.

## Files to create or change
- `src/app/check/page.tsx` ← move the current setup check here
- `src/app/page.tsx` → agent UI
- `src/lib/realtime.ts` → WebRTC connect, event bus, `send`, function-call dispatcher, speaking state
- `src/lib/agent-tools.ts` → tool JSON schemas (shared with the token route) and browser handlers
- `src/lib/frames.ts` → capture, downscale, frame diff, grid overlay
- `src/components/` → `CameraView` (video + markup canvas), `Checklist`, `StatusBar`
- `src/app/api/realtime-token/route.ts` → instructions + tools
- `src/app/api/search/route.ts`, `src/app/api/watch/route.ts`, `src/app/api/annotate/route.ts`

## Open risks
| Risk | Mitigation |
|---|---|
| The watcher calls a step done that isn't | Require step-specific visual evidence in the prompt; ask the user to confirm rather than silently ticking it off |
| Photo markup lands in the wrong spot | Grid overlay, a big label, and a circle with generous radius; cut to a text label if it's still bad at 2:55 |
| Loud venue breaks voice turn-taking | `semantic_vad`; test at the venue early in M1; "Look now" button as backup |
| Anyone with the URL can use your OpenAI credits | Keep the URL private today; add an optional passcode if there's time |
| Image data-channel message size on iOS | Snapshots are capped at 768px JPEG q0.7 (~40–80KB, verified working) |

## Submission checklist
- [ ] Project title
- [ ] Description: what it is, who it's for, why the physical setting is essential
- [x] Public GitHub repo (commit often, since timestamps show it was built today)
- [ ] README: what it does, architecture sketch, how to run, sponsors used (OpenAI)
- [ ] 2-minute demo video
- [ ] Social post tagging event partners
- [ ] Submitted in the portal before 4:30 PM (target 4:00)
