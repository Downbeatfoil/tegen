/**
 * Plain-text netlist reader.
 *
 * Covers the shapes people actually paste into a text file when they don't
 * have a formal export handy:
 *
 *   3V3: U1 U2 TP2
 *   SDA   U1.5   U2.3
 *   GND, J1-2, U1-40
 */

import type { Net, ParseResult } from "../types";
import { baseNetName, classifyNet, railVoltage } from "../classify";
import { evidence, toLines } from "./util";

const NODE_TOKEN = /^([A-Za-z_]{1,4}\d+)(?:[.\-:/](\w+))?$/;

export function parsePlainNetlist(file: string, text: string): ParseResult {
  const lines = toLines(text);
  const nets: Net[] = [];
  const notes: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    // Prefer an explicit `name:` separator; fall back to first-token-is-name.
    let name: string;
    let rest: string;
    const colon = line.indexOf(":");
    if (colon > 0 && colon < 60) {
      name = line.slice(0, colon).trim();
      rest = line.slice(colon + 1);
    } else {
      const parts = line.split(/[\s,;\t]+/);
      if (parts.length < 2) continue;
      name = parts[0];
      rest = parts.slice(1).join(" ");
    }

    name = baseNetName(name.replace(/^["']|["']$/g, ""));
    if (!name || /\s/.test(name)) continue;

    const nodes: Net["nodes"] = [];
    for (const token of rest.split(/[\s,;\t]+/)) {
      const cleaned = token.trim().replace(/^["']|["']$/g, "");
      if (!cleaned) continue;
      const match = cleaned.match(NODE_TOKEN);
      if (match) nodes.push({ ref: match[1], pin: match[2] ?? "?" });
    }

    if (!nodes.length) continue;

    nets.push({
      name,
      klass: classifyNet(name),
      nodes,
      nominalV: railVoltage(name),
      evidence: [evidence(file, lines, i + 1)],
    });
  }

  notes.push(
    nets.length
      ? `Netlist: ${nets.length} net${nets.length === 1 ? "" : "s"}. ${
          nets.some((n) => n.nodes.some((node) => node.pin !== "?"))
            ? "Pin numbers included."
            : "No pin numbers. Add `U1.5` style nodes for pin-level fixture mapping."
        }`
      : "No net lines recognised. Expected `NET_NAME: REF REF` per line.",
  );

  return { parts: [], nets, notes, kind: "netlist-txt" };
}

export function looksLikePlainNetlist(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (lines.length < 2) return false;
  let hits = 0;
  for (const line of lines.slice(0, 20)) {
    const tokens = line.split(/[\s,;:\t]+/).filter(Boolean);
    if (tokens.length >= 2 && tokens.slice(1).some((t) => NODE_TOKEN.test(t))) hits += 1;
  }
  return hits >= Math.min(2, lines.length);
}
