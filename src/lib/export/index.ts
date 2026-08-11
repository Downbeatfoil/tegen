/**
 * Handoff formats.
 *
 * Every format leads with provenance, because a report that doesn't say which
 * files and which revision it came from can be applied to the wrong board.
 */

import type { Draft, EvidenceClass, Limit, TestStep } from "../types";
import { SUBSYSTEM_LABEL } from "../classify";

const CLASS_NOTE: Record<EvidenceClass, string> = {
  detected: "read from the design files",
  derived: "reasoned from read facts",
  documented: "stated in the supplied requirements",
  unresolved: "no source; needs customer confirmation",
};

const REVIEW_LABEL: Record<TestStep["review"], string> = {
  unreviewed: "Not reviewed",
  accepted: "Accepted",
  flagged: "Needs change",
  rejected: "Rejected",
};

function evidenceList(item: { evidence: { file: string; line: number }[] }): string {
  if (!item.evidence.length) return "n/a";
  return item.evidence.map((e) => `${e.file}:${e.line}`).join(", ");
}

function formatLimit(limit: Limit): string {
  if (limit.min !== undefined && limit.max !== undefined) return `${limit.min} to ${limit.max} ${limit.unit}`;
  if (limit.max !== undefined) return `max ${limit.max} ${limit.unit}`;
  if (limit.min !== undefined) return `min ${limit.min} ${limit.unit}`;
  if (limit.nominal !== undefined) return `${limit.nominal} ${limit.unit} nominal`;
  return limit.note ?? "not specified";
}

function provenanceLines(draft: Draft): string[] {
  const p = draft.provenance;
  const out: string[] = [];
  out.push("| | |");
  out.push("|---|---|");
  out.push(`| Project | ${p.projectName} |`);
  out.push(`| Revision | ${p.revision ?? "not stated"}${p.filenameRevision ? ` (filename says ${p.filenameRevision})` : ""} |`);
  if (p.company) out.push(`| Company | ${p.company} |`);
  if (p.designDate) out.push(`| Design date | ${p.designDate} |`);
  out.push(`| Generated | ${new Date(p.generatedAt).toLocaleString()} |`);
  for (const f of p.files) {
    out.push(`| Source | \`${f.name}\` (${f.kind}, ${f.size} bytes${f.hash ? `, sha256:${f.hash}` : ""}) |`);
  }
  return out;
}

