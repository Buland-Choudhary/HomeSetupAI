"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "working" | "ok" | "error";
type Step = { status: Status; detail?: string };
type Check = { set: boolean; ok: boolean | null; detail?: string };
type Health = { openai: Check; exa: Check; realtimeModel: string };
type RealtimeEvent = { type: string; transcript?: unknown; error?: { message?: string } };

const SNAPSHOT_MAX_WIDTH = 768;
const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

// Setup check: verifies keys, camera, mic, Realtime voice, and Realtime image input from the phone.
export default function SetupCheck() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const [health, setHealth] = useState<Health | null>(null);
  const [server, setServer] = useState<Step>({ status: "working" });
  const [secure, setSecure] = useState<boolean | null>(null);
  const [camera, setCamera] = useState<Step>({ status: "idle" });
  const [wakeLock, setWakeLock] = useState("not requested yet");
  const [voice, setVoice] = useState<Step>({ status: "idle" });
  const [snapshot, setSnapshot] = useState<{ url: string; kb: number } | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: Health) => {
        setHealth(data);
        setServer({ status: "ok" });
        setSecure(window.isSecureContext);
      })
      .catch((err) => setServer({ status: "error", detail: describeError(err) }));
  }, []);

  useEffect(
    () => () => {
      pcRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void audioCtxRef.current?.close();
    },
    [],
  );

  async function startCamera() {
    setCamera({ status: "working" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      startMicMeter(stream);
      const settings = stream.getVideoTracks()[0]?.getSettings();
      setCamera({
        status: "ok",
        detail: `${settings?.width}×${settings?.height}, facing ${settings?.facingMode ?? "unknown"}`,
      });
    } catch (err) {
      setCamera({ status: "error", detail: describeError(err) });
      return;
    }

    try {
      if ("wakeLock" in navigator) {
        await navigator.wakeLock.request("screen");
        setWakeLock("active: screen will stay on");
      } else {
        setWakeLock("not supported in this browser");
      }
    } catch (err) {
      setWakeLock(`failed: ${describeError(err)}`);
    }
  }

  function startMicMeter(stream: MediaStream) {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    void ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    const tick = () => {
      if (ctx.state === "closed") return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += ((s - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / samples.length);
      if (meterRef.current) meterRef.current.style.width = `${Math.min(100, rms * 400)}%`;
      requestAnimationFrame(tick);
    };
    tick();
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video?.videoWidth) return null;
    const scale = Math.min(1, SNAPSHOT_MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.7);
    return { url, kb: Math.round((url.length * 3) / 4 / 1024) };
  }

  async function connectVoice() {
    setVoice({ status: "working", detail: "Getting a session key…" });
    setEvents([]);
    try {
      const tokenRes = await fetch("/api/realtime-token", { method: "POST" });
      const token = (await tokenRes.json()) as { value?: string; model?: string; error?: string };
      if (!tokenRes.ok || !token.value) throw new Error(token.error ?? `Token request failed (${tokenRes.status})`);

      const mic =
        streamRef.current?.getAudioTracks()[0] ??
        (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0];

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.ontrack = (e) => {
        if (!audioRef.current) return;
        audioRef.current.srcObject = e.streams[0];
        audioRef.current.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setVoice({ status: "error", detail: `Connection ${pc.connectionState}` });
        }
      };
      pc.addTrack(mic);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => {
        setVoice({ status: "ok", detail: `Connected to ${token.model}. It should speak now.` });
        dc.send(JSON.stringify({ type: "response.create" }));
      };
      dc.onmessage = (e) => logEvent(JSON.parse(e.data) as RealtimeEvent);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      setVoice({ status: "working", detail: "Connecting to OpenAI…" });
      const sdpRes = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" },
      });
      const sdp = await sdpRes.text();
      if (!sdpRes.ok) throw new Error(`OpenAI rejected the call (${sdpRes.status}): ${sdp.slice(0, 200)}`);
      await pc.setRemoteDescription({ type: "answer", sdp });
    } catch (err) {
      closeVoice();
      setVoice({ status: "error", detail: describeError(err) });
    }
  }

  function closeVoice() {
    dcRef.current?.close();
    pcRef.current?.close();
    dcRef.current = null;
    pcRef.current = null;
  }

  function logEvent(event: RealtimeEvent) {
    if (event.type.endsWith(".delta")) return;
    let line = event.type;
    if (event.type === "error") line = `error: ${event.error?.message ?? "unknown"}`;
    else if (typeof event.transcript === "string") line = `agent said: "${event.transcript}"`;
    setEvents((prev) => [line, ...prev].slice(0, 12));
  }

  function askAboutSnapshot() {
    const dc = dcRef.current;
    const frame = captureFrame();
    if (!dc || dc.readyState !== "open" || !frame) return;
    setSnapshot(frame);
    dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Setup check: in one short sentence, what do you see in this photo?" },
            { type: "input_image", image_url: frame.url },
          ],
        },
      }),
    );
    dc.send(JSON.stringify({ type: "response.create" }));
  }

  const voiceOpen = voice.status === "ok";

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4 text-zinc-900">
      <header>
        <h1 className="text-2xl font-semibold">Setup check</h1>
        <p className="text-sm text-zinc-600">Go through each step on the phone you&apos;ll use for the demo.</p>
      </header>

      <Card title="1. Server & keys" status={server}>
        {secure === false && (
          <p className="text-sm text-red-700">Page isn&apos;t on HTTPS, so the camera and mic will be blocked.</p>
        )}
        {health && (
          <>
            <KeyRow name="OpenAI" check={health.openai} />
            <KeyRow name="Exa (optional)" check={health.exa} />
          </>
        )}
      </Card>

      <Card title="2. Camera & mic" status={camera}>
        <video ref={videoRef} playsInline muted autoPlay className="aspect-video w-full rounded-lg bg-zinc-900 object-cover" />
        <div className="h-2 w-full overflow-hidden rounded bg-zinc-200" aria-label="Mic level">
          <div ref={meterRef} className="h-full w-0 bg-emerald-500 transition-[width] duration-75" />
        </div>
        <p className="text-xs text-zinc-600">Talk and the green bar should move. Wake lock: {wakeLock}</p>
        <Button onClick={startCamera} disabled={camera.status === "working" || camera.status === "ok"}>
          Start camera & mic
        </Button>
      </Card>

      <Card title="3. Voice agent" status={voice}>
        <audio ref={audioRef} autoPlay />
        {voiceOpen ? (
          <Button
            onClick={() => {
              closeVoice();
              setVoice({ status: "idle" });
            }}
          >
            Disconnect
          </Button>
        ) : (
          <Button onClick={connectVoice} disabled={voice.status === "working"}>
            Connect & talk
          </Button>
        )}
        {events.length > 0 && (
          <ol className="max-h-40 overflow-y-auto rounded bg-zinc-100 p-2 font-mono text-xs">
            {events.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="4. Vision" status={{ status: snapshot ? "ok" : "idle" }}>
        <p className="text-xs text-zinc-600">Needs steps 2 and 3. The agent should describe what the camera sees.</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview */}
        {snapshot && <img src={snapshot.url} alt="Snapshot sent to the agent" className="w-full rounded-lg" />}
        {snapshot && <p className="text-xs text-zinc-600">Sent {snapshot.kb} KB</p>}
        <Button onClick={askAboutSnapshot} disabled={!voiceOpen || camera.status !== "ok"}>
          Send snapshot to agent
        </Button>
      </Card>
    </main>
  );
}

