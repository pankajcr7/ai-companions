type Node = { x: number; y: number; w: number; h: number; label: string };

// You hand a goal to Nova, who passes it to department leads and their specialists.
const you: Node = { x: 240, y: 34, w: 104, h: 36, label: "You" };
const nova: Node = { x: 240, y: 132, w: 196, h: 46, label: "Nova · head agent" };
const leads: Node[] = [
  { x: 88, y: 252, w: 132, h: 38, label: "Engineering" },
  { x: 240, y: 252, w: 132, h: 38, label: "Design" },
  { x: 392, y: 252, w: 132, h: 38, label: "Content" },
];
const specialists: Node[][] = [
  [{ x: 52, y: 372, w: 64, h: 30, label: "Frontend" }, { x: 124, y: 372, w: 64, h: 30, label: "QA" }],
  [{ x: 204, y: 372, w: 64, h: 30, label: "UI" }, { x: 276, y: 372, w: 64, h: 30, label: "Brand" }],
  [{ x: 356, y: 372, w: 64, h: 30, label: "Writer" }, { x: 428, y: 372, w: 64, h: 30, label: "Editor" }],
];

/** A soft curve from the bottom of one node to the top of another. */
function link(a: Node, b: Node) {
  const from = a.y + a.h / 2;
  const to = b.y - b.h / 2;
  const mid = (from + to) / 2;
  return `M ${a.x} ${from} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${to}`;
}

const down = [link(you, nova), ...leads.map((l) => link(nova, l)), ...leads.flatMap((l, i) => specialists[i].map((s) => link(l, s)))];
const up = leads.flatMap((l, i) => specialists[i].map((s) => link(l, s)));

/**
 * The team as a live chart: lime lights carry the goal down the lines, teal lights carry reviewed work back up.
 * Each light starts mid-trip (a negative begin), so none waits at the corner before its first run.
 * Drawn in SVG, so it stays sharp at any size; the lights hide for people who turn motion off.
 */
export function TeamChart() {
  return (
    <svg
      viewBox="0 0 480 410"
      role="img"
      aria-label="A team chart: you give a goal to Nova, the head agent, who passes it to the engineering, design, and content leads and their specialists. Reviewed work comes back up."
      className="h-auto w-full font-sans"
    >
      {down.map((d) => (
        <path key={d} d={d} fill="none" stroke="rgb(238 244 240 / 0.22)" strokeWidth="1.2" />
      ))}

      {down.map((d, i) => (
        <circle key={`down-${d}`} r="3.2" fill="#a6ff00" className="motion-reduce:hidden">
          <animateMotion dur="2.6s" begin={`-${(i * 0.3) % 2.6}s`} repeatCount="indefinite" path={d} />
        </circle>
      ))}
      {up.map((d, i) => (
        <circle key={`up-${d}`} r="2.6" fill="#4fb3a9" className="motion-reduce:hidden">
          <animateMotion dur="3.2s" begin={`-${(1.3 + i * 0.4) % 3.2}s`} repeatCount="indefinite" path={d} keyPoints="1;0" keyTimes="0;1" calcMode="linear" />
        </circle>
      ))}

      <Pill node={you} />
      <Pill node={nova} lit />
      {leads.map((l) => (
        <Pill key={l.label} node={l} lead />
      ))}
      {specialists.flat().map((s) => (
        <Pill key={s.label} node={s} small />
      ))}
    </svg>
  );
}

function Pill({ node: n, lit = false, lead = false, small = false }: { node: Node; lit?: boolean; lead?: boolean; small?: boolean }) {
  return (
    <g style={lit ? { filter: "drop-shadow(0 0 18px rgb(166 255 0 / 0.45))" } : undefined}>
      <rect
        x={n.x - n.w / 2}
        y={n.y - n.h / 2}
        width={n.w}
        height={n.h}
        rx={n.h / 2}
        fill={lit ? "#a6ff00" : "#08110f"}
        stroke={lit ? "none" : lead ? "rgb(238 244 240 / 0.35)" : "rgb(238 244 240 / 0.2)"}
      />
      {lead && <circle cx={n.x - n.w / 2 + 16} cy={n.y} r="3.5" fill="#4fb3a9" />}
      <text
        x={lead ? n.x + 7 : n.x}
        y={n.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={small ? 12 : lead ? 11.5 : 14}
        fontWeight={lit || lead ? 600 : 500}
        letterSpacing={lead ? 1.2 : 0}
        fill={lit ? "#08110f" : small ? "#9db3aa" : "#eef4f0"}
      >
        {lead ? n.label.toUpperCase() : n.label}
      </text>
    </g>
  );
}
