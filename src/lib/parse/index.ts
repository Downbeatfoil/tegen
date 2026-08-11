/**
 * File-kind detection and hashing.
 *
 * Detection is by content first, because people rename exports constantly.
 * `.kicad_prl` is local editor state (window positions, last-used layer) and
 * is deliberately ignored rather than parsed for facts.
 */

import type { SourceKind } from "../types";
import { looksLikeKicadPcb } from "./kicadPcb";

export function detectKind(name: string, text: string): SourceKind {
  const lower = name.toLowerCase();

  if (lower.endsWith(".kicad_prl")) return "ignored";
  if (lower.endsWith(".kicad_pro")) return "kicad-pro";

  if (/\(\s*kicad_sch\b/.test(text)) return "kicad-sch";
  if (looksLikeKicadPcb(text)) return "kicad-pcb";
  if (/\(\s*export\b/.test(text) && /\(\s*(components|nets)\b/.test(text)) return "kicad-net";

  if (lower.endsWith(".kicad_sch")) return "kicad-sch";
  if (lower.endsWith(".kicad_pcb")) return "kicad-pcb";
  if (lower.endsWith(".net")) return "kicad-net";
  if (lower.endsWith(".json")) return "json";
  if (/requirement|spec|limits?|acceptance|readme/i.test(lower)) return "requirements";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "bom-csv";
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "requirements";
  return "unknown";
}

/** SHA-256 of the file text, so a report can be tied to exact inputs. */
export async function hashText(text: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export const KIND_LABEL: Record<SourceKind, string> = {
  "kicad-sch": "SCH",
  "kicad-pcb": "PCB",
  "kicad-pro": "PRO",
  "kicad-net": "NET",
  "bom-csv": "BOM",
  "netlist-txt": "NET",
  requirements: "REQ",
  json: "JSON",
  ignored: "SKIP",
  unknown: "??",
};
