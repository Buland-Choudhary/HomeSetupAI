export type Mark = { label: string; shape: "circle" | "line"; x: number; y: number; x2: number | null; y2: number | null };

const MARK_COLOR = "#facc15";

// A snapshot with the agent's circles and lines drawn over it. Coordinates are fractions of the image size.
export function MarkedPhoto({
  url,
  width,
  height,
  marks,
  onClose,
}: {
  url: string;
  width: number;
  height: number;
  marks: Mark[];
  onClose: () => void;
}) {
  const size = Math.max(width, height);
  const radius = size * 0.05;
  const stroke = size * 0.008;
  const fontSize = size * 0.035;

  return (
    <div className="relative mx-auto w-fit overflow-hidden rounded-xl border-2 border-amber-300 shadow-2xl">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL snapshot */}
      <img src={url} alt="Photo marked up by the assistant" className="block max-h-[45dvh] w-auto max-w-full" />
      <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full">
        {marks.map((mark, i) => {
          const x = mark.x * width;
          const y = mark.y * height;
          const x2 = mark.x2;
          const y2 = mark.y2;
          const isLine = mark.shape === "line" && x2 !== null && y2 !== null;
          return (
            <g key={i} fill="none" stroke={MARK_COLOR} strokeWidth={stroke} strokeLinecap="round">
              {isLine ? (
                <line x1={x} y1={y} x2={x2 * width} y2={y2 * height} strokeDasharray={`${stroke * 3} ${stroke * 2}`} />
              ) : (
                <circle cx={x} cy={y} r={radius} />
              )}
              <text
                x={isLine ? x + stroke * 2 : x}
                y={Math.max(fontSize, isLine ? y - stroke * 2 : y - radius - stroke * 2)}
                textAnchor={isLine ? "start" : "middle"}
                fontSize={fontSize}
                fontWeight={700}
                fill={MARK_COLOR}
                stroke="black"
                strokeWidth={stroke * 0.6}
                paintOrder="stroke"
              >
                {mark.label}
              </text>
            </g>
          );
        })}
      </svg>
      <button
        onClick={onClose}
        className="absolute right-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-sm"
        aria-label="Close marked-up photo"
      >
        ✕
      </button>
      {marks.length === 0 && (
        <p className="absolute inset-x-0 bottom-0 bg-black/70 p-2 text-sm">Couldn&apos;t find that in the photo.</p>
      )}
    </div>
  );
}
