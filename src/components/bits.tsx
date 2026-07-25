import { useEffect, useRef, useState } from "react";
import type { Basis, Confidence, Evidence } from "../lib/types";

/**
 * Counts a number up when it changes.
 *
 * Deliberately hand-rolled rather than handed to the animation library: this
 * one drives numbers a reviewer will read off the screen and act on, so it has
 * to land exactly on the target value every time, including when an effect is
 * torn down mid-flight. Decorative motion can tolerate a dropped frame; a
 * coverage percentage that stops one number short cannot.
 */
export function useCountUp(value: number, duration = 850): number {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;

    if (reduced || start === value) {
      from.current = value;
      setDisplay(value);
      return;
    }

    let frame = 0;
    const began = performance.now();
    const settle = () => {
      from.current = value;
      setDisplay(value);
    };

    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        setDisplay(Math.round(start + (value - start) * eased));
        frame = requestAnimationFrame(tick);
      } else {
        settle();
      }
    };
    frame = requestAnimationFrame(tick);

    // rAF is suspended while the tab is hidden or not compositing, which would
    // otherwise leave a reader looking at the previous number indefinitely.
    // The timer fires regardless, so the correct value always lands.
    const guarantee = window.setTimeout(settle, duration + 120);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(guarantee);
    };
  }, [value, duration]);

  return display;
}

const BASIS_TITLE: Record<Basis, string> = {
  detected: "Read directly from your design files",
  inferred: "Assumed from a naming convention or common practice, so check it",
  unresolved: "Nothing in the sources answers this. An engineer has to supply it",
};

export function BasisBadge({ basis }: { basis: Basis }) {
  return (
    <span className={`badge ${basis}`} title={BASIS_TITLE[basis]}>
      {basis}
    </span>
  );
}

const CONFIDENCE_TITLE: Record<Confidence, string> = {
  high: "Straightforward to implement and verify",
  review: "Workable, but an engineer should confirm the numbers",
  specialist: "Needs someone who has released this measurement before",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className={`badge ${confidence}`} title={CONFIDENCE_TITLE[confidence]}>
      {confidence}
    </span>
  );
}

export function EvidenceChips({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) {
    return (
      <span className="chip none" title="Generated from a rule rather than a specific line in your files">
        no source line
      </span>
    );
  }
  return (
    <span className="evidence">
      {evidence.map((ev) => (
        <span className="chip" key={`${ev.file}:${ev.line}`} title={ev.snippet || "(blank line)"}>
          {ev.file}:{ev.line}
        </span>
      ))}
    </span>
  );
}

export function Gauge({ score }: { score: number }) {
  const display = useCountUp(score);
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);

  return (
    <div className="gauge">
      <svg viewBox="0 0 86 86" aria-hidden="true">
        <circle cx="43" cy="43" r={radius} fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle
          cx="43"
          cy="43"
          r={radius}
          fill="none"
          stroke="var(--signal)"
          strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      <span className="gauge-num">{display}</span>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
