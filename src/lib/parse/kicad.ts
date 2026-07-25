/**
 * KiCad readers: `.kicad_sch` schematics and `.net` netlist exports.
 *
 * The netlist is the more useful of the two because it carries pin-level
 * connectivity. The schematic gives us parts and net labels but not which pin
 * of U1 a net lands on, so tests derived from a schematic-only project get a
 * weaker basis than tests derived from a netlist.
 */

import type { Net, Part, ParseResult } from "../types";
import { baseNetName, classifyNet, classifyPart, railVoltage, untestableReason } from "../classify";
import { atomAt, children, findAll, head, parseSexpr, symbolProperty, type SList } from "./sexpr";
import { evidence, toLines } from "./util";

/** KiCad marks non-BOM items (power flags, mounting holes) with a `#` ref. */
const isVirtualRef = (ref: string) => ref.startsWith("#");

export function parseKicadSchematic(file: string, text: string): ParseResult {
  const lines = toLines(text);
  const roots = parseSexpr(text);
  const parts: Part[] = [];
  const netMap = new Map<string, Net>();
  const notes: string[] = [];

  const addNet = (rawName: string, line: number) => {
    const name = baseNetName(rawName);
    if (!name) return;
    const key = name.toUpperCase();
    const ev = evidence(file, lines, line);
    const existing = netMap.get(key);
    if (existing) {
      existing.evidence.push(ev);
      return;
    }
    netMap.set(key, {
      name,
      klass: classifyNet(name),
      nodes: [],
      nominalV: railVoltage(name),
      evidence: [ev],
    });
  };

  for (const root of roots) {
    if (head(root) !== "kicad_sch") continue;

    // Only direct children — `lib_symbols` holds symbol *definitions*, whose
    // reference properties are unnumbered stubs like "R" rather than "R1".
    for (const symbol of children(root, "symbol")) {
      const reference = symbolProperty(symbol, "Reference");
      if (!reference) continue;
      const libId = childLibId(symbol);

      const ref = reference.value;

      // Power symbols aren't parts — they're a net label wearing a symbol.
      if (isVirtualRef(ref) || libId?.toLowerCase().startsWith("power:")) {
        const value = symbolProperty(symbol, "Value");
        if (value) addNet(value.value, value.line);
        continue;
      }

      const value = symbolProperty(symbol, "Value")?.value ?? "";
      const footprint = symbolProperty(symbol, "Footprint")?.value ?? "";
      const description =
        symbolProperty(symbol, "Description")?.value ??
        symbolProperty(symbol, "Comment")?.value ??
        "";
      const klass = classifyPart(ref, value, description, footprint);

      parts.push({
        ref,
        value,
        description: description || undefined,
        footprint: footprint || undefined,
        klass,
        untestableReason: untestableReason(klass),
        evidence: [evidence(file, lines, reference.line)],
      });
    }

    for (const kind of ["label", "global_label", "hierarchical_label"]) {
      for (const label of children(root, kind)) {
        const name = atomAt(label, 0);
        if (name) addNet(name, label.line);
      }
    }
  }

  if (!parts.length && !netMap.size) {
    notes.push("No symbols or net labels found — the file may be a fragment or an unsupported KiCad version.");
  } else {
    notes.push(
      `Schematic: ${parts.length} part${parts.length === 1 ? "" : "s"}, ${netMap.size} named net${netMap.size === 1 ? "" : "s"}. Pin-level connectivity needs a netlist export.`,
    );
  }

  return { parts, nets: [...netMap.values()], notes, kind: "kicad-sch" };
}

function childLibId(symbol: SList): string | null {
  const [lib] = children(symbol, "lib_id");
  return lib ? atomAt(lib, 0) : null;
}

export function parseKicadNetlist(file: string, text: string): ParseResult {
  const lines = toLines(text);
  const roots = parseSexpr(text);
  const parts: Part[] = [];
  const nets: Net[] = [];
  const notes: string[] = [];

  for (const root of roots) {
    if (head(root) !== "export") continue;

    for (const compBlock of findAll(root, "components")) {
      for (const comp of children(compBlock, "comp")) {
        const ref = firstChildValue(comp, "ref");
        if (!ref || isVirtualRef(ref)) continue;

        const value = firstChildValue(comp, "value") ?? "";
        const footprint = firstChildValue(comp, "footprint") ?? "";
        const description =
          firstChildValue(comp, "description") ?? firstChildValue(comp, "datasheet") ?? "";
        const klass = classifyPart(ref, value, description, footprint);

        parts.push({
          ref,
          value,
          description: description || undefined,
          footprint: footprint || undefined,
          klass,
          untestableReason: untestableReason(klass),
          evidence: [evidence(file, lines, comp.line)],
        });
      }
    }

    for (const netBlock of findAll(root, "nets")) {
      for (const net of children(netBlock, "net")) {
        const rawName = firstChildValue(net, "name");
        if (!rawName) continue;
        const name = baseNetName(rawName);
        if (!name) continue;

        const nodes = children(net, "node")
          .map((node) => ({
            ref: firstChildValue(node, "ref") ?? "",
            pin: firstChildValue(node, "pin") ?? "?",
          }))
          .filter((node) => node.ref && !isVirtualRef(node.ref));

        nets.push({
          name,
          klass: classifyNet(name),
          nodes,
          nominalV: railVoltage(name),
          evidence: [evidence(file, lines, net.line)],
        });
      }
    }
  }

  if (parts.length || nets.length) {
    const connected = nets.filter((n) => n.nodes.length > 0).length;
    notes.push(
      `Netlist: ${parts.length} component${parts.length === 1 ? "" : "s"}, ${nets.length} net${nets.length === 1 ? "" : "s"}, ${connected} with pin-level connectivity.`,
    );
  } else {
    notes.push("Recognised the netlist wrapper but found no components or nets inside it.");
  }

  return { parts, nets, notes, kind: "kicad-net" };
}

function firstChildValue(node: SList, name: string): string | null {
  const [child] = children(node, name);
  return child ? atomAt(child, 0) : null;
}

/** Cheap content sniff so a `.txt` export still routes to the right reader. */
export function looksLikeKicadNetlist(text: string): boolean {
  return /\(\s*export\b/.test(text) && /\(\s*(components|nets)\b/.test(text);
}

export function looksLikeKicadSchematic(text: string): boolean {
  return /\(\s*kicad_sch\b/.test(text);
}
