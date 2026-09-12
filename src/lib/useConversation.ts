import { useCallback, useRef, useState } from "react";
import type { Activity } from "@/components/ActivityFeed";
import type { ServerEvent } from "@/lib/realtime";

const MAX_ACTIVITIES = 200;

type Transcript = { activityId: string; text: string };

// Turns Realtime events into live captions and a conversation feed, and lets tools add their own feed entries.
export function useConversation() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [userCaption, setUserCaption] = useState("");
  const [agentCaption, setAgentCaption] = useState("");
  const heardRef = useRef(new Map<string, Transcript>());
  const saidRef = useRef(new Map<string, Transcript>());
  const nextIdRef = useRef(0);

  const addActivity = useCallback((entry: Omit<Activity, "id" | "time">) => {
    const id = `activity-${nextIdRef.current++}`;
    setActivities((prev) => [...prev, { ...entry, id, time: Date.now() }].slice(-MAX_ACTIVITIES));
    return id;
  }, []);

  const updateActivity = useCallback((id: string, patch: Partial<Omit<Activity, "id">>) => {
    setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      const itemId = typeof event.item_id === "string" ? event.item_id : "";
      // One feed entry per spoken item, created on the first event we see for it.
      const transcriptFor = (map: Map<string, Transcript>, kind: "heard" | "said") => {
        let entry = map.get(itemId);
        if (!entry) {
          entry = { activityId: addActivity({ kind, text: kind === "heard" ? "Listening…" : "…", pending: true }), text: "" };
          map.set(itemId, entry);
        }
        return entry;
      };

      switch (event.type) {
        case "input_audio_buffer.speech_started":
          transcriptFor(heardRef.current, "heard");
          setUserCaption("Listening…");
          break;
        case "conversation.item.input_audio_transcription.delta": {
          const entry = transcriptFor(heardRef.current, "heard");
          entry.text += String(event.delta ?? "");
          setUserCaption(entry.text);
          updateActivity(entry.activityId, { text: entry.text });
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          const entry = transcriptFor(heardRef.current, "heard");
          entry.text = String(event.transcript ?? "").trim();
          setUserCaption(entry.text || "(couldn't make that out)");
          updateActivity(entry.activityId, {
            text: entry.text || "No words recognized (probably background noise)",
            pending: false,
          });
          break;
        }
        case "conversation.item.input_audio_transcription.failed": {
          const entry = transcriptFor(heardRef.current, "heard");
          updateActivity(entry.activityId, { kind: "error", text: "Couldn't transcribe what you said", pending: false });
          break;
        }
        case "response.output_audio_transcript.delta": {
          const entry = transcriptFor(saidRef.current, "said");
          entry.text += String(event.delta ?? "");
          setAgentCaption(entry.text);
          updateActivity(entry.activityId, { text: entry.text });
          break;
        }
        case "response.output_audio_transcript.done": {
          const entry = transcriptFor(saidRef.current, "said");
          entry.text = String(event.transcript ?? entry.text);
          setAgentCaption(entry.text);
          updateActivity(entry.activityId, { text: entry.text, pending: false });
          break;
        }
        case "response.done": {
          const response = event.response as
            | { status?: string; status_details?: { reason?: string }; output?: { id?: string }[] }
            | undefined;
          if (response?.status !== "cancelled") break;
          for (const item of response.output ?? []) {
            const entry = item.id ? saidRef.current.get(item.id) : undefined;
            if (entry) updateActivity(entry.activityId, { text: `${entry.text} —`, pending: false });
          }
          if (response.status_details?.reason === "turn_detected") {
            addActivity({ kind: "system", text: "Assistant was cut off: it heard speech or noise" });
          }
          break;
        }
        case "error": {
          const error = event.error as { code?: string; message?: string } | undefined;
          // Harmless race: a cancel arrived just after the reply had already finished.
          if (error?.code === "response_cancel_not_active") break;
          addActivity({ kind: "error", text: error?.message ?? "Realtime error" });
          break;
        }
      }
    },
    [addActivity, updateActivity],
  );

  return { activities, userCaption, agentCaption, setUserCaption, addActivity, updateActivity, handleServerEvent };
}
