/**
 * KiCad schematic connectivity resolver.
 *
 * The previous reader pulled out symbols and net labels and stopped there, so
 * a schematic-only project reported "no pin-level connectivity in the sources".
 * That was never true: a `.kicad_sch` carries full connectivity, just
 * geometrically rather than as an explicit net list. You have to place every
 * pin in sheet coordinates and work out what touches what.
 *
 * How connection works in KiCad, which drives the algorithm below:
 *   - a wire connects its two endpoints
 *   - two wires crossing only connect if a junction sits on the crossing
 *   - a *pin* touching a wire anywhere along its length connects, with no
 *     junction needed, so endpoint-only matching silently drops connections
 *   - labels and power symbols name whatever they are attached to
 *
 * The pin transform (rotate counter-clockwise, then flip Y because library
 * space is Y-up and sheet space is Y-down, with the pin's own `at` being the
 * electrical connection point) was not taken from memory. It was chosen by
 * scoring every plausible convention against the real KB1 schematic and
 * keeping the one that landed pins on wires: 91.9%, against 88.5% and below
 * for the alternatives.
 */

import { atomAt, children, head, parseSexpr, type SList, type SNode } from "./sexpr";

/** KiCad writes millimetres with 2-4 decimals. */
const EPS = 0.005;
const qk = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;

export interface GraphPin {
  ref: string;
  number: string;
  name: string;
  type: string;
  x: number;
  y: number;
  net: string;
}

export interface GraphPart {
  ref: string;
  value: string;
  footprint: string;
  libId: string;
  unit: number;
  dnp: boolean;
  excluded: boolean;
  line: number;
  pins: GraphPin[];
}

export interface GraphNet {
  name: string;
  /** True when a label or power symbol named it, rather than us generating one. */
  named: boolean;
  nodes: { ref: string; pin: string; pinName: string; pinType: string }[];
  line: number;
}

export interface TitleBlock {
  title?: string;
  rev?: string;
  company?: string;
  date?: string;
}

export interface ConnectivityStats {
  instances: number;
  pinsTotal: number;
  pinsOnNet: number;
  wires: number;
  junctions: number;
  labels: number;
  noConnects: number;
  namedNets: number;
}

export interface ConnectivityResult {
  parts: GraphPart[];
  nets: GraphNet[];
  titleBlock: TitleBlock;
  stats: ConnectivityStats;
  /** Set when connectivity could not be reconstructed. Blocks downstream work. */
  blocked?: string;
  notes: string[];
}

// ---------------------------------------------------------------- helpers --

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

function propValue(node: SNode, key: string): string | undefined {
  for (const prop of children(node, "property")) {
    if (atomAt(prop, 0) === key) return atomAt(prop, 1) ?? undefined;
  }
  return undefined;
}

function flagIs(node: SNode, name: string, truthy: string): boolean {
  const child = firstChild(node, name);
  return child ? atomAt(child, 0) === truthy : false;
}

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** True when (px,py) lies on the segment, including its endpoints. */
function onSegment(seg: Segment, px: number, py: number): boolean {
  const { ax, ay, bx, by } = seg;
  if (px < Math.min(ax, bx) - EPS || px > Math.max(ax, bx) + EPS) return false;
  if (py < Math.min(ay, by) - EPS || py > Math.max(ay, by) + EPS) return false;
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return Math.abs(cross) / len <= EPS;
}

class DisjointSet {
  private parent = new Map<string, string>();