export function toMarkdown(draft: Draft): string {
  const lines: string[] = [];
  const p = draft.provenance;

  lines.push(`# ${p.projectName}${p.revision ? ` rev ${p.revision}` : ""}: production test draft`);
  lines.push("");
  lines.push("**This is a draft, not a release.**");
  lines.push("");
  lines.push(...provenanceLines(draft));
  lines.push("");

  if (p.revisionConflict) {
    lines.push(`> **Revision conflict.** ${p.revisionConflict}`);
    lines.push("");
  }

  if (draft.blocked) {
    lines.push("## Analysis blocked");
    lines.push("");
    lines.push(draft.blocked);
    lines.push("");
    lines.push("No test plan is offered, because anything built on top of this would be guesswork.");
    lines.push("");
    return lines.join("\n");
  }

  const c = draft.connectivity;
  lines.push("## Connectivity");
  lines.push("");
  lines.push(
    `Rebuilt from ${c.wires} wires and ${c.junctions} junctions. ${c.pinsOnNet} of ${c.pinsTotal} pins resolved to a net; ${c.noConnects} are marked no-connect.`,
  );
  lines.push("");

  lines.push("## Subsystems");
  lines.push("");
  lines.push("| Subsystem | Present | Basis | Detail |");
  lines.push("|---|---|---|---|");
  for (const s of draft.subsystems) {
    lines.push(`| ${s.label} | ${s.present ? "yes" : "not found"} | ${s.evidenceClass} | ${s.detail} |`);
  }
  lines.push("");

  lines.push("## Test sequence");
  lines.push("");
  for (const t of draft.tests.filter((x) => x.review !== "rejected")) {
    lines.push(`### ${t.id}. ${t.name}`);
    lines.push("");
    lines.push(`- **Subsystem:** ${SUBSYSTEM_LABEL[t.subsystem]}`);
    lines.push(`- **Purpose:** ${t.purpose}`);
    lines.push(`- **Access:** ${t.access}`);
    lines.push(`- **Equipment:** ${t.needsEquipment.join(", ") || "none"}${t.needsFirmware ? ", manufacturing firmware" : ""}`);
    lines.push(`- **Procedure:** ${t.stimulus}`);
    lines.push(`- **Expected:** ${t.expected}`);
    lines.push(`- **Standing:** ${t.standing}`);
    lines.push(`- **Evidence class:** ${t.evidenceClass} (${CLASS_NOTE[t.evidenceClass]})`);
    lines.push(`- **Confidence:** ${t.confidence}`);
    lines.push(`- **Source:** ${evidenceList(t)}`);
    lines.push(`- **Fixture:** ${t.feasible ? "can run" : "CANNOT RUN"}. ${t.feasibilityNote}`);
    if (t.satisfies.length) lines.push(`- **Satisfies:** ${t.satisfies.join(", ")}`);
    if (t.assumptions.length) lines.push(`- **Assumptions:** ${t.assumptions.join(" ")}`);
    if (t.openQuestions.length) lines.push(`- **Open questions:** ${t.openQuestions.join(" ")}`);
    if (t.review !== "unreviewed") lines.push(`- **Review:** ${REVIEW_LABEL[t.review]}${t.note ? `. ${t.note}` : ""}`);
    lines.push("");
  }

  lines.push("## Coverage");
  lines.push("");
  lines.push(`${draft.coverage.covered} of ${draft.coverage.total} required behaviours are covered (${draft.coverage.percent}%).`);
  lines.push("");
  lines.push(draft.coverage.basis);
  lines.push("");
  lines.push("| Requirement | Subsystem | Behaviour | Basis | Covered by | Why it is in the list |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of draft.coverage.rows) {
    lines.push(
      `| ${r.requirementId} | ${SUBSYSTEM_LABEL[r.subsystem]} | ${r.behaviour} | ${r.evidenceClass} | ${r.byTests.join(", ") || "**nothing**"} | ${r.why} |`,
    );
  }
  lines.push("");
  if (draft.coverage.excluded.length) {
    lines.push("Excluded from the denominator:");
    lines.push("");
    for (const e of draft.coverage.excluded) lines.push(`- \`${e.ref}\`: ${e.reason}`);
    lines.push("");
  }

  lines.push("## Fixture interface");
  lines.push("");
  if (draft.fixture.length) {
    lines.push("| Pin | Net | Access | Side | Location | Confidence | Basis |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const f of draft.fixture) {
      const a = f.access;
      lines.push(
        `| ${f.id} | \`${f.net}\` | ${a.kind}${a.ref ? ` ${a.ref}.${a.pad}` : ""} | ${a.side ?? "n/a"} | ${a.x !== undefined ? `${a.x}, ${a.y}` : "n/a"} | ${a.confidence} | ${a.reason} |`,
      );
    }
  } else {
    lines.push("No fixture contacts are required: every step runs through the product's own interfaces.");
  }
  lines.push("");

  if (draft.limits.length) {
    lines.push("## Limits");
    lines.push("");
    lines.push("| Parameter | Net | Value | Basis | Source |");
    lines.push("|---|---|---|---|---|");
    for (const l of draft.limits) {
      lines.push(`| ${l.parameter} | ${l.net ?? "n/a"} | ${formatLimit(l)} | ${l.evidenceClass} | ${evidenceList(l)} |`);
    }
    lines.push("");
  }

  lines.push("## Open questions");
  lines.push("");
  if (draft.openQuestions.length) {
    for (const q of draft.openQuestions) lines.push(`- ${q}`);
  } else {
    lines.push("None outstanding.");
  }
  lines.push("");

  lines.push("## Risks");
  lines.push("");
  for (const r of draft.risks) {
    lines.push(`### ${r.level.toUpperCase()}: ${r.title}`);
    lines.push("");
    lines.push(r.detail);
    lines.push("");
    lines.push(`**Next:** ${r.action}`);
    lines.push("");
  }

  lines.push("## Assumptions");
  lines.push("");
  for (const a of draft.assumptions) lines.push(`- ${a}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Reviewed by: ______________________  Date: ____________");
  lines.push("");

  return lines.join("\n");
}

function csvCell(value: string | number | undefined): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvRows = (rows: (string | number | undefined)[][]) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

export function toTestPlanCsv(draft: Draft): string {
  const rows: (string | number | undefined)[][] = [
    ["ID", "Subsystem", "Test", "Purpose", "Access", "Procedure", "Expected", "Equipment", "Standing", "Evidence class", "Confidence", "Feasible", "Satisfies", "Covers", "Review", "Source"],
  ];
  for (const t of draft.tests) {
    rows.push([
      t.id,
      SUBSYSTEM_LABEL[t.subsystem],
      t.name,
      t.purpose,
      t.access,
      t.stimulus,
      t.expected,
      t.needsEquipment.join(" "),
      t.standing,
      t.evidenceClass,
      t.confidence,
      t.feasible ? "yes" : "no",
      t.satisfies.join(" "),
      t.covers.join(" "),
      REVIEW_LABEL[t.review],
      evidenceList(t),
    ]);
  }
  return csvRows(rows);
}

export function toPinoutCsv(draft: Draft): string {
  const rows: (string | number | undefined)[][] = [
    ["Fixture pin", "Net", "Access kind", "Ref", "Pad", "Side", "X (mm)", "Y (mm)", "Size (mm)", "Confidence", "Basis"],
  ];
  for (const f of draft.fixture) {
    const a = f.access;
    rows.push([f.id, f.net, a.kind, a.ref, a.pad, a.side, a.x, a.y, a.sizeMm, a.confidence, a.reason]);
  }
  return csvRows(rows);
}

export function toCoverageCsv(draft: Draft): string {
  const rows: (string | number | undefined)[][] = [
    ["Requirement", "Subsystem", "Behaviour", "Evidence class", "Covered", "By tests", "Why it is required"],
  ];
  for (const r of draft.coverage.rows) {
    rows.push([
      r.requirementId,
      SUBSYSTEM_LABEL[r.subsystem],
      r.behaviour,
      r.evidenceClass,
      r.covered ? "yes" : "no",
      r.byTests.join(" "),
      r.why,
    ]);
  }
  return csvRows(rows);
}

export function toJson(draft: Draft): string {
  return JSON.stringify(draft, null, 2);
}

const pyName = (t: string) => {
  const s = t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^\d/.test(s) ? `t_${s}` : s || "step";
};
const pyStr = (t: string) => t.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export function toPytest(draft: Draft): string {
  const out: string[] = [];
  const p = draft.provenance;

  out.push('"""');
  out.push(`${p.projectName}${p.revision ? ` rev ${p.revision}` : ""}: production test sequence.`);
  out.push("");
  out.push(`Generated by Tegen on ${new Date(p.generatedAt).toISOString().slice(0, 10)} from:`);
  for (const f of p.files) out.push(`  ${f.name}${f.hash ? ` (sha256:${f.hash})` : ""}`);
  out.push("");
  out.push("DRAFT. Before this runs against hardware:");
  out.push("  - supply a real threshold anywhere this file says UNRESOLVED");
  out.push("  - implement the dut fixture against your own equipment");
  out.push("  - prove it on a known-good board, then on a known-bad one");
  out.push('"""');
  out.push("");
  out.push("import pytest");
  out.push("");
  out.push("");

  const banded = draft.limits.filter((l) => l.min !== undefined && l.max !== undefined);
  out.push("# Only limits with a real source appear here. Nothing is invented.");
  out.push("LIMITS = {");
  if (banded.length) {
    const used = new Set<string>();
    for (const l of banded) {
      let k = pyName(l.net ?? l.parameter);
      while (used.has(k)) k = `${k}_2`;
      used.add(k);
      out.push(`    "${k}": {"min": ${l.min}, "max": ${l.max}, "unit": "${pyStr(l.unit)}"},  # ${l.evidenceClass.toUpperCase()}`);
    }
  } else {
    out.push("    # No banded limits were supplied. Every threshold below is unresolved.");
  }
  out.push("}");
  out.push("");
  out.push("");
  out.push('@pytest.fixture(scope="session")');
  out.push("def dut():");
  out.push('    """Board under test plus the equipment pointed at it."""');
  out.push('    raise NotImplementedError("wire up the station here")');
  out.push("");

  for (const t of draft.tests.filter((x) => x.review !== "rejected")) {
    out.push("");
    out.push(`def test_${pyName(t.id)}_${pyName(t.name)}(dut):`.slice(0, 95));
    out.push('    """');
    out.push(`    ${t.purpose}`);
    out.push("");
    out.push(`    Subsystem:  ${SUBSYSTEM_LABEL[t.subsystem]}`);
    out.push(`    Access:     ${t.access}`);
    out.push(`    Procedure:  ${t.stimulus}`);
    out.push(`    Expected:   ${t.expected}`);
    out.push(`    Standing:   ${t.standing}`);
    out.push(`    Basis:      ${t.evidenceClass} (${CLASS_NOTE[t.evidenceClass]})`);
    out.push(`    Source:     ${evidenceList(t)}`);
    out.push(`    Fixture:    ${t.feasible ? "can run" : "CANNOT RUN as specified"}`);
    for (const q of t.openQuestions) out.push(`    Open:       ${q}`);
    out.push('    """');

    const railLimit = banded.find((l) => l.net && t.nets.includes(l.net));
    if (!t.feasible) {
      out.push(`    pytest.skip("fixture cannot reach what this step needs: ${pyStr(t.feasibilityNote)}")`);
    } else if (t.ruleId.startsWith("rail:") && railLimit) {
      const k = pyName(railLimit.net ?? railLimit.parameter);
      out.push(`    limit = LIMITS["${k}"]`);
      out.push(`    measured = dut.measure_voltage("${pyStr(railLimit.net ?? "")}")`);
      out.push('    assert limit["min"] <= measured <= limit["max"], (');
      out.push(`        f'${pyStr(railLimit.net ?? "rail")} measured {measured} V, '`);
      out.push('        f\'expected {limit["min"]}-{limit["max"]} V\'');
      out.push("    )");
    } else if (t.evidenceClass === "unresolved") {
      out.push(`    pytest.skip("UNRESOLVED: ${pyStr(t.expected)}")`);
    } else {
      out.push(`    pytest.skip("TODO: implement. ${pyStr(t.stimulus)}")`);
    }
    out.push("");
  }

  return out.join("\n");
}

