import { useEffect, useRef } from "react";
import { MarkedPhoto, type Mark } from "@/components/MarkedPhoto";

export type ActivityKind = "heard" | "said" | "photo" | "markup" | "search" | "plan" | "watcher" | "system" | "error";

export type Activity = {
  id: string;
  time: number;
  kind: ActivityKind;
  text: string;
  detail?: string;
  image?: string;
  markup?: { url: string; width: number; height: number; marks: Mark[] };
  pending?: boolean;
};

const KIND_META: Record<ActivityKind, { label: string; style: string }> = {
  heard: { label: "🎙️ You", style: "border-emerald-800 bg-emerald-950/60" },
  said: { label: "🔊 Assistant", style: "border-sky-800 bg-sky-950/60" },
  photo: { label: "📸 Photo", style: "border-zinc-700 bg-zinc-900" },
  markup: { label: "✏️ Marked up", style: "border-amber-800 bg-amber-950/50" },
  search: { label: "🔎 Lookup", style: "border-zinc-700 bg-zinc-900" },
  plan: { label: "✅ Checklist", style: "border-zinc-700 bg-zinc-900" },
  watcher: { label: "👁 Watcher", style: "border-violet-800 bg-violet-950/60" },
  system: { label: "• Session", style: "border-zinc-800 bg-zinc-900" },
  error: { label: "⚠ Problem", style: "border-red-800 bg-red-950/60" },
};

export function ActivityFeed({ items }: { items: Activity[] }) {
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  if (items.length === 0) return <p className="text-sm text-zinc-400">Everything the assistant hears, says, and does shows up here.</p>;

  return (
    <ol className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className={`rounded-lg border px-3 py-2 text-sm ${KIND_META[item.kind].style}`}>
          <div className="flex items-baseline justify-between gap-2 text-xs text-zinc-400">
            <span>{KIND_META[item.kind].label}</span>
            <time>{formatClock(item.time)}</time>
          </div>
          <p className={item.pending ? "italic text-zinc-300" : undefined}>{item.text}</p>
          {item.detail && <p className="mt-1 whitespace-pre-line text-xs text-zinc-400">{item.detail}</p>}
          {item.image && (
            // eslint-disable-next-line @next/next/no-img-element -- data URL snapshot
            <img src={item.image} alt="" className="mt-2 max-h-40 rounded-md" />
          )}
          {item.markup && (
            <div className="mt-2">
              <MarkedPhoto {...item.markup} compact />
            </div>
          )}
        </li>
      ))}
      <li ref={endRef} aria-hidden />
    </ol>
  );
}

export function formatClock(time: number) {
  return new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
