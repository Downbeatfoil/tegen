import { useEffect, useRef } from "react";
import { animate } from "animejs";

/**
 * The hero panel. It's a rail turn-on trace — a supply coming up, overshooting
 * slightly, ringing, then settling into its band. Decorative, but it's the
 * shape an engineer actually sees on a scope during bring-up.
 */

const RAIL_TRACE =
  "M0,142 L96,142 C104,142 108,54 116,44 C122,37 128,62 134,54 C140,47 145,60 151,56 C158,52 163,58 170,56 L400,56";
const REF_TRACE =
  "M0,150 L60,150 C66,150 70,104 78,102 C86,100 92,108 100,106 C112,103 120,108 132,106 L400,106";

const READOUTS: [string, string, "pass" | "warn" | "fail"][] = [
  ["3V3 rail", "3.20–3.40 V", "pass"],
  ["SWD program", "TP5 / TP6", "pass"],
  ["I²C 0x76", "ack", "pass"],
  ["Motor U7", "no test", "fail"],
  ["CAN 500k", "specialist", "warn"],
  ["Cycle est.", "137 s / 75 s", "warn"],
];

export default function Scope() {
  const railRef = useRef<SVGPathElement>(null);
  const refRef = useRef<SVGPathElement>(null);
  const sweepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const animations: { pause: () => void }[] = [];
    const traces = [railRef.current, refRef.current].filter((n): n is SVGPathElement => n !== null);

    for (const [index, node] of traces.entries()) {
      const length = node.getTotalLength();
      node.style.strokeDasharray = `${length}`;
      node.style.strokeDashoffset = `${length}`;
      animations.push(
        animate(node, {
          strokeDashoffset: [length, 0],
          duration: 1900,
          delay: index * 260,
          ease: "inOutQuad",
        }),
      );
    }

    if (sweepRef.current) {
      animations.push(
        animate(sweepRef.current, {
          left: ["0%", "100%"],
          opacity: [0, 0.6, 0.6, 0],
          duration: 3400,
          loop: true,
          ease: "linear",
        }),
      );
    }

    // Hiding the trace to draw it on is only safe if the draw actually runs.
    // Animation frames stop while the tab is hidden, so this clears the dash
    // regardless and leaves a complete trace rather than an empty grid.
    const guarantee = window.setTimeout(() => {
      for (const node of traces) {
        node.style.strokeDasharray = "";
        node.style.strokeDashoffset = "";
      }
    }, 2600);

    return () => {
      window.clearTimeout(guarantee);
      for (const animation of animations) animation.pause();
    };
  }, []);

  return (
    <div className="scope">
      <div className="scope-head">
        <span className="scope-title">rover sense / rev C</span>
        <span className="scope-pill">DRAFT</span>
      </div>

      <div className="scope-canvas">
        <svg viewBox="0 0 400 168" preserveAspectRatio="none" aria-hidden="true">
          <path
            ref={refRef}
            d={REF_TRACE}
            fill="none"
            stroke="var(--signal)"
            strokeWidth="1"
            opacity="0.28"
            vectorEffect="non-scaling-stroke"
          />
          <path
            ref={railRef}
            d={RAIL_TRACE}
            fill="none"
            stroke="var(--signal)"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="scope-sweep" ref={sweepRef} />
      </div>

      <div className="scope-rows">
        {READOUTS.map(([label, value, state]) => (
          <div className="scope-row" key={label}>
            <i className={`dot ${state}`} />
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
