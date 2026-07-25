import type { Evidence } from "../types";

/** Builds an Evidence pointer, trimming the source line for display. */
export function evidence(file: string, lines: string[], line: number): Evidence {
  const raw = lines[line - 1] ?? "";
  const snippet = raw.trim().slice(0, 160);
  return { file, line, snippet };
}

/** Splits once and reuses — these files get scanned repeatedly. */
export function toLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** 1-indexed line number of the first line matching `test`, else 1. */
export function findLine(lines: string[], test: (line: string) => boolean): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (test(lines[i])) return i + 1;
  }
  return 1;
}

/**
 * Splits a CSV/TSV row, honouring quoted fields and doubled quotes.
 * Altium, KiCad and every spreadsheet export disagree slightly on quoting,
 * so this stays deliberately forgiving.
 */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      out.push(field.trim());
      field = "";
      continue;
    }
    field += ch;
  }
  out.push(field.trim());
  return out;
}

/** Picks the delimiter that yields the most columns on the header row. */
export function sniffDelimiter(headerLine: string): string {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = splitDelimited(headerLine, d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Expands designator groups that BOM tools collapse.
 * "R1,R2, R5-R7" -> ["R1","R2","R5","R6","R7"]
 */
export function expandRefs(cell: string): string[] {
  const out: string[] = [];
  for (const chunk of cell.split(/[,;]+/)) {
    const token = chunk.trim();
    if (!token) continue;

    const range = token.match(/^([A-Za-z_]+)(\d+)\s*[-–]\s*(?:[A-Za-z_]+)?(\d+)$/);
    if (range) {
      const [, prefix, startStr, endStr] = range;
      const start = Number(startStr);
      const end = Number(endStr);
      if (end >= start && end - start < 500) {
        for (let n = start; n <= end; n += 1) out.push(`${prefix}${n}`);
        continue;
      }
    }
    out.push(token);
  }
  return out;
}