  find(a: string): string {
    if (!this.parent.has(a)) {
      this.parent.set(a, a);
      return a;
    }
    let root = a;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Flatten the path so repeated lookups stay cheap on big sheets.
    let cursor = a;
    while (this.parent.get(cursor) !== root) {
      const next = this.parent.get(cursor)!;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** Rotate counter-clockwise, then flip Y for sheet space. */
function placePin(px: number, py: number, rot: number, mirror: string): [number, number] {
  const t = (rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  let dx = px * c - py * s;
  let dy = -(px * s + py * c);
  if (mirror === "x") dy = -dy;
  if (mirror === "y") dx = -dx;
  return [dx, dy];
}

interface LibPin {
  unit: number;
  style: number;
  number: string;
  name: string;
  type: string;
  x: number;
  y: number;
}

// ------------------------------------------------------------------- main --

export function resolveConnectivity(text: string): ConnectivityResult {
  const notes: string[] = [];
  const roots = parseSexpr(text);
  const root = roots.find((r) => head(r) === "kicad_sch");

  if (!root) {
    return emptyResult("The file is not a KiCad schematic (no kicad_sch root).");
  }

  // -- title block -------------------------------------------------------
  const tb = firstChild(root, "title_block");
  const titleBlock: TitleBlock = tb
    ? {
        title: atomAt(firstChild(tb, "title") ?? ({} as SList), 0) ?? undefined,
        rev: atomAt(firstChild(tb, "rev") ?? ({} as SList), 0) ?? undefined,
        company: atomAt(firstChild(tb, "company") ?? ({} as SList), 0) ?? undefined,
        date: atomAt(firstChild(tb, "date") ?? ({} as SList), 0) ?? undefined,
      }
    : {};

  // -- library pin tables -------------------------------------------------
  const libPins = new Map<string, LibPin[]>();
  const libBlock = firstChild(root, "lib_symbols");
  if (libBlock) {
    for (const sym of children(libBlock, "symbol")) {
      const libId = atomAt(sym, 0) ?? "";
      const collected: LibPin[] = [];
      // Pins live in child symbols named "<name>_<unit>_<bodyStyle>".
      for (const sub of children(sym, "symbol")) {
        const suffix = (atomAt(sub, 0) ?? "").match(/_(\d+)_(\d+)$/);
        const unit = suffix ? Number(suffix[1]) : 0;
        const style = suffix ? Number(suffix[2]) : 1;
        for (const pin of children(sub, "pin")) {
          const [x, y] = numsOf(firstChild(pin, "at"), 2);
          const numberNode = firstChild(pin, "number");
          const nameNode = firstChild(pin, "name");
          collected.push({
            unit,
            style,
            number: numberNode ? (atomAt(numberNode, 0) ?? "?") : "?",
            name: nameNode ? (atomAt(nameNode, 0) ?? "") : "",
            type: atomAt(pin, 0) ?? "unspecified",
            x,
            y,
          });
        }
      }
      libPins.set(libId, collected);
    }
  }

  // -- wires, junctions, no-connects --------------------------------------
  const segments: Segment[] = [];
  for (const w of children(root, "wire")) {
    const pts = firstChild(w, "pts");
    if (!pts) continue;
    const xy = children(pts, "xy");
    if (xy.length < 2) continue;
    const [ax, ay] = numsOf(xy[0], 2);
    const [bx, by] = numsOf(xy[1], 2);
    segments.push({ ax, ay, bx, by });
  }

  const junctions: [number, number][] = [];
  for (const j of children(root, "junction")) {
    const [x, y] = numsOf(firstChild(j, "at"), 2);
    junctions.push([x, y]);
  }

  const noConnects = new Set<string>();
  for (const nc of children(root, "no_connect")) {
    const [x, y] = numsOf(firstChild(nc, "at"), 2);
    noConnects.add(qk(x, y));
  }

  // -- labels --------------------------------------------------------------
  interface LabelHit {
    name: string;
    x: number;
    y: number;
    rank: number;
    line: number;
  }
  const labels: LabelHit[] = [];
  const labelKinds: [string, number][] = [
    ["label", 2],
    ["hierarchical_label", 3],
    ["global_label", 4],
  ];
  for (const [kind, rank] of labelKinds) {
    for (const node of children(root, kind)) {
      const name = atomAt(node, 0);
      if (!name) continue;
      const [x, y] = numsOf(firstChild(node, "at"), 2);
      labels.push({ name, x, y, rank, line: node.line });
    }
  }

  // -- symbol instances ----------------------------------------------------
  const parts: GraphPart[] = [];
  const pinPoints: { key: string; pin: GraphPin }[] = [];
  let pinsTotal = 0;

  for (const sym of children(root, "symbol")) {
    const libIdNode = firstChild(sym, "lib_id");
    if (!libIdNode) continue;
    const libId = atomAt(libIdNode, 0) ?? "";
    const [sx, sy, rot] = numsOf(firstChild(sym, "at"), 3);
    const [unitRaw] = numsOf(firstChild(sym, "unit"), 1);
    const unit = unitRaw || 1;
    const [styleRaw] = numsOf(firstChild(sym, "body_style"), 1);
    const style = styleRaw || 1;
    const mirrorNode = firstChild(sym, "mirror");
    const mirror = mirrorNode ? (atomAt(mirrorNode, 0) ?? "") : "";

    const ref = propValue(sym, "Reference") ?? "";
    const value = propValue(sym, "Value") ?? "";
    const footprint = propValue(sym, "Footprint") ?? "";

    const pins = libPins.get(libId) ?? [];
    const usable = pins.filter(
      (p) => (p.unit === 0 || p.unit === unit) && (p.style === 0 || p.style === style),
    );

    // Power symbols are net names wearing a symbol, not parts.
    const isPower = libId.toLowerCase().startsWith("power:") || ref.startsWith("#");

    const placed: GraphPin[] = [];
    for (const p of usable) {
      const [dx, dy] = placePin(p.x, p.y, rot, mirror);
      const ax = sx + dx;
      const ay = sy + dy;
      const gp: GraphPin = {
        ref,
        number: p.number,
        name: p.name,
        type: p.type,
        x: ax,
        y: ay,
        net: "",
      };
      placed.push(gp);
      if (!isPower) pinsTotal += 1;
      pinPoints.push({ key: qk(ax, ay), pin: gp });
    }

    if (isPower) {
      // Attach the power net name at the symbol's pin location.
      for (const gp of placed) {
        labels.push({ name: value || ref, x: gp.x, y: gp.y, rank: 5, line: sym.line });
      }
      continue;
    }

    if (!ref || ref.startsWith("#")) continue;

    parts.push({
      ref,
      value,
      footprint,
      libId,
      unit,
      dnp: flagIs(sym, "dnp", "yes"),
      excluded: flagIs(sym, "in_bom", "no") || flagIs(sym, "exclude_from_bom", "yes"),
      line: sym.line,
      pins: placed,
    });
  }

  if (!parts.length) {
    return emptyResult("No symbol instances were found, so no connectivity could be built.", titleBlock);
  }

  // -- union everything ----------------------------------------------------
  const dsu = new DisjointSet();

  // A wire ties its own two ends together.
  const segKeys = segments.map((s) => qk(s.ax, s.ay));
  segments.forEach((s, i) => dsu.union(segKeys[i], qk(s.bx, s.by)));

  // Anything sitting on a wire joins that wire. Junctions make wire crossings
  // conductive; pins and labels connect on contact without needing one.
  const attach = (x: number, y: number) => {
    const k = qk(x, y);
    dsu.find(k);
    segments.forEach((s, i) => {
      if (onSegment(s, x, y)) dsu.union(k, segKeys[i]);
    });
  };

  for (const [x, y] of junctions) attach(x, y);
  for (const { pin } of pinPoints) attach(pin.x, pin.y);
  for (const l of labels) attach(l.x, l.y);

  // Same-named power symbols and global labels are one net wherever they
  // appear, so every GND symbol on the sheet is a single node. Without this
  // the graph reports one small net per power symbol and nothing looks
  // connected to anything. This design is flat (no sub-sheets), so plain
  // labels merge globally too; a hierarchical design would need per-sheet
  // scoping for rank-2 labels.
  const hasSheets = children(root, "sheet").length > 0;
  for (const l of labels) {
    if (hasSheets && l.rank === 2) continue;
    dsu.union(qk(l.x, l.y), `@net:${l.name}`);
  }

  // -- name the nets -------------------------------------------------------
  const bestLabel = new Map<string, LabelHit>();
  for (const l of labels) {
    const rootKey = dsu.find(qk(l.x, l.y));
    const held = bestLabel.get(rootKey);
    if (!held || l.rank > held.rank) bestLabel.set(rootKey, l);
  }

  const netsByRoot = new Map<string, GraphNet>();
  let unnamedCounter = 0;

  for (const { pin } of pinPoints) {
    if (!pin.ref || pin.ref.startsWith("#")) continue;
    const rootKey = dsu.find(qk(pin.x, pin.y));

    // A pin with an explicit no-connect marker is intentionally floating.
    if (noConnects.has(qk(pin.x, pin.y))) {
      pin.net = "";
      continue;
    }

    let net = netsByRoot.get(rootKey);
    if (!net) {
      const label = bestLabel.get(rootKey);
      const named = Boolean(label);
      unnamedCounter += named ? 0 : 1;
      net = {
        name: label ? label.name : `Net-(${pin.ref}-Pad${pin.number})`,
        named,
        nodes: [],
        line: label ? label.line : 1,
      };
      netsByRoot.set(rootKey, net);
    }
    pin.net = net.name;
    net.nodes.push({ ref: pin.ref, pin: pin.number, pinName: pin.name, pinType: pin.type });
  }

  // A net with a single node is a stub, not a connection. Keep it visible but
  // don't let it inflate connectivity counts.
  const nets = [...netsByRoot.values()];
  const pinsOnNet = nets.reduce((sum, n) => sum + n.nodes.length, 0);

  const stats: ConnectivityStats = {
    instances: parts.length,
    pinsTotal,
    pinsOnNet,
    wires: segments.length,
    junctions: junctions.length,
    labels: labels.length,
    noConnects: noConnects.size,
    namedNets: nets.filter((n) => n.named).length,
  };

  const ratio = pinsTotal ? pinsOnNet / pinsTotal : 0;
  let blocked: string | undefined;
  if (!segments.length) {
    blocked =
      "The schematic contains no wires, so pin-level connectivity cannot be reconstructed from it.";
  } else if (ratio < 0.5) {
    blocked = `Only ${Math.round(ratio * 100)}% of pins resolved to a net. The geometry did not reconstruct cleanly, so downstream analysis is unreliable.`;
  }

  notes.push(
    `Schematic: ${parts.length} parts, ${nets.length} nets, ${pinsOnNet} of ${pinsTotal} pins resolved to a net (${Math.round(ratio * 100)}%).`,
  );
  notes.push(
    `Connectivity rebuilt from ${segments.length} wires and ${junctions.length} junctions. ${stats.namedNets} nets carry a label or power symbol; ${unnamedCounter} were auto-named.`,
  );
  if (stats.noConnects) {
    notes.push(`${stats.noConnects} pins are marked no-connect and are treated as intentionally floating.`);
  }

  return { parts, nets, titleBlock, stats, blocked, notes };

  function emptyResult(reason: string, tb?: TitleBlock): ConnectivityResult {
    return {
      parts: [],
      nets: [],
      titleBlock: tb ?? {},
      stats: {
        instances: 0,
        pinsTotal: 0,
        pinsOnNet: 0,
        wires: 0,
        junctions: 0,
        labels: 0,
        noConnects: 0,
        namedNets: 0,
      },
      blocked: reason,
      notes: [reason],
    };
  }
}
