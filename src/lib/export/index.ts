/**
 * Handoff formats.
 *
 * Five shapes, because the people receiving this want different things: an
 * engineer wants the Markdown, a fixture vendor wants the pinout CSV, a CM
 * wants the test plan CSV, and whoever writes the station code wants the
 * pytest skeleton so they aren't retyping limits by hand.
 */

import type { Basis, Draft, Limit, TestStep } from "../types";
import { PART_CLASS_LABEL } from "../classify";

const BASIS_NOTE: Record<Basis, string> = {
  detected: "read from the design files",
  inferred: "assumed from a naming convention or common practice",
  unresolved: "no source for this, so an engineer has to supply it",
};

const REVIEW_LABEL: Record<TestStep["review"], string> = {
  unreviewed: "Not reviewed",
  accepted: "Accepted",
  flagged: "Needs change",
  rejected: "Rejected",
};

function evidenceList(step: { evidence: { file: string; line: number }[] }): string {
  if (!step.evidence.length) return "n/a";
  return step.evidence.map((e) => `${e.file}:${e.line}`).join(", ");
}

function formatLimit(limit: Limit): string {
  if (limit.min !== undefined && limit.max !== undefined) return `${limit.min} to ${limit.max} ${limit.unit}`;
  if (limit.max !== undefined) return `max ${limit.max} ${limit.unit}`;
  if (limit.min !== undefined) return `min ${limit.min} ${limit.unit}`;
  if (limit.nominal !== undefined) return `${limit.nominal} ${limit.unit} nominal`;
  return limit.note ?? "not specified";
}

