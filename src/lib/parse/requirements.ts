/**
 * Turns written requirements into structured, numeric limits.
 *
 * "3V3 rail must remain between 3.20 V and 3.40 V" becomes
 * `{ net: "3V3", min: 3.2, max: 3.4, unit: "V", basis: "detected" }`.
 *
 * This is the part that decides whether a generated test has a real pass/fail
 * threshold or a placeholder. A sentence we can't turn into a number produces
 * an "unresolved" limit rather than a guessed one — silently inventing a
 * tolerance is how you ship a test that passes bad boards.
 */

import type { Limit, Net } from "../types";
import { evidence, toLines } from "./util";

const UNIT = String.raw`mV|V|mA|µA|uA|A|kΩ|Ω|kohms?|ohms?|MHz|kHz|Hz|ms|µs|us|seconds?|secs?|s|°C|degC|C|%`;
const NUM = String.raw`\d+(?:\.\d+)?`;

const RANGE = new RegExp(
  String.raw`\bbetween\s+(${NUM})\s*(${UNIT})?\s*(?:and|to|through|–|—)\s*(${NUM})\s*(${UNIT})`,
  "i",
);
const SPAN = new RegExp(String.raw`\b(${NUM})\s*(?:${UNIT})?\s*(?:–|—|-|to)\s*(${NUM})\s*(${UNIT})\b`, "i");
const TOLERANCE = new RegExp(String.raw`\b(${NUM})\s*(${UNIT})\s*(?:±|\+/-|\+-)\s*(${NUM})\s*(%|${UNIT})`, "i");
const MAXIMUM = new RegExp(
  String.raw`\b(?:under|below|less than|no more than|not exceed|at most|max(?:imum)?(?:\s+of)?|within|faster than|shorter than)\s+(${NUM})\s*(${UNIT})`,
  "i",
);
const MINIMUM = new RegExp(
  String.raw`\b(?:above|over|greater than|at least|no less than|min(?:imum)?(?:\s+of)?|exceeds?)\s+(${NUM})\s*(${UNIT})`,
  "i",
);
const EQUALS = new RegExp(
  String.raw`\b(?:must\s+(?:be|read|measure|output|draw|supply)|shall\s+be|should\s+be|nominal(?:ly)?|accepts?)\s+(?:approximately\s+|about\s+|~)?(${NUM})\s*(${UNIT})`,
  "i",
);
const IDENTITY = new RegExp(
  String.raw`\b(?:address|addr|device\s?id|chip\s?id|identifier|part\s?id|whoami|who_am_i)\b[^0-9a-fx]{0,14}(0x[0-9a-f]+|\d{1,5})`,
  "i",
);

/** Scale factors into base units so limits are comparable. */
const SCALE: Record<string, { factor: number; unit: string }> = {
  mv: { factor: 1e-3, unit: "V" },
  v: { factor: 1, unit: "V" },
  ma: { factor: 1e-3, unit: "A" },
  "µa": { factor: 1e-6, unit: "A" },
  ua: { factor: 1e-6, unit: "A" },
  a: { factor: 1, unit: "A" },
  "kω": { factor: 1e3, unit: "Ω" },
  kohm: { factor: 1e3, unit: "Ω" },
  kohms: { factor: 1e3, unit: "Ω" },
  "ω": { factor: 1, unit: "Ω" },
  ohm: { factor: 1, unit: "Ω" },
  ohms: { factor: 1, unit: "Ω" },
  mhz: { factor: 1e6, unit: "Hz" },
  khz: { factor: 1e3, unit: "Hz" },
  hz: { factor: 1, unit: "Hz" },
  ms: { factor: 1e-3, unit: "s" },
  "µs": { factor: 1e-6, unit: "s" },
  us: { factor: 1e-6, unit: "s" },
  s: { factor: 1, unit: "s" },
  sec: { factor: 1, unit: "s" },
  secs: { factor: 1, unit: "s" },
  second: { factor: 1, unit: "s" },
  seconds: { factor: 1, unit: "s" },
  "°c": { factor: 1, unit: "°C" },
  degc: { factor: 1, unit: "°C" },
  c: { factor: 1, unit: "°C" },
  "%": { factor: 1, unit: "%" },
};

function convert(value: string, rawUnit: string | undefined): { value: number; unit: string } | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const key = (rawUnit ?? "").toLowerCase().trim();
  const scale = SCALE[key];
  if (!scale) return null;
  return { value: Number((n * scale.factor).toPrecision(6)), unit: scale.unit };
}

/**
 * Finds which known net a requirement sentence is talking about.
 *
 * Three passes, loosening as they go. Schematic net names carry decoration
 * that prose never does — nobody writes "the +3V3 rail must stay…" — so an
 * exact-token match alone silently drops most real requirements on the floor,
 * and a dropped requirement gets replaced by an assumed limit. That is the
 * worst failure this file can have, so the matching is deliberately generous.
 */
