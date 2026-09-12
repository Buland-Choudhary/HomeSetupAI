# Project — hands-free home-setup agent (working title TBD)

## Concept
A phone web app you prop up so its camera sees the whole work area while you do home-setup tasks (mounting a shelf, assembling furniture, etc.). You talk to it hands-free; when you ask for help it takes a snapshot, figures out where you are in the task, and tells you the next step. It also quietly watches every few seconds and warns you about mistakes.

Theme fit: "In the room" environment. Hands are busy and the context is the physical scene, so this can't work as a standalone chatbox.

## Decisions (2026-09-12, ~11:40 AM)
| Topic | Decision |
|---|---|
| Demo scenario | Wall mounting: teammate has a **stud finder** and **2 types of screws**. Agent helps identify the wall type (and studs), picks the right screw for that wall, and explains how to tell the screws apart. |
| Step/knowledge source | **Search online** for manuals/guidance (e.g. stud finder model manual, screw/anchor specs), likely via Exa (sponsor). |
| Form factor | **Phone web app** in a mobile browser (camera + mic, needs HTTPS). |
| Interaction | **Hands-free voice + proactive watching**: snapshot on request, plus periodic background checks that warn about mistakes. |
| Pitch | **General home-setup assistant**; the video shows one job (wall mounting). |
| Team | **Solo**: the user plus Claude write all the code. A teammate provides the stud finder and screws. |
| Hosting | **Vercel** (HTTPS for phone camera and mic) |
| AI stack | **OpenAI for everything**: Realtime API for voice, vision and tools; a small OpenAI vision model for the watcher. Claude was ruled out because it has no realtime voice API. |
| Phone | Must work on **both iOS Safari and Android Chrome** |
| Watcher behavior | Speaks up about **mistakes AND when a step is finished** (gives the next step unprompted) |
| Mounted item | Not decided; Claude to suggest the best demo story |
| Demo wall | **Venue wall, no drilling.** The video ends at "marked and ready to drill". |
| Screen visuals | **Marked-up snapshot**: the agent draws on the photo it took (circles the right screw, marks the stud line, etc.) |
| Screws | Must identify any screw from the camera, not hardcoded. Test early with the teammate's actual screws. |
| Session start | **Say the goal** ("I want to hang a shelf"). The agent searches online, builds the steps, and looks at the scene. |

### Deferred by the user ("later")
Demo story/mounted item, which mistake to stage for the watcher, how to record the video, and stretch features (knock test, job summary, safety checks). Don't ask again until the core app works.

## Proposed architecture (draft, not yet confirmed)
- **Phone web app** (Next.js + TypeScript): rear camera preview, mic, and a big on-screen task checklist (wall type → stud located → screw chosen → mount).
- **Voice brain:** OpenAI Realtime (`gpt-realtime-2.1`) over WebRTC, with semantic VAD for hands-free use. The server mints the ephemeral key.
- **Tools the voice model can call:**
  - `look()`: the client grabs a camera frame and sends it as `input_image`, then the model responds
  - `search_guide(query)`: server → Exa, e.g. stud finder model manual, screw vs. wall-anchor guidance
  - `update_task(step, facts)`: updates the on-screen checklist (wall type, stud found, chosen screw)
- **Watcher loop:** every ~5–8 s a low-res frame plus the task state go to a separate fast vision call. It returns `{alert, message}`. On an alert, the message is injected into the realtime conversation and a `response.create` is sent, so the agent speaks up on its own.
- **Wall-type identification combines several signals:** vision (outlet box edges, texture), stud finder readings read off the device, guided tests (knock test the mic can hear, magnet test for screws in studs), and the weight of what's being mounted.

## Status
- 12:18 PM: setup check page deployed to **https://home-setup-agent.vercel.app** (Vercel project `home-setup-agent`, team buland-choudharys-projects). `OPENAI_API_KEY` is set in Vercel production and `.env.local`, and `gpt-realtime-2.1` is confirmed available. No Exa key yet.
- Redeploy: `npx vercel deploy --prod --yes`. Local dev: `npm run dev` (`.claude/launch.json` → "web").
- 12:30 PM: all phone checks passed (camera, mic, voice, vision). Repo https://github.com/Buland-Choudhary/HomeSetupAI (public), pushed over SSH. OpenRouter credits were offered but deliberately not used.
- 12:35 PM: build plan written in `plan.md`.

## Open questions
- Team size and who builds what; preferred language/stack
- OpenAI API key / credits available?
- What's being mounted (weight matters for screw/anchor choice) and what wall is available at the venue for filming?
- GitHub account for the required public repo