export function toMarkdown(draft: Draft): string {
  const active = draft.tests.filter((t) => t.review !== "rejected");
  const date = new Date(draft.generatedAt).toLocaleString();

  const lines: string[] = [];
  lines.push(`# ${draft.projectName}: production test draft`);
  lines.push("");
  lines.push(`Generated ${date} by Tegen. **This is a draft, not a release.**`);
  lines.push("");
  lines.push(
    `Every row below is tagged with where it came from: *detected* means it was read out of your files, *inferred* means it came from a convention, *unresolved* means nobody has supplied it yet.`,
  );
  lines.push("");

  lines.push("## Snapshot");
  lines.push("");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Readiness | ${draft.readiness.score}/100, ${draft.readiness.label} |`);
  lines.push(`| Functional coverage | ${draft.coverage.percent}% (${draft.coverage.coveredCount} of ${draft.coverage.testablePartCount} testable parts) |`);
  lines.push(`| Steps | ${active.length} |`);
  lines.push(`| Estimated cycle | ${draft.estCycleSeconds}s, excluding handling |`);
  lines.push(`| Open risks | ${draft.risks.length} |`);
  lines.push(`| Sources | ${draft.sourceFiles.map((f) => f.name).join(", ") || "none"} |`);
  lines.push("");

  for (const factor of draft.readiness.factors) {
    lines.push(`- **${factor.label}** ${factor.score}/${factor.max}: ${factor.detail}`);
  }
  lines.push("");

  lines.push("## Test sequence");
  lines.push("");
  lines.push("| ID | Test | Access | Stimulus | Pass criterion | Instrument | Basis | Confidence | Evidence |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const test of active) {
    lines.push(
      `| ${test.id} | ${test.name} | ${test.access} | ${test.stimulus} | ${test.expected} | ${test.instrument} | ${test.basis} | ${test.confidence} | ${evidenceList(test)} |`,
    );
  }
  lines.push("");

  const reviewed = draft.tests.filter((t) => t.review !== "unreviewed");
  if (reviewed.length) {
    lines.push("### Review state");
    lines.push("");
    for (const test of reviewed) {
      lines.push(`- **${test.id} ${test.name}**: ${REVIEW_LABEL[test.review]}${test.note ? `. ${test.note}` : ""}`);
    }
    lines.push("");
  }

  lines.push("## Fixture interface");
  lines.push("");
  if (draft.interfaceRows.length) {
    lines.push("| Pin | Signal | Role | Instrument | Proposed path |");
    lines.push("|---|---|---|---|---|");
    for (const row of draft.interfaceRows) {
      lines.push(`| ${row.pin} | \`${row.signal}\` | ${row.role} | ${row.instrument} | ${row.fixturePath} |`);
    }
  } else {
    lines.push("_No interface signals were confidently identified._");
  }
  lines.push("");

  lines.push("## Limits");
  lines.push("");
  if (draft.limits.length) {
    lines.push("| Parameter | Net | Value | Basis | Source |");
    lines.push("|---|---|---|---|---|");
    for (const limit of draft.limits) {
      lines.push(
        `| ${limit.parameter} | ${limit.net ?? "n/a"} | ${formatLimit(limit)} | ${limit.basis} | ${evidenceList(limit)} |`,
      );
    }
  } else {
    lines.push("_No measurable limits were found in the requirements._");
  }
  lines.push("");

  lines.push("## Coverage gaps");
  lines.push("");
  const uncovered = draft.coverage.entries.filter((e) => !e.covered && !e.reason);
  if (uncovered.length) {
    lines.push("These parts are not exercised by any step. A board with one of them dead would pass.");
    lines.push("");
    for (const entry of uncovered) {
      lines.push(`- \`${entry.ref}\` ${entry.value} (${PART_CLASS_LABEL[entry.klass]})`);
    }
  } else {
    lines.push("Every testable part is touched by at least one step.");
  }
  lines.push("");

  lines.push("## Open risks");
  lines.push("");
  for (const risk of draft.risks) {
    lines.push(`### ${risk.level.toUpperCase()}: ${risk.title}`);
    lines.push("");
    lines.push(risk.detail);
    lines.push("");
    lines.push(`**Next:** ${risk.action}`);
    if (risk.evidence.length) lines.push(`  \n_Source: ${evidenceList(risk)}_`);
    lines.push("");
  }

  lines.push("## Assumptions");
  lines.push("");
  for (const item of draft.assumptions) lines.push(`- ${item}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "Reviewed by: ______________________  Date: ____________  \nA qualified engineer owns the final limits, the safety case, and the release decision.",
  );
  lines.push("");

  return lines.join("\n");
}

function csvCell(value: string | number | undefined): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows: (string | number | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function toTestPlanCsv(draft: Draft): string {
  const rows: (string | number | undefined)[][] = [
    ["ID", "Test", "Purpose", "Access", "Stimulus", "Pass criterion", "Instrument", "Basis", "Confidence", "Est. seconds", "Covers", "Review", "Evidence"],
  ];
  for (const test of draft.tests) {
    rows.push([
      test.id,
      test.name,
      test.purpose,
      test.access,
      test.stimulus,
      test.expected,
      test.instrument,
      test.basis,
      test.confidence,
      test.estSeconds,
      test.covers.join(" "),
      REVIEW_LABEL[test.review],
      evidenceList(test),
    ]);
  }
  return csvRows(rows);
}

export function toPinoutCsv(draft: Draft): string {
  const rows: (string | number | undefined)[][] = [
    ["Fixture pin", "Signal", "Net", "Role", "Instrument", "Proposed path", "Evidence"],
  ];
  for (const row of draft.interfaceRows) {
    rows.push([row.pin, row.signal, row.net, row.role, row.instrument, row.fixturePath, evidenceList(row)]);
  }
  return csvRows(rows);
}

export function toJson(draft: Draft): string {
  return JSON.stringify(draft, null, 2);
}

/** snake_case identifier safe for Python. */
function pyName(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^\d/.test(slug) ? `t_${slug}` : slug || "step";
}

function pyStr(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function toPytest(draft: Draft): string {
  const active = draft.tests.filter((t) => t.review !== "rejected");
  const out: string[] = [];

  // Assign one stable dict key per limit up front. Two limits on the same net
  // would otherwise collide and Python would silently keep only the last.
  const limitKeys = new Map<Limit, string>();
  const usedKeys = new Set<string>();
  for (const limit of draft.limits) {
    const base = pyName(limit.net ?? limit.parameter) || "limit";
    let key = base;
    let suffix = 2;
    while (usedKeys.has(key)) key = `${base}_${suffix++}`;
    usedKeys.add(key);
    limitKeys.set(limit, key);
  }

  out.push('"""');
  out.push(`${draft.projectName}: production test sequence.`);
  out.push("");
  out.push(`Generated by Tegen on ${new Date(draft.generatedAt).toISOString().slice(0, 10)}.`);
  out.push("");
  out.push("DRAFT. Before this runs against real hardware:");
  out.push("  - replace every limit marked INFERRED or UNRESOLVED with a real number");
  out.push("  - implement the `dut` fixture against your actual instruments");
  out.push("  - prove it on a known-good board, then on a known-bad one");
  out.push('"""');
  out.push("");
  out.push("import pytest");
  out.push("");
  out.push("");
  out.push("# Limits pulled from the design evidence and requirements.");
  out.push("# Each entry says where it came from. Check anything not marked DETECTED.");
  out.push("LIMITS = {");
  if (draft.limits.length) {
    for (const limit of draft.limits) {
      const key = limitKeys.get(limit)!;
      const parts: string[] = [];
      if (limit.min !== undefined) parts.push(`"min": ${limit.min}`);
      if (limit.max !== undefined) parts.push(`"max": ${limit.max}`);
      if (limit.nominal !== undefined) parts.push(`"nominal": ${limit.nominal}`);
      parts.push(`"unit": "${pyStr(limit.unit)}"`);
      const comment = `${limit.basis.toUpperCase()} (${BASIS_NOTE[limit.basis]})`;
      out.push(`    "${key}": {${parts.join(", ")}},  # ${comment}`);
    }
  } else {
    out.push("    # No measurable limits were found in the requirements.");
  }
  out.push("}");
  out.push("");
  out.push("");
  out.push("@pytest.fixture(scope=\"session\")");
  out.push("def dut():");
  out.push('    """The board under test, plus the instruments pointed at it.');
  out.push("");
  out.push("    Implement against your own hardware. It needs at least:");
  out.push("      measure_voltage(net) -> float");
  out.push("      program(image_path) -> str   # returns the readback checksum");
  out.push("      scan_i2c() -> list[int]");
  out.push("      read_id(device) -> int");
  out.push('    """');
  out.push('    raise NotImplementedError("wire up the PSU, DMM and programmer here")');
  out.push("");

  for (const test of active) {
    const name = `test_${pyName(test.id)}_${pyName(test.name)}`.slice(0, 90);
    out.push("");
    out.push(`def ${name}(dut):`);
    out.push('    """');
    out.push(`    ${test.purpose}`);
    out.push("");
    out.push(`    Access:     ${test.access}`);
    out.push(`    Stimulus:   ${test.stimulus}`);
    out.push(`    Expected:   ${test.expected}`);
    out.push(`    Instrument: ${test.instrument}`);
    out.push(`    Basis:      ${test.basis.toUpperCase()} (${BASIS_NOTE[test.basis]})`);
    out.push(`    Confidence: ${test.confidence}`);
    out.push(`    Evidence:   ${evidenceList(test)}`);
    if (test.covers.length) out.push(`    Covers:     ${test.covers.join(", ")}`);
    out.push('    """');

    const railLimit = draft.limits.find(
      (l) => l.unit === "V" && l.net && test.nets.some((n) => n.toUpperCase() === l.net!.toUpperCase()),
    );

    if (test.ruleId.startsWith("power-rail:") && railLimit?.min !== undefined && railLimit.max !== undefined) {
      const key = limitKeys.get(railLimit)!;
      out.push(`    limit = LIMITS["${key}"]`);
      out.push(`    measured = dut.measure_voltage("${pyStr(railLimit.net ?? "")}")`);
      out.push(`    assert limit["min"] <= measured <= limit["max"], (`);
      out.push(`        f'${pyStr(railLimit.net ?? "rail")} measured {measured} V, '`);
      out.push(`        f'expected {limit["min"]}-{limit["max"]} V'`);
      out.push("    )");
      if (railLimit.basis !== "detected") {
        out.push(`    # WARNING: this band is ${railLimit.basis}, not from your requirements.`);
      }
    } else if (test.ruleId === "program-controller") {
      out.push('    checksum = dut.program("firmware/production.bin")');
      out.push('    assert checksum == EXPECTED_CHECKSUM, f"readback {checksum}"');
      out.push('    # TODO: set EXPECTED_CHECKSUM from your build output.');
    } else if (test.ruleId === "i2c-scan") {
      const idLimit = draft.limits.find((l) => l.unit === "id");
      out.push("    found = dut.scan_i2c()");
      if (idLimit?.note) {
        out.push(`    # ${pyStr(idLimit.note)}`);
        out.push("    expected = EXPECTED_I2C_ADDRESSES");
        out.push('    missing = [a for a in expected if a not in found]');
        out.push('    assert not missing, f"no answer from {[hex(a) for a in missing]}"');
      } else {
        out.push('    pytest.skip("TODO: list the expected I2C addresses, none were stated")');
      }
    } else if (test.basis === "unresolved") {
      out.push(`    pytest.skip("UNRESOLVED: ${pyStr(test.expected)}")`);
    } else {
      out.push(`    pytest.skip("TODO: implement. ${pyStr(test.stimulus)}")`);
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

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "board"
  );
}

export function buildExport(draft: Draft, format: "md" | "json" | "csv" | "pinout" | "pytest"): ExportFile {
  const base = slug(draft.projectName);
  switch (format) {
    case "md":
      return { filename: `${base}-test-draft.md`, content: toMarkdown(draft), mime: "text/markdown" };
    case "json":
      return { filename: `${base}-handoff.json`, content: toJson(draft), mime: "application/json" };
    case "csv":
      return { filename: `${base}-test-plan.csv`, content: toTestPlanCsv(draft), mime: "text/csv" };
    case "pinout":
      return { filename: `${base}-fixture-pinout.csv`, content: toPinoutCsv(draft), mime: "text/csv" };
    case "pytest":
      return { filename: `test_${pyName(base)}.py`, content: toPytest(draft), mime: "text/x-python" };
  }
}

export function download(file: ExportFile): void {
  const blob = new Blob([file.content], { type: `${file.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
