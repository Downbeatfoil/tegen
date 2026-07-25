/**
 * BOM reader for CSV/TSV exports.
 *
 * There is no single BOM format. KiCad, Altium, Eagle and every spreadsheet a
 * hardware engineer has ever hand-rolled all name their columns differently,
 * so this sniffs the header rather than demanding a schema.
 */

import type { Part, ParseResult } from "../types";
import { classifyPart, untestableReason } from "../classify";
import { evidence, expandRefs, sniffDelimiter, splitDelimited, toLines } from "./util";

const COLUMN_PATTERNS: { key: ColumnKey; test: RegExp }[] = [
  { key: "ref", test: /^(ref(erence)?s?|designators?|ref\s?des|part\s?ref)$/i },
  { key: "footprint", test: /^(footprint|package|pattern|pcb\s?footprint|library\s?ref)$/i },
  { key: "qty", test: /^(qty|quantity|count)$/i },
  { key: "description", test: /^(desc(ription)?|notes?|comments?)$/i },
  { key: "value", test: /^(value|val|part(\s?(number|name))?|mpn|manufacturer\s?part.*|component)$/i },
];

type ColumnKey = "ref" | "value" | "description" | "footprint" | "qty";

const REF_CELL = /^[A-Za-z_]{1,4}\d+$/;

export function parseBom(file: string, text: string): ParseResult {
  const lines = toLines(text);
  const notes: string[] = [];
  const parts: Part[] = [];

  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex === -1) {
    return { parts, nets: [], notes: ["File is empty."], kind: "bom-csv" };
  }

  const delimiter = sniffDelimiter(lines[firstContentIndex]);
  const headerCells = splitDelimited(lines[firstContentIndex], delimiter);

  const columns: Partial<Record<ColumnKey, number>> = {};
  headerCells.forEach((cell, index) => {
    for (const { key, test } of COLUMN_PATTERNS) {
      if (columns[key] === undefined && test.test(cell.trim())) {
        columns[key] = index;
        return;
      }
    }
  });

  // A first row of raw data rather than headers: fall back to positional
  // columns, which is the shape almost every ad-hoc BOM uses anyway.
  const hasHeader = columns.ref !== undefined || columns.value !== undefined;
  let startIndex = firstContentIndex + 1;
  if (!hasHeader) {
    if (REF_CELL.test(headerCells[0] ?? "")) {
      columns.ref = 0;
      columns.value = 1;
      columns.description = 2;
      startIndex = firstContentIndex;
      notes.push("No header row detected — read columns as reference, value, description.");
    } else {
      return {
        parts,
        nets: [],
        notes: ["Could not find a reference-designator column. Expected a header like `Reference,Value,Description`."],
        kind: "bom-csv",
      };
    }
  }

  const refCol = columns.ref ?? 0;
  const seen = new Set<string>();

  for (let i = startIndex; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;

    const cells = splitDelimited(raw, delimiter);
    const refCell = cells[refCol] ?? "";
    if (!refCell) continue;

    const value = pick(cells, columns.value);
    const description = pick(cells, columns.description);
    const footprint = pick(cells, columns.footprint);

    for (const ref of expandRefs(refCell)) {
      if (!/^[A-Za-z_]{1,4}\d+$/.test(ref)) continue;
      const key = ref.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const klass = classifyPart(ref, value, description, footprint);
      parts.push({
        ref,
        value,
        description: description || undefined,
        footprint: footprint || undefined,
        klass,
        untestableReason: untestableReason(klass),
        evidence: [evidence(file, lines, i + 1)],
      });
    }
  }

  notes.push(
    parts.length
      ? `BOM: ${parts.length} part${parts.length === 1 ? "" : "s"} across ${new Set(parts.map((p) => p.klass)).size} categories.`
      : "No rows with a valid reference designator (like R1, U3, TP2).",
  );

  return { parts, nets: [], notes, kind: "bom-csv" };
}

function pick(cells: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (cells[index] ?? "").trim();
}

export function looksLikeBom(text: string): boolean {
  const [first] = text.split(/\r?\n/).filter((l) => l.trim());
  if (!first) return false;
  if (/^(ref(erence)?s?|designators?|ref\s?des)\b/i.test(first.trim())) return true;
  const delimiter = sniffDelimiter(first);
  const cells = splitDelimited(first, delimiter);
  return cells.length >= 2 && REF_CELL.test(cells[0] ?? "");
}
