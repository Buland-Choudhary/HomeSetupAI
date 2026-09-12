"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ActivityFeed, formatClock, type Activity } from "@/components/ActivityFeed";
import { Captions } from "@/components/Captions";
import { Checklist, type Plan, type StepStatus } from "@/components/Checklist";
import { MarkedPhoto, type Mark } from "@/components/MarkedPhoto";
import { captureFrame, frameDifference, frameSignature, type Frame } from "@/lib/frames";
import { RealtimeSession, type ToolHandler } from "@/lib/realtime";
import { playShutter } from "@/lib/shutter";
import { useConversation } from "@/lib/useConversation";

type Status = "idle" | "starting" | "live" | "error";
type Screen = "camera" | "details";
type WatchVerdict = { event: "none" | "mistake" | "step_done"; step: number | null; message: string };
type SearchResult = { answer?: string; excerpts?: string[]; sources?: { title: string; url: string }[]; error?: string };

// Watcher pacing: look every few seconds, but only call the model when the scene changed
// (or it's been a while), and never speak up more often than the cooldown allows.
const WATCH_TICK_MS = 3_000;
const WATCH_CHANGE_THRESHOLD = 0.03;
const WATCH_MAX_IDLE_MS = 15_000;
const WATCH_ALERT_COOLDOWN_MS = 10_000;

const STEP_STATUSES: StepStatus[] = ["todo", "doing", "done"];
const STEP_VERBS: Record<StepStatus, string> = { todo: "reset", doing: "started", done: "done" };
const STATUS_LABELS: Record<Exclude<Status, "live">, string> = {
  idle: "Not started",
  starting: "Connecting…",
  error: "Disconnected",
};

// One screen fills the phone; the other sits in a small window in the top-right corner, like a video call.
const FULL_LAYER = "absolute inset-0 z-0";
const PIP_LAYER =
  "absolute right-3 top-3 z-30 h-44 w-28 cursor-pointer overflow-hidden rounded-xl border border-white/40 shadow-2xl";