export interface ExportFile {
  filename: string;
  content: string;
  mime: string;
}

const slug = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "board";

export type ExportFormat = "md" | "json" | "csv" | "pinout" | "coverage" | "pytest";

export function buildExport(draft: Draft, format: ExportFormat): ExportFile {
  const base = slug(`${draft.provenance.projectName}${draft.provenance.revision ? `-rev${draft.provenance.revision}` : ""}`);
  switch (format) {
    case "md":
      return { filename: `${base}-test-draft.md`, content: toMarkdown(draft), mime: "text/markdown" };
    case "json":
      return { filename: `${base}-handoff.json`, content: toJson(draft), mime: "application/json" };
    case "csv":
      return { filename: `${base}-test-plan.csv`, content: toTestPlanCsv(draft), mime: "text/csv" };
    case "pinout":
      return { filename: `${base}-fixture-pinout.csv`, content: toPinoutCsv(draft), mime: "text/csv" };
    case "coverage":
      return { filename: `${base}-coverage-matrix.csv`, content: toCoverageCsv(draft), mime: "text/csv" };
    case "pytest":
      return { filename: `test_${pyName(base)}.py`, content: toPytest(draft), mime: "text/x-python" };
  }
}

export function download(file: ExportFile): void {
  const blob = new Blob([file.content], { type: `${file.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
