const MAX_CHARS = 140;

// Live subtitles: the latest thing the user said and the latest thing the assistant said.
export function Captions({ status, user, agent }: { status: string; user: string; agent: string }) {
  return (
    <div className="pointer-events-none flex flex-col gap-1 rounded-xl bg-black/50 px-3 py-2 text-sm leading-snug backdrop-blur-sm">
      <p className="text-[11px] uppercase tracking-wide text-zinc-300">{status}</p>
      <p>
        <span className="font-semibold text-emerald-300">You: </span>
        {user ? tail(user) : <span className="text-zinc-400">…</span>}
      </p>
      <p>
        <span className="font-semibold text-sky-300">AI: </span>
        {agent ? tail(agent) : <span className="text-zinc-400">…</span>}
      </p>
    </div>
  );
}

// Long captions show their end, since that's the part being spoken right now.
function tail(text: string) {
  return text.length > MAX_CHARS ? `…${text.slice(-MAX_CHARS)}` : text;
}
