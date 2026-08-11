/**
 * PCB reader, for physical access only.
 *
 * Electrical connectivity and physical probeability are different questions.
 * A net can exist in the schematic and have nowhere a pogo pin can reach it.
 * Nothing here infers access from a schematic net: an access claim has to come
 * from a real pad or via with a mask opening.
 *
 * KiCad 10 states tenting explicitly per via (capping / covering / plugging),
 * so "this via is exposed" is a read fact rather than an assumption. Pads are
 * exposed when the footprint lists a mask layer alongside the copper layer.
 */

import { atomAt, children, head, parseSexpr, type SList, type SNode } from "./sexpr";

export type BoardSide = "front" | "back" | "both";

export interface AccessPoint {
  kind: "pad" | "via";
  /** Owning footprint reference for pads, empty for vias. */
  ref: string;
  pad: string;
  net: string;
  side: BoardSide;
  x: number;
  y: number;
  /** Pad size in mm, or via outer diameter. */
  width: number;
  height: number;
  drill?: number;
  exposed: boolean;
  reason: string;
  line: number;
}

export interface PcbResult {
  footprints: { ref: string; value: string; libId: string; side: BoardSide; x: number; y: number; line: number }[];
  access: AccessPoint[];
  netNames: string[];
  notes: string[];
  ok: boolean;
}

function firstChild(node: SNode, name: string): SList | undefined {
  return children(node, name)[0];
}

function numsOf(node: SList | undefined, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = node ? atomAt(node, i) : null;
    out.push(raw === null ? 0 : Number(raw));
  }
  return out;
}

function layerList(node: SNode): string[] {
  const layers = firstChild(node, "layers");
  if (!layers) return [];
  return layers.items
    .slice(1)
    .filter((i): i is Extract<SNode, { kind: "atom" }> => i.kind === "atom")
    .map((i) => i.value);
}

function sideOf(layers: string[]): BoardSide {
  const front = layers.some((l) => l.startsWith("F."));
  const back = layers.some((l) => l.startsWith("B."));
  if (front && back) return "both";
  return back ? "back" : "front";
}