function Card({ title, status, children }: { title: string; status: Step; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">{title}</h2>
        <Badge status={status.status} />
      </div>
      {status.detail && (
        <p className={`text-sm ${status.status === "error" ? "text-red-700" : "text-zinc-600"}`}>{status.detail}</p>
      )}
      {children}
    </section>
  );
}

function KeyRow({ name, check }: { name: string; check: Check }) {
  const status: Status = !check.set ? "idle" : check.ok ? "ok" : "error";
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between">
        <span>{name}</span>
        <Badge status={status} label={check.set ? undefined : "not set"} />
      </div>
      {check.detail && <p className={status === "error" ? "text-red-700" : "text-zinc-600"}>{check.detail}</p>}
    </div>
  );
}

const BADGE_STYLES: Record<Status, string> = {
  idle: "bg-zinc-200 text-zinc-700",
  working: "bg-amber-100 text-amber-800",
  ok: "bg-emerald-100 text-emerald-800",
  error: "bg-red-100 text-red-800",
};
const BADGE_LABELS: Record<Status, string> = { idle: "not started", working: "working…", ok: "OK", error: "failed" };

function Badge({ status, label }: { status: Status; label?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[status]}`}>
      {label ?? BADGE_LABELS[status]}
    </span>
  );
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="h-12 w-full rounded-lg bg-zinc-900 font-medium text-white disabled:bg-zinc-300 disabled:text-zinc-500"
    />
  );
}

function describeError(err: unknown) {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
