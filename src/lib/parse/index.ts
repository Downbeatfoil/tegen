/**
 * File-kind detection and merging.
 *
 * A project usually arrives as several partial views of the same board — a BOM
 * that knows part numbers, a netlist that knows connectivity, a schematic that
 * knows labels. Merging them by reference designator gives a fuller picture
 * than any one file, and keeps the evidence from all of them.
 */

import type { Net, Part, ParseResult, SourceFile, SourceKind } from "../types";
import { classifyPart, untestableReason } from "../classify";
import { looksLikeBom, parseBom } from "./bom";
import { looksLikeKicadNetlist, looksLikeKicadSchematic, parseKicadNetlist, parseKicadSchematic } from "./kicad";
import { looksLikePlainNetlist, parsePlainNetlist } from "./netlist";

export function detectKind(name: string, text: string): SourceKind {
  const lower = name.toLowerCase();

  // Content beats extension — people rename exports constantly.
  if (looksLikeKicadSchematic(text)) return "kicad-sch";
  if (looksLikeKicadNetlist(text)) return "kicad-net";

  if (lower.endsWith(".kicad_sch")) return "kicad-sch";
  if (lower.endsWith(".net")) return "kicad-net";
  if (lower.endsWith(".json")) return "json";
  if (/requirement|spec|limits?|acceptance/i.test(lower)) return "requirements";

  if (looksLikeBom(text)) return "bom-csv";
  if (looksLikePlainNetlist(text)) return "netlist-txt";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "bom-csv";
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "requirements";
  return "unknown";
}

export function parseSource(file: SourceFile): ParseResult {
  switch (file.kind) {
    case "kicad-sch":
      return parseKicadSchematic(file.name, file.text);
    case "kicad-net":
      return parseKicadNetlist(file.name, file.text);
    case "bom-csv":
      return parseBom(file.name, file.text);
    case "netlist-txt":
      return parsePlainNetlist(file.name, file.text);
    case "json":
      return parseJsonSource(file.name, file.text);
    case "requirements":
      return {
        parts: [],
        nets: [],
        notes: ["Read as requirements text — scanned for measurable limits."],
        kind: "requirements",
      };
    default:
      return {
        parts: [],
        nets: [],
        notes: ["Unrecognised format. Nothing was read from this file."],
        kind: "unknown",
      };
  }
}

/** Accepts a previously exported handoff, so a draft can be reopened. */
function parseJsonSource(file: string, text: string): ParseResult {
  try {
    const data = JSON.parse(text) as { parts?: Part[]; nets?: Net[] };
    const parts = Array.isArray(data.parts) ? data.parts : [];
    const nets = Array.isArray(data.nets) ? data.nets : [];
    return {
      parts,
      nets,
      notes: [`Read ${parts.length} parts and ${nets.length} nets from JSON.`],
      kind: "json",
    };
  } catch {
    return { parts: [], nets: [], notes: [`${file} is not valid JSON.`], kind: "json" };
  }
}

export interface MergedDesign {
  parts: Part[];
  nets: Net[];
  notes: { file: string; messages: string[] }[];
}

export function mergeSources(files: SourceFile[]): MergedDesign {
  const partsByRef = new Map<string, Part>();
  const netsByName = new Map<string, Net>();
  const notes: MergedDesign["notes"] = [];

  for (const file of files) {
    const result = parseSource(file);
    notes.push({ file: file.name, messages: result.notes });

    for (const part of result.parts) {
      const key = part.ref.toUpperCase();
      const existing = partsByRef.get(key);
      if (!existing) {
        partsByRef.set(key, { ...part, evidence: [...part.evidence] });
        continue;
      }
      // Keep the richest description we've seen for this designator.
      existing.value ||= part.value;
      existing.description ??= part.description;
      existing.footprint ??= part.footprint;
      existing.evidence.push(...part.evidence);
      const klass = classifyPart(
        existing.ref,
        existing.value,
        existing.description ?? "",
        existing.footprint ?? "",
      );
      existing.klass = klass;
      existing.untestableReason = untestableReason(klass);
    }

    for (const net of result.nets) {
      const key = net.name.toUpperCase();
      const existing = netsByName.get(key);
      if (!existing) {
        netsByName.set(key, { ...net, nodes: [...net.nodes], evidence: [...net.evidence] });
        continue;
      }
      existing.evidence.push(...net.evidence);
      existing.nominalV ??= net.nominalV;
      if (existing.klass === "unknown") existing.klass = net.klass;
      for (const node of net.nodes) {
        const dup = existing.nodes.some((n) => n.ref === node.ref && n.pin === node.pin);
        if (!dup) existing.nodes.push(node);
      }
    }
  }

  const parts = [...partsByRef.values()].sort((a, b) => naturalRef(a.ref).localeCompare(naturalRef(b.ref)));
  const nets = [...netsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { parts, nets, notes };
}

/** Sorts R2 before R10 instead of after it. */
function naturalRef(ref: string): string {
  return ref.replace(/(\d+)/g, (d) => d.padStart(6, "0"));
}