/** KiCad footprint transform: rotate the pad offset into board coordinates. */
function place(fx: number, fy: number, rot: number, px: number, py: number): [number, number] {
  const t = (rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [fx + px * c + py * s, fy - px * s + py * c];
}

function nested(node: SNode, name: string, child: string): string | null {
  const outer = firstChild(node, name);
  if (!outer) return null;
  const inner = firstChild(outer, child);
  return inner ? atomAt(inner, 0) : null;
}

export function parseKicadPcb(text: string): PcbResult {
  const roots = parseSexpr(text);
  const root = roots.find((r) => head(r) === "kicad_pcb");
  if (!root) {
    return { footprints: [], access: [], netNames: [], notes: ["Not a KiCad PCB file."], ok: false };
  }

  const footprints: PcbResult["footprints"] = [];
  const access: AccessPoint[] = [];
  const netNames = new Set<string>();

  for (const fp of children(root, "footprint")) {
    const libId = atomAt(fp, 0) ?? "";
    const [fx, fy, frot] = numsOf(firstChild(fp, "at"), 3);
    const fpLayer = firstChild(fp, "layer");
    const fpSide: BoardSide = (fpLayer ? (atomAt(fpLayer, 0) ?? "") : "").startsWith("B.") ? "back" : "front";

    let ref = "";
    let value = "";
    for (const prop of children(fp, "property")) {
      const key = atomAt(prop, 0);
      if (key === "Reference") ref = atomAt(prop, 1) ?? "";
      if (key === "Value") value = atomAt(prop, 1) ?? "";
    }

    footprints.push({ ref, value, libId, side: fpSide, x: fx, y: fy, line: fp.line });

    for (const pad of children(fp, "pad")) {
      const number = atomAt(pad, 0) ?? "?";
      const padType = atomAt(pad, 1) ?? "";
      const [px, py] = numsOf(firstChild(pad, "at"), 2);
      const [w, h] = numsOf(firstChild(pad, "size"), 2);
      const netNode = firstChild(pad, "net");
      // KiCad 10 writes the net name directly on the pad.
      const net = netNode ? (atomAt(netNode, 1) ?? atomAt(netNode, 0) ?? "") : "";
      if (net) netNames.add(net);

      const layers = layerList(pad);
      const hasMask = layers.some((l) => l.endsWith(".Mask") || l === "*.Mask");
      const drillNode = firstChild(pad, "drill");
      const drill = drillNode ? numsOf(drillNode, 1)[0] : undefined;
      const [ax, ay] = place(fx, fy, frot, px, py);

      const throughHole = padType === "thru_hole";
      const exposed = hasMask || throughHole;

      access.push({
        kind: "pad",
        ref,
        pad: number,
        net,
        side: throughHole ? "both" : sideOf(layers),
        x: Number(ax.toFixed(3)),
        y: Number(ay.toFixed(3)),
        width: w,
        height: h,
        drill: drill || undefined,
        exposed,
        reason: throughHole
          ? "Through-hole pad, copper exposed on both sides"
          : hasMask
            ? `SMD pad with a solder-mask opening on ${sideOf(layers)}`
            : "Pad has no mask opening, so it is covered",
        line: pad.line,
      });
    }
  }

  for (const via of children(root, "via")) {
    const [x, y] = numsOf(firstChild(via, "at"), 2);
    const [size] = numsOf(firstChild(via, "size"), 1);
    const [drill] = numsOf(firstChild(via, "drill"), 1);
    const netNode = firstChild(via, "net");
    const net = netNode ? (atomAt(netNode, 1) ?? atomAt(netNode, 0) ?? "") : "";
    if (net) netNames.add(net);

    // Tenting is stated per via in this format. Anything capped, covered or
    // plugged is not a probe target.
    const capping = firstChild(via, "capping") ? atomAt(firstChild(via, "capping")!, 0) : "no";
    const coverFront = nested(via, "covering", "front") ?? "no";
    const coverBack = nested(via, "covering", "back") ?? "no";
    const plugFront = nested(via, "plugging", "front") ?? "no";
    const plugBack = nested(via, "plugging", "back") ?? "no";
    const frontOpen = coverFront === "no" && plugFront === "no" && capping === "no";
    const backOpen = coverBack === "no" && plugBack === "no" && capping === "no";
    const exposed = frontOpen || backOpen;

    access.push({
      kind: "via",
      ref: "",
      pad: "",
      net,
      side: frontOpen && backOpen ? "both" : frontOpen ? "front" : "back",
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      width: size,
      height: size,
      drill,
      exposed,
      reason: exposed
        ? "Via is not capped, covered or plugged, so copper is reachable"
        : "Via is tented",
      line: via.line,
    });
  }

  const exposedCount = access.filter((a) => a.exposed).length;
  const notes = [
    `PCB: ${footprints.length} footprints, ${access.filter((a) => a.kind === "pad").length} pads, ${access.filter((a) => a.kind === "via").length} vias.`,
    `${exposedCount} of ${access.length} copper features have an opening a probe could reach.`,
  ];

  return { footprints, access, netNames: [...netNames], notes, ok: true };
}

export function looksLikeKicadPcb(text: string): boolean {
  return /\(\s*kicad_pcb\b/.test(text);
}

/** Best probe target for a net: biggest exposed pad, else an exposed via. */
export function bestAccessForNet(access: AccessPoint[], net: string): AccessPoint | undefined {
  const candidates = access.filter((a) => a.exposed && a.net && a.net === net);
  if (!candidates.length) return undefined;
  const area = (a: AccessPoint) => (a.kind === "pad" ? a.width * a.height : a.width * a.width * 0.6);
  return candidates.sort((a, b) => area(b) - area(a))[0];
}