function matchNet(line: string, nets: Net[]): string | undefined {
  const upper = line.toUpperCase();
  const compact = upper.replace(/[^A-Z0-9]/g, "");

  // Longest first, so "3V3_MCU" wins over "3V3".
  const byName = [...nets].sort((a, b) => b.name.length - a.name.length);

  // 1. Exact token: "SDA must be pulled up".
  for (const net of byName) {
    const name = net.name.toUpperCase();
    if (name.length < 2) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(String.raw`(^|[^A-Z0-9_])${escaped}([^A-Z0-9_]|$)`).test(upper)) return net.name;
  }

  // 2. Ignoring decoration: net "+3V3" against the words "the 3V3 rail".
  for (const net of byName) {
    const bare = net.name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (bare.length < 3) continue;
    if (compact.includes(bare)) return net.name;
  }

  // 3. By voltage: "between 3.20 V and 3.40 V" belongs to the 3.3 V rail.
  const volts = [...upper.matchAll(/(\d{1,2}(?:[.,]\d{1,2})?)\s*V\b/g)].map((m) =>
    Number(m[1].replace(",", ".")),
  );
  if (volts.length) {
    const low = Math.min(...volts) * 0.95;
    const high = Math.max(...volts) * 1.05;
    const hit = nets.find((n) => n.nominalV !== undefined && n.nominalV >= low && n.nominalV <= high);
    if (hit) return hit.name;
  }
  return undefined;
}

/** Short label for the limit, taken from the start of the sentence. */
function parameterLabel(line: string, net: string | undefined, unit: string): string {
  const cleaned = line.replace(/^[-*\d.)\s]+/, "").trim();
  const subject = cleaned.split(/\s+(?:must|shall|should|has|have|is|are|needs?)\b/i)[0];
  const short = subject.length > 4 && subject.length < 60 ? subject : cleaned.slice(0, 56);
  if (short) return short.replace(/[.:,;]$/, "");
  const kind = unit === "V" ? "voltage" : unit === "s" ? "timing" : "limit";
  return net ? `${net} ${kind}` : `Stated ${kind}`;
}

export function parseRequirements(file: string, text: string, nets: Net[]): Limit[] {
  const lines = toLines(text);
  const limits: Limit[] = [];

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.length < 6) return;

    const net = matchNet(line, nets);
    const ev = [evidence(file, lines, index + 1)];
    const push = (limit: Omit<Limit, "evidence" | "basis"> & Partial<Pick<Limit, "basis">>) => {
      limits.push({ basis: "detected", evidence: ev, ...limit });
    };

    const range = line.match(RANGE) ?? line.match(SPAN);
    if (range) {
      const unitRaw = range[4] ?? range[3] ?? range[2];
      const lo = convert(range[1], range[2] ?? unitRaw);
      const hi = convert(range[3], unitRaw);
      if (lo && hi && hi.value >= lo.value) {
        push({
          parameter: parameterLabel(line, net, hi.unit),
          net,
          min: lo.value,
          max: hi.value,
          unit: hi.unit,
        });
        return;
      }
    }

    const tol = line.match(TOLERANCE);
    if (tol) {
      const base = convert(tol[1], tol[2]);
      if (base) {
        const isPercent = tol[4] === "%";
        const delta = isPercent
          ? (base.value * Number(tol[3])) / 100
          : (convert(tol[3], tol[4])?.value ?? 0);
        push({
          parameter: parameterLabel(line, net, base.unit),
          net,
          nominal: base.value,
          min: Number((base.value - delta).toPrecision(6)),
          max: Number((base.value + delta).toPrecision(6)),
          unit: base.unit,
        });
        return;
      }
    }

    const max = line.match(MAXIMUM);
    if (max) {
      const hi = convert(max[1], max[2]);
      if (hi) {
        push({ parameter: parameterLabel(line, net, hi.unit), net, max: hi.value, unit: hi.unit });
        return;
      }
    }

    const min = line.match(MINIMUM);
    if (min) {
      const lo = convert(min[1], min[2]);
      if (lo) {
        push({ parameter: parameterLabel(line, net, lo.unit), net, min: lo.value, unit: lo.unit });
        return;
      }
    }

    const identity = line.match(IDENTITY);
    if (identity) {
      push({
        parameter: parameterLabel(line, net, ""),
        net,
        unit: "id",
        note: `Expected identity ${identity[1]}`,
      });
      return;
    }

    const eq = line.match(EQUALS);
    if (eq) {
      const value = convert(eq[1], eq[2]);
      if (value) {
        push({
          parameter: parameterLabel(line, net, value.unit),
          net,
          nominal: value.value,
          unit: value.unit,
          note: "Nominal stated without a tolerance — needs a pass band before release",
        });
        return;
      }
    }

    // A sentence that reads like a requirement but carries no number at all.
    if (/\b(must|shall|should|required to)\b/i.test(line)) {
      push({
        parameter: parameterLabel(line, net, ""),
        net,
        unit: "",
        basis: "unresolved",
        note: "Stated as a requirement but no measurable threshold given",
      });
    }
  });

  return limits;
}

/** Default rail windows, used only when the requirements say nothing. */
export function inferredRailLimit(net: Net): Limit | null {
  if (net.klass !== "power" || net.nominalV === undefined) return null;
  // ±3% is the common regulator accuracy band; flagged inferred so it gets
  // checked against the actual regulator datasheet before release.
  const tol = Number((net.nominalV * 0.03).toPrecision(3));
  return {
    parameter: `${net.name} rail voltage`,
    net: net.name,
    nominal: net.nominalV,
    min: Number((net.nominalV - tol).toPrecision(4)),
    max: Number((net.nominalV + tol).toPrecision(4)),
    unit: "V",
    basis: "inferred",
    evidence: net.evidence.slice(0, 1),
    note: "±3% assumed from the net name. Replace with the regulator's datasheet accuracy.",
  };
}
