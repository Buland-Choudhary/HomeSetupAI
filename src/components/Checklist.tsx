export type StepStatus = "todo" | "doing" | "done";
export type Plan = { goal: string; steps: { title: string; status: StepStatus; note?: string }[] };

const MARKER_STYLES: Record<StepStatus, string> = {
  todo: "border border-zinc-500 text-zinc-300",
  doing: "bg-amber-400 text-black",
  done: "bg-emerald-500 text-black",
};

export function Checklist({ plan }: { plan: Plan | null }) {
  if (!plan) {
    return <p className="text-sm text-zinc-300">Say what you&apos;re setting up, like &ldquo;I want to hang a shelf.&rdquo;</p>;
  }

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-zinc-400">Goal</p>
      <p className="font-medium">{plan.goal}</p>
      <ol className="mt-2 flex flex-col gap-2">
        {plan.steps.map((step, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${MARKER_STYLES[step.status]}`}
            >
              {step.status === "done" ? "✓" : i + 1}
            </span>
            <span>
              <span
                className={
                  step.status === "done"
                    ? "text-zinc-400 line-through"
                    : step.status === "doing"
                      ? "font-medium text-white"
                      : "text-zinc-300"
                }
              >
                {step.title}
              </span>
              {step.note && <span className="block text-xs text-amber-300">{step.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
