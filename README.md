# Home Setup Agent (working title)

A hands-free AI helper for home setup jobs. Prop your phone up so the camera sees your work area, say what you're doing ("I want to hang a heavy shelf"), and it guides you step by step by voice. It looks at what you're doing, looks up the right method, draws on a photo to show you exactly which screw to use or where the stud is, and speaks up on its own when it sees a mistake or a finished step.

Built at the AI Tinkerers **"Agents, Everywhere"** hackathon (NYC, Sept 12, 2026).

## Why it has to live in the room
Hands full of screws and a stud finder is the worst time to type into a chatbot. This agent runs where the work is happening:
- **It sees the job.** It checks the camera before answering "am I doing this right?" instead of guessing.
- **It keeps watching.** A background watcher notices mistakes, like starting a stud scan on top of a stud, and notices finished steps without being asked.
- **It shows, not just tells.** Circles and lines drawn on a snapshot show *which* screw and *where*.
- **It stays hands-free.** Voice in and out, the screen stays on, and a big "Look now" button is there if you want it.

## Features
| | |
|---|---|
| 🎙️ Real-time voice | OpenAI Realtime (`gpt-realtime-2.1`) over WebRTC with semantic turn detection |
| 👀 `look` | Takes a camera snapshot and reasons over it |
| ✅ `set_plan` / `update_step` | Live step checklist on screen |
| 🔎 `search_guide` | Grounded web lookup (manuals, screw/anchor sizing) via OpenAI web search, or Exa when configured |
| ✏️ `mark_up` | Circles objects and draws lines on a snapshot (vision model returns normalized coordinates) |
| 🛎️ Watcher | Every few seconds, when the scene changed, a fast vision check flags `mistake` or `step_done`. It never talks over anyone and has a cooldown. |

## Architecture
```
Phone browser (Next.js)
 ├─ WebRTC ⇄ OpenAI Realtime ── voice, images, function calls (look, set_plan, update_step, search_guide, mark_up)
 ├─ Watcher loop ── frame diff → POST /api/watch → inject "[watcher] …" when nobody is talking
 └─ UI: camera, checklist, marked-up photo, status

Vercel functions (API key stays server-side)
 ├─ /api/realtime-token  ephemeral Realtime key with instructions + tools
 ├─ /api/search          Responses API + forced web_search (Exa if EXA_API_KEY)
 ├─ /api/watch           Responses API (gpt-5.6-terra, JSON schema) → none | mistake | step_done
 └─ /api/annotate        Responses API (gpt-5.6-terra, JSON schema) → circles/lines
```

## Run it
```bash
cp .env.example .env.local   # add OPENAI_API_KEY (EXA_API_KEY optional)
npm install
npm run dev
```
Camera and mic need HTTPS on phones, so deploy (e.g. `npx vercel deploy`) or use an HTTPS tunnel to test on a phone. `/check` is a setup check page for keys, camera, mic, voice, and vision.

## Built with
- **OpenAI**: Realtime API (voice + vision + tools) and Responses API (web search, structured vision)
- Next.js 16, TypeScript, Tailwind CSS, deployed on Vercel

## Built during the hackathon
Everything in this repo was written on Sept 12, 2026 during the event. The commit history shows the progression: setup check → agent core → web lookup → watcher → photo markup.
