"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Checklist, type Plan, type StepStatus } from "@/components/Checklist";
import { captureFrame } from "@/lib/frames";
import { RealtimeSession, type ServerEvent, type ToolHandler } from "@/lib/realtime";

type Status = "idle" | "starting" | "live" | "error";

const STEP_STATUSES: StepStatus[] = ["todo", "doing", "done"];
const STATUS_LABELS: Record<Exclude<Status, "live">, string> = {
  idle: "Not started",
  starting: "Connecting…",
  error: "Disconnected",
};

export default function AgentPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const speakerRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const planRef = useRef<Plan | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);

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
    };
  }, []);

  function commitPlan(next: Plan) {
    planRef.current = next;
    setPlan(next);
  }

  const tools: Record<string, ToolHandler> = {
    look: () => {
      const frame = captureFrame(videoRef.current);
      if (!frame) throw new Error("The camera isn't ready.");
      setPhoto(frame.url);
      return { output: { ok: true, note: "Photo attached in the next message." }, image: frame.url };
    },
    set_plan: ({ goal, steps }) => {
      if (typeof goal !== "string" || !Array.isArray(steps) || steps.length === 0) {
        throw new Error("set_plan needs a goal and at least one step.");
      }
      commitPlan({ goal, steps: steps.map((title) => ({ title: String(title), status: "todo" })) });
      return { output: { ok: true, stepCount: steps.length } };
    },
    update_step: ({ step, status, note }) => {
      const current = planRef.current;
      if (!current) throw new Error("There is no plan yet. Call set_plan first.");
      const index = Number(step) - 1;
      if (!current.steps[index]) throw new Error(`Step ${step} doesn't exist; the plan has ${current.steps.length} steps.`);
      if (!STEP_STATUSES.includes(status as StepStatus)) throw new Error(`Invalid status: ${status}`);
      const steps = current.steps.map((s, i) =>
        i === index ? { ...s, status: status as StepStatus, note: typeof note === "string" && note ? note : s.note } : s,
      );
      commitPlan({ ...current, steps });
      return { output: { ok: true } };
    },
    search_guide: async ({ query }) => {
      if (typeof query !== "string" || !query.trim()) throw new Error("search_guide needs a query.");
      setActivity(`Looking up: ${query}`);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error ?? `Search failed (${res.status})`);
        return { output: result };
      } finally {
        setActivity(null);
      }
    },
  };

  async function start() {
    sessionRef.current?.close();
    setStatus("starting");
    setError(null);
    try {
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

      const session = new RealtimeSession(tools, {
        onOpen: () => {
          setStatus("live");
          session.send({ type: "response.create" });
        },
        onClose: (reason) => {
          session.close();
          setStatus("error");
          setError(`${reason}. Tap Reconnect.`);
          setAgentSpeaking(false);
        },
        onAgentSpeaking: setAgentSpeaking,
        onUserSpeaking: setUserSpeaking,
        onEvent: (event) => {
          const line = describeEvent(event);
          if (line) setLog((prev) => [line, ...prev].slice(0, 40));
        },
      });
      sessionRef.current = session;
      if (!speakerRef.current) throw new Error("Audio output isn't ready.");
      await session.connect(stream.getAudioTracks()[0], speakerRef.current);
    } catch (err) {
      sessionRef.current?.close();
      sessionRef.current = null;
      setStatus("error");
      setError(describeError(err));
    }
  }

  function end() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setStatus("idle");
    setAgentSpeaking(false);
    setUserSpeaking(false);
  }

  function lookNow() {
    const frame = captureFrame(videoRef.current);
    if (!frame || !sessionRef.current) return;
    setPhoto(frame.url);
    sessionRef.current.sendAppMessage(
      "[app] The user tapped Look now. Here is the current photo. Tell them what you notice about their progress and what to do next.",
      frame.url,
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black text-white">
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
      <audio ref={speakerRef} autoPlay />

      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3">
        <StatusPill status={status} agentSpeaking={agentSpeaking} userSpeaking={userSpeaking} />
        <div className="flex gap-4 text-xs text-zinc-300">
          <button onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide log" : "Log"}</button>
          <Link href="/check">Setup check</Link>
        </div>
      </div>

      {activity && (
        <p className="absolute inset-x-3 top-14 z-10 rounded-lg bg-sky-400/95 px-3 py-2 text-sm font-medium text-black">
          🔎 {activity}
        </p>
      )}
      {showLog ? (
        <ol className="absolute inset-x-3 top-14 max-h-[40dvh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/80 p-2 font-mono text-[11px] leading-snug">
          {log.length === 0 ? <li className="text-zinc-400">No events yet</li> : log.map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      ) : (
        photo && (
          // eslint-disable-next-line @next/next/no-img-element -- data URL snapshot
          <img
            src={photo}
            alt="Last photo the agent looked at"
            className="absolute right-3 top-14 w-28 rounded-lg border-2 border-white/80 shadow-lg"
          />
        )
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 rounded-t-2xl bg-zinc-950/85 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="max-h-[38dvh] overflow-y-auto">
          <Checklist plan={plan} />
        </div>
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

function StatusPill({ status, agentSpeaking, userSpeaking }: { status: Status; agentSpeaking: boolean; userSpeaking: boolean }) {
  const [label, dot] =
    status !== "live"
      ? [STATUS_LABELS[status], "bg-zinc-400"]
      : agentSpeaking
        ? ["Speaking", "bg-sky-400 animate-pulse"]
        : userSpeaking
          ? ["Hearing you", "bg-emerald-400 animate-pulse"]
          : ["Listening", "bg-emerald-400"];
  return (
    <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

async function requestWakeLock(ref: RefObject<WakeLockSentinel | null>) {
  try {
    if ("wakeLock" in navigator) ref.current = await navigator.wakeLock.request("screen");
  } catch {
    // Not critical: the screen may dim, but the session keeps running.
  }
}

function describeEvent(event: ServerEvent): string | null {
  if (event.type === "error") return `⚠ ${(event.error as { message?: string } | undefined)?.message ?? "error"}`;
  if (event.type === "response.output_audio_transcript.done") return `agent: ${event.transcript}`;
  if (event.type === "response.done") {
    const output = (event.response as { output?: { type?: string; name?: string; arguments?: string }[] } | undefined)?.output ?? [];
    const calls = output.filter((item) => item.type === "function_call");
    return calls.length ? calls.map((call) => `tool ${call.name}(${call.arguments ?? ""})`).join("\n") : null;
  }
  return null;
}

function describeError(err: unknown) {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