export default function AgentPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const speakerRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const planRef = useRef<Plan | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const { activities, userCaption, agentCaption, addActivity, updateActivity, handleServerEvent } = useConversation();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [markup, setMarkup] = useState<(Frame & { marks: Mark[] }) | null>(null);
  const [primary, setPrimary] = useState<Screen>("camera");
  const [watching, setWatching] = useState(true);
  const [watchStats, setWatchStats] = useState<{ checks: number; lastAt: number | null }>({ checks: 0, lastAt: null });

  useEffect(() => {
    // The screen wake lock is dropped whenever the page is hidden, so take it again on return.
    const onVisible = () => {
      if (document.visibilityState === "visible" && streamRef.current) void requestWakeLock(wakeLockRef);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      sessionRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void wakeLockRef.current?.release();
      void audioCtxRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (status !== "live" || !watching) return;
    let lastSignature: Uint8Array | null = null;
    let lastCheckAt = 0;
    let lastAlertAt = 0;
    let lastAlert = "";
    let inFlight = false;

    const timer = setInterval(async () => {
      const session = sessionRef.current;
      const plan = planRef.current;
      if (!session || !plan || inFlight || session.busy) return;

      const signature = frameSignature(videoRef.current);
      if (!signature) return;
      const changed = !lastSignature || frameDifference(signature, lastSignature) > WATCH_CHANGE_THRESHOLD;
      if (!changed && Date.now() - lastCheckAt < WATCH_MAX_IDLE_MS) return;
      const frame = captureFrame(videoRef.current, 512);
      if (!frame) return;

      inFlight = true;
      lastSignature = signature;
      lastCheckAt = Date.now();
      try {
        const res = await fetch("/api/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: frame.url, goal: plan.goal, steps: plan.steps, lastMessage: lastAlert }),
        });
        const verdict = (await res.json()) as WatchVerdict & { error?: string };
        if (!res.ok) {
          addActivity({ kind: "error", text: `Watcher check failed: ${verdict.error}` });
          return;
        }
        if (verdict.event === "none") {
          setWatchStats((prev) => ({ checks: prev.checks + 1, lastAt: Date.now() }));
          return;
        }

        // The check took a moment, so make sure nobody started talking in the meantime.
        const cooledDown = Date.now() - lastAlertAt > WATCH_ALERT_COOLDOWN_MS;
        const relay = !session.busy && cooledDown && verdict.message !== lastAlert;
        const summary = verdict.event === "mistake" ? "Possible mistake" : `Step ${verdict.step} looks done`;
        addActivity({
          kind: "watcher",
          text: `${summary}: ${verdict.message}`,
          detail: relay ? "Told the assistant" : "Held back (someone was talking, or it just alerted)",
          image: frame.url,
        });
        if (!relay) return;
        lastAlert = verdict.message;
        lastAlertAt = Date.now();
        playShutter(audioCtxRef.current);
        session.sendAppMessage(`[watcher] ${summary}: ${verdict.message}`, frame.url);
      } catch (err) {
        addActivity({ kind: "error", text: `Watcher check failed: ${describeError(err)}` });
      } finally {
        inFlight = false;
      }
    }, WATCH_TICK_MS);
    return () => clearInterval(timer);
  }, [status, watching, addActivity]);

  function commitPlan(next: Plan) {
    planRef.current = next;
    setPlan(next);
  }

  function takePhoto() {
    const frame = captureFrame(videoRef.current);
    if (!frame) throw new Error("The camera isn't ready.");
    playShutter(audioCtxRef.current);
    return frame;
  }

  // Tool errors go back to the agent (so it can say what went wrong) and into the feed.
  function withErrorFeed(handlers: Record<string, ToolHandler>): Record<string, ToolHandler> {
    return Object.fromEntries(
      Object.entries(handlers).map(([name, handler]) => [
        name,
        async (args: Record<string, unknown>) => {
          try {
            return await handler(args);
          } catch (err) {
            addActivity({ kind: "error", text: `${name} failed: ${describeError(err)}` });
            throw err;
          }
        },
      ]),
    );
  }

  const toolHandlers: Record<string, ToolHandler> = {
    look: ({ reason }) => {
      const frame = takePhoto();
      addActivity({ kind: "photo", text: typeof reason === "string" && reason ? reason : "Checking the scene", image: frame.url });
      setMarkup(null);
      return { output: { ok: true, note: "Photo attached in the next message." }, image: frame.url };
    },
    mark_up: async ({ what_to_mark: what }) => {
      if (typeof what !== "string" || !what.trim()) throw new Error("mark_up needs what_to_mark.");
      const frame = takePhoto();
      const id = addActivity({ kind: "markup", text: `Marking: ${what}`, image: frame.url, pending: true });
      try {
        const res = await fetch("/api/annotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: frame.url, request: what }),
        });
        const result = (await res.json()) as { marks?: Mark[]; note?: string; error?: string };
        if (!res.ok) throw new Error(result.error ?? `Mark-up failed (${res.status})`);
        const marks = result.marks ?? [];
        updateActivity(id, {
          text: marks.length ? `Marked: ${marks.map((m) => m.label).join(", ")}` : `Couldn't find: ${what}`,
          detail: result.note || undefined,
          image: undefined,
          markup: { ...frame, marks },
          pending: false,
        });
        setMarkup({ ...frame, marks });
        return { output: { shownOnScreen: marks.map((m) => m.label), note: result.note } };
      } catch (err) {
        updateActivity(id, { text: `Couldn't mark: ${what}`, pending: false });
        throw err;
      }
    },
    search_guide: async ({ query }) => {
      if (typeof query !== "string" || !query.trim()) throw new Error("search_guide needs a query.");
      const id = addActivity({ kind: "search", text: `Looking up: ${query}`, pending: true });
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        const result = (await res.json()) as SearchResult;
        if (!res.ok) throw new Error(result.error ?? `Search failed (${res.status})`);
        const summary = result.answer ?? result.excerpts?.[0] ?? "";
        const sources = (result.sources ?? []).map((s) => hostname(s.url)).join(", ");
        updateActivity(id, {
          text: `Looked up: ${query}`,
          detail: [truncate(summary, 220), sources && `Sources: ${sources}`].filter(Boolean).join("\n"),
          pending: false,
        });
        return { output: result };
      } catch (err) {
        updateActivity(id, { text: `Lookup failed: ${query}`, pending: false });
        throw err;
      }
    },
    set_plan: ({ goal, steps }) => {
      if (typeof goal !== "string" || !Array.isArray(steps) || steps.length === 0) {
        throw new Error("set_plan needs a goal and at least one step.");
      }
      commitPlan({ goal, steps: steps.map((title) => ({ title: String(title), status: "todo" })) });
      addActivity({ kind: "plan", text: `New plan: ${goal} (${steps.length} steps)` });
      return { output: { ok: true, stepCount: steps.length } };
    },
    update_step: ({ step, status, note }) => {
      const current = planRef.current;
      if (!current) throw new Error("There is no plan yet. Call set_plan first.");
      const index = Number(step) - 1;
      if (!current.steps[index]) throw new Error(`Step ${step} doesn't exist; the plan has ${current.steps.length} steps.`);
      if (!STEP_STATUSES.includes(status as StepStatus)) throw new Error(`Invalid status: ${status}`);
      const nextStatus = status as StepStatus;
      const noteText = typeof note === "string" && note ? note : undefined;
      commitPlan({
        ...current,
        steps: current.steps.map((s, i) => (i === index ? { ...s, status: nextStatus, note: noteText ?? s.note } : s)),
      });
      addActivity({ kind: "plan", text: `Step ${index + 1} ${STEP_VERBS[nextStatus]}: ${current.steps[index].title}`, detail: noteText });
      return { output: { ok: true } };
    },
  };

  async function start() {
    sessionRef.current?.close();
    setStatus("starting");
    setError(null);
    try {
      // Created inside the tap so iOS allows it to play the shutter sound.
      audioCtxRef.current ??= new AudioContext();
      void audioCtxRef.current.resume();

      const stream =
        streamRef.current ??
        (await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        }));
      streamRef.current = stream;
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      void requestWakeLock(wakeLockRef);

      const session = new RealtimeSession(withErrorFeed(toolHandlers), {
        onOpen: () => {
          setStatus("live");
          addActivity({ kind: "system", text: "Connected and listening" });
          session.send({ type: "response.create" });
        },
        onClose: (reason) => {
          session.close();
          setStatus("error");
          setError(`${reason}. Tap Reconnect.`);
          setAgentSpeaking(false);
          addActivity({ kind: "error", text: reason });
        },
        onAgentSpeaking: setAgentSpeaking,
        onUserSpeaking: setUserSpeaking,
        onEvent: handleServerEvent,
      });
      sessionRef.current = session;
      if (!speakerRef.current) throw new Error("Audio output isn't ready.");
      await session.connect(stream.getAudioTracks()[0], speakerRef.current);
    } catch (err) {
      sessionRef.current?.close();
      sessionRef.current = null;
      setStatus("error");
      setError(describeError(err));
      addActivity({ kind: "error", text: `Couldn't start: ${describeError(err)}` });
    }
  }

  function end() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setStatus("idle");
    setAgentSpeaking(false);
    setUserSpeaking(false);
    addActivity({ kind: "system", text: "Session ended" });
  }

  function lookNow() {
    const frame = captureFrame(videoRef.current);
    if (!frame || !sessionRef.current) return;
    playShutter(audioCtxRef.current);
    addActivity({ kind: "photo", text: "You tapped Look now", image: frame.url });
    sessionRef.current.sendAppMessage(
      "[app] The user tapped Look now. Here is the current photo. Tell them what you notice about their progress and what to do next.",
      frame.url,
    );
  }

  const swap = () => setPrimary((screen) => (screen === "camera" ? "details" : "camera"));
  const cameraIsPrimary = primary === "camera";
  const statusLabel =
    status !== "live" ? STATUS_LABELS[status] : agentSpeaking ? "Speaking" : userSpeaking ? "Hearing you" : "Listening";

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black text-white">
      <audio ref={speakerRef} autoPlay />

      <div
        className={cameraIsPrimary ? FULL_LAYER : PIP_LAYER}
        onClick={cameraIsPrimary ? undefined : swap}
        role={cameraIsPrimary ? undefined : "button"}
        aria-label={cameraIsPrimary ? undefined : "Switch to camera"}
      >
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        {!cameraIsPrimary && (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px]">Camera</span>
        )}
      </div>

      <div
        className={cameraIsPrimary ? `${PIP_LAYER} bg-zinc-900/90` : `${FULL_LAYER} bg-zinc-950`}
        onClick={cameraIsPrimary ? swap : undefined}
        role={cameraIsPrimary ? "button" : undefined}
        aria-label={cameraIsPrimary ? "Switch to details" : undefined}
      >
        {cameraIsPrimary ? (
          <DetailsPreview plan={plan} latest={activities.at(-1)} />
        ) : (
          <div className="h-full overflow-y-auto px-4 pb-72 pt-4">
            <div className="flex flex-col gap-1 pr-32">
              <h1 className="text-lg font-semibold">Details</h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                <button onClick={() => setWatching((v) => !v)} className={watching ? "text-emerald-300" : undefined}>
                  {watching ? "👁 Watcher on" : "Watcher off"}
                </button>
                <span>
                  {watchStats.checks} quiet checks{watchStats.lastAt ? ` · last ${formatClock(watchStats.lastAt)}` : ""}
                </span>
                <Link href="/check">Setup check</Link>
              </div>
            </div>
            <section className="mt-4 rounded-xl border border-zinc-800 p-3">
              <Checklist plan={plan} />
            </section>
            <h2 className="mb-2 mt-5 text-xs uppercase tracking-wide text-zinc-400">Activity</h2>
            <ActivityFeed items={activities} />
          </div>
        )}
      </div>

      {cameraIsPrimary && markup && (
        <div className="absolute inset-x-3 top-48 z-20">
          <MarkedPhoto {...markup} onClose={() => setMarkup(null)} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8">
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Captions status={statusLabel} user={userCaption} agent={agentCaption} />
        {status === "live" ? (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={lookNow} className="h-14 rounded-xl bg-white font-semibold text-black">
              Look now
            </button>
            <button onClick={end} className="h-14 rounded-xl bg-zinc-800 font-semibold">
              End
            </button>
          </div>
        ) : (
          <button
            onClick={start}
            disabled={status === "starting"}
            className="h-14 rounded-xl bg-emerald-500 font-semibold text-black disabled:opacity-60"
          >
            {status === "starting" ? "Starting…" : status === "error" ? "Reconnect" : "Start"}
          </button>
        )}
      </div>
    </main>
  );
}

function DetailsPreview({ plan, latest }: { plan: Plan | null; latest?: Activity }) {
  const done = plan?.steps.filter((s) => s.status === "done").length ?? 0;
  return (
    <div className="flex h-full flex-col gap-1 p-2 text-[11px] leading-tight">
      <p className="font-semibold">Details</p>
      <p className="text-zinc-300">{plan ? `${done}/${plan.steps.length} steps done` : "No plan yet"}</p>
      {latest && <p className="line-clamp-5 text-zinc-400">{latest.text}</p>}
      <p className="mt-auto text-center text-[10px] text-zinc-500">Tap to open</p>
    </div>
  );
}

async function requestWakeLock(ref: RefObject<WakeLockSentinel | null>) {
  try {
    if ("wakeLock" in navigator) ref.current = await navigator.wakeLock.request("screen");
  } catch {
    // Not critical: the screen may dim, but the session keeps running.
  }
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function describeError(err: unknown) {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
