/**
 * Assembles a draft: parse -> limits -> rules -> coverage -> risks -> score.
 */

import type {
  Coverage,
  CoverageEntry,
  Draft,
  InterfaceRow,
  Limit,
  Readiness,
  ReadinessFactor,
  Risk,
  SourceFile,
  TestStep,
} from "../types";
import { NET_CLASS_LABEL } from "../classify";
import { mergeSources } from "../parse";
import { inferredRailLimit, parseRequirements } from "../parse/requirements";
import { DesignContext, runRules } from "./rules";

export interface BuildInput {
  projectName: string;
  files: SourceFile[];
  requirements: string;
}

export function buildDraft({ projectName, files, requirements }: BuildInput): Draft {
  const merged = mergeSources(files);

  // Requirements text can arrive either typed into the box or as a file.
  const requirementFiles = files.filter((f) => f.kind === "requirements");
  const limits: Limit[] = [];
  if (requirements.trim()) {
    limits.push(...parseRequirements("requirements", requirements, merged.nets));
  }
  for (const file of requirementFiles) {
    limits.push(...parseRequirements(file.name, file.text, merged.nets));
  }

  // Fill gaps with conventional rail windows, clearly marked as assumptions.
  // A requirement that names a voltage but no tolerance ("accepts 5 V") still
  // counts as a gap — there's nothing there a test could fail a board on.
  for (const net of merged.nets) {
    if (net.klass !== "power") continue;
    const covered = limits.some(
      (l) =>
        l.net?.toUpperCase() === net.name.toUpperCase() &&
        l.unit === "V" &&
        l.min !== undefined &&
        l.max !== undefined,
    );
    if (covered) continue;
    const inferred = inferredRailLimit(net);
    if (inferred) limits.push(inferred);
  }

  const ctx = new DesignContext(merged.parts, merged.nets, limits);
  const generated = runRules(ctx);

  const tests: TestStep[] = generated.map((step, index) => ({
    ...step,
    id: `T${String(index + 1).padStart(2, "0")}`,
    review: "unreviewed",
  }));

  const interfaceRows = buildInterfaceMap(ctx, tests);
  const coverage = buildCoverage(ctx, tests);
  const estCycleSeconds = tests.reduce((sum, t) => sum + t.estSeconds, 0);
  const risks = buildRisks(ctx, tests, coverage, limits, files, estCycleSeconds);
  const readiness = scoreReadiness(ctx, files, limits, coverage);

  return {
    id: crypto.randomUUID(),
    projectName: projectName.trim() || "Untitled board",
    generatedAt: new Date().toISOString(),
    sourceFiles: files.map((f) => ({ name: f.name, kind: f.kind, size: f.size })),
    parts: merged.parts,
    nets: merged.nets,
    limits,
    tests,
    interfaceRows,
    risks,
    coverage,
    readiness,
    estCycleSeconds,
    requirements,
    assumptions: [
      "This is a planning draft. It is not a production release, a safety case, or a certification.",
      "The files supplied are assumed to be the current board revision.",
      "Any limit marked inferred or unresolved needs an engineer's number before it goes to a line.",
      "Fixture mechanics, probe force, creepage, RF integrity and operator safety are out of scope here.",
      "Nothing in this draft has been validated against a known-good or known-bad board yet.",
    ],
  };
}

function buildInterfaceMap(ctx: DesignContext, tests: TestStep[]): InterfaceRow[] {
  const rows: InterfaceRow[] = [];
  const used = new Set<string>();
  let pin = 1;

  const probed = ctx.probedNets();
  const pathFor = (netName: string) =>
    probed.has(netName.toUpperCase())
      ? "Pogo pin onto the existing test point"
      : ctx.hasConnectivity
        ? "No test point — add a pad or accept a clip during the next revision"
        : "Probe target not confirmed; needs a netlist to place";

  // Ground first. Two contacts, listed explicitly rather than left as a gap in
  // the pin numbering — a vendor building from this shouldn't have to guess
  // why pin 2 is missing.
  for (const net of ctx.netsOfClass("ground")) {
    for (const index of [0, 1]) {
      rows.push({
        signal: index === 0 ? net.name : `${net.name} (2nd contact)`,
        role: "Return and reference",
        instrument: "Shared by every instrument",
        fixturePath:
          index === 0
            ? "Low-impedance pogo contact"
            : "Second contact, sited away from the first to keep the return path short",
        pin: pin++,
        net: net.name,
        evidence: net.evidence.slice(0, 2),
      });
    }
    used.add(net.name.toUpperCase());
  }

  for (const net of ctx.netsOfClass("power")) {
    const key = net.name.toUpperCase();
    if (used.has(key)) continue;
    used.add(key);
    const isInput = ctx.netsOfClass("power").indexOf(net) === 0;
    rows.push({
      signal: net.name,
      role: isInput ? "Source and measure" : "Measure",
      instrument: isInput ? "Programmable PSU and DMM" : "DMM or fixture ADC",
      fixturePath: pathFor(net.name),
      pin: pin++,
      net: net.name,
      evidence: net.evidence.slice(0, 2),
    });
  }

  const roleByClass: Partial<Record<string, { role: string; instrument: string }>> = {
    swd: { role: "Program and debug", instrument: "SWD probe" },
    jtag: { role: "Program and debug", instrument: "JTAG probe" },
    i2c: { role: "Stimulate and observe", instrument: "Test controller" },
    spi: { role: "Stimulate and observe", instrument: "Test controller" },
    uart: { role: "Loopback", instrument: "USB-UART bridge" },
    can: { role: "Bus test", instrument: "CAN interface" },
    usb: { role: "Enumeration", instrument: "Fixture USB host" },
    analog: { role: "Drive and measure", instrument: "Fixture DAC and ADC" },
    reset: { role: "Drive", instrument: "Fixture GPIO" },
    gpio: { role: "Drive or observe", instrument: "Fixture GPIO" },
    rf: { role: "Specialist", instrument: "Spectrum analyser" },
  };

  const testedNets = new Set(tests.flatMap((t) => t.nets.map((n) => n.toUpperCase())));

  for (const net of ctx.nets) {
    const key = net.name.toUpperCase();
    if (used.has(key)) continue;
    const role = roleByClass[net.klass];
    if (!role) continue;
    // Only route signals a test actually uses — a fixture with 60 unused pins
    // is a fixture nobody builds.
    if (!testedNets.has(key) && net.klass !== "reset") continue;

    used.add(key);
    rows.push({
      signal: net.name,
      role: role.role,
      instrument: role.instrument,
      fixturePath: `${pathFor(net.name)} · ESD-protected channel`,
      pin: pin++,
      net: net.name,
      evidence: net.evidence.slice(0, 2),
    });
  }

  return rows;
}

function buildCoverage(ctx: DesignContext, tests: TestStep[]): Coverage {
  const byPart = new Map<string, string[]>();
  for (const test of tests) {
    if (test.review === "rejected") continue;
    for (const ref of test.covers) {
      const key = ref.toUpperCase();
      const list = byPart.get(key) ?? [];
      list.push(test.id);
      byPart.set(key, list);
    }
  }

  const entries: CoverageEntry[] = ctx.parts.map((part) => {
    const byTests = byPart.get(part.ref.toUpperCase()) ?? [];
    return {
      ref: part.ref,
      value: part.value,
      klass: part.klass,
      covered: byTests.length > 0,
      byTests,
      reason: part.untestableReason,
    };
  });

  const testable = entries.filter((e) => !e.reason);
  const covered = testable.filter((e) => e.covered);
  return {
    entries,
    testablePartCount: testable.length,
    coveredCount: covered.length,
    percent: testable.length ? Math.round((covered.length / testable.length) * 100) : 0,
  };
}

function buildRisks(
  ctx: DesignContext,
  tests: TestStep[],
  coverage: Coverage,
  limits: Limit[],
  files: SourceFile[],
  cycleSeconds: number,
): Risk[] {
  const risks: Risk[] = [];

  if (!ctx.netsOfClass("ground").length) {
    risks.push({
      id: "no-ground",
      level: "critical",
      title: "No ground net found",
      detail:
        "Every measurement and every programming connection needs a defined return path. Nothing in the supplied files names one.",
      action: "Confirm the ground net name, and give the fixture at least two ground contacts.",
      evidence: [],
    });
  }

  if (!ctx.hasConnectivity) {
    risks.push({
      id: "no-connectivity",
      level: "critical",
      title: "No pin-level connectivity in the sources",
      detail:
        "Nets were read by name only, so which pin of which part a signal lands on is guesswork. Every fixture pin assignment below is a proposal, not a mapping.",
      action: "Export a netlist from KiCad (File → Export → Netlist) and re-run the draft.",
      evidence: [],
    });
  }

  const rails = ctx.netsOfClass("power");
  const unprobed = [...rails, ...ctx.netsOfClass("swd", "jtag")].filter(
    (net) => !ctx.probedNets().has(net.name.toUpperCase()),
  );
  if (ctx.testPointCount() === 0) {
    risks.push({
      id: "no-test-points",
      level: "critical",
      title: "No test points in the design",
      detail:
        "Nothing named TP* appears in the sources. Production probing without dedicated pads means clipping onto component legs, which is slow and damages boards.",
      action: "Add pads for each rail, ground, and the programming pins before the next board revision is locked.",
      evidence: [],
    });
  } else if (unprobed.length && ctx.hasConnectivity) {
    risks.push({
      id: "unprobed-critical-nets",
      level: "high",
      title: `${unprobed.length} critical net${unprobed.length === 1 ? " has" : "s have"} no test point`,
      detail: `${unprobed.map((n) => n.name).join(", ")} — ${unprobed.length === 1 ? "this net is" : "these are"} needed for power-up or programming but no TP part connects to ${unprobed.length === 1 ? "it" : "them"}.`,
      action: "Add test pads on these nets, or accept a manual clip and the cycle time that costs.",
      evidence: unprobed.flatMap((n) => n.evidence.slice(0, 1)).slice(0, 4),
    });
  }

  const unresolved = limits.filter((l) => l.basis === "unresolved");
  const inferred = limits.filter((l) => l.basis === "inferred");
  if (unresolved.length) {
    risks.push({
      id: "unresolved-limits",
      level: "high",
      title: `${unresolved.length} requirement${unresolved.length === 1 ? "" : "s"} without a number`,
      detail: `Stated as a requirement but with no measurable threshold: ${unresolved
        .slice(0, 3)
        .map((l) => `"${l.parameter}"`)
        .join(", ")}${unresolved.length > 3 ? ", and others" : ""}.`,
      action: "Give each one a min, a max, and a unit. A test without a number can't fail a bad board.",
      evidence: unresolved.flatMap((l) => l.evidence.slice(0, 1)).slice(0, 4),
    });
  }
  if (inferred.length) {
    risks.push({
      id: "inferred-limits",
      level: "high",
      title: `${inferred.length} rail limit${inferred.length === 1 ? " was" : "s were"} assumed`,
      detail:
        "These pass bands came from a ±3% convention, not from your requirements or the regulator datasheet. Shipping them unchecked means the test may pass parts that are out of spec.",
      action: "Replace each assumed band with the regulator's stated accuracy over temperature and load.",
      evidence: inferred.flatMap((l) => l.evidence.slice(0, 1)).slice(0, 3),
    });
  }

  const uncovered = coverage.entries.filter((e) => !e.covered && !e.reason);
  if (uncovered.length) {
    risks.push({
      id: "uncovered-parts",
      level: uncovered.length > 3 ? "high" : "medium",
      title: `${uncovered.length} part${uncovered.length === 1 ? " is" : "s are"} not exercised by any test`,
      detail: `${uncovered
        .slice(0, 6)
        .map((e) => `${e.ref}${e.value ? ` (${e.value})` : ""}`)
        .join(", ")}${uncovered.length > 6 ? `, and ${uncovered.length - 6} more` : ""}. A board with one of these missing or dead would pass this sequence.`,
      action: "Either add a step that touches each part, or record a decision that it's covered elsewhere.",
      evidence: [],
    });
  }

  const specialist = tests.filter((t) => t.confidence === "specialist");
  if (specialist.length) {
    risks.push({
      id: "specialist-steps",
      level: "high",
      title: `${specialist.length} step${specialist.length === 1 ? "" : "s"} need${specialist.length === 1 ? "s" : ""} a test engineer`,
      detail: `${specialist.map((t) => t.name).join(", ")} — these involve calibrated instruments or guard bands that can't be derived from design files.`,
      action: "Get these specified by someone who has released this measurement before.",
      evidence: [],
    });
  }

  const cycleLimit = limits.find((l) => l.unit === "s" && l.max !== undefined);
  if (cycleLimit?.max !== undefined && cycleSeconds > cycleLimit.max) {
    risks.push({
      id: "cycle-time",
      level: "high",
      title: "Estimated cycle time is over the stated target",
      detail: `The proposed sequence adds up to about ${cycleSeconds} s against a target of ${cycleLimit.max} s. The estimate excludes load, unload, and operator handling.`,
      action: "Parallelise the slow steps, or renegotiate the target before the line is costed.",
      evidence: cycleLimit.evidence.slice(0, 1),
    });
  }

  if (files.length === 1) {
    risks.push({
      id: "single-source",
      level: "medium",
      title: "Only one source file",
      detail: "Cross-checking a BOM against a netlist is what catches parts that exist in one and not the other.",
      action: "Add the other exports for this revision.",
      evidence: [],
    });
  }

  risks.push({
    id: "golden-unit",
    level: "medium",
    title: "Not validated against real boards",
    detail:
      "Every limit and sequence here is unproven until it has passed a known-good board and failed a known-bad one.",
    action: "Run one golden unit, then inject two representative faults and confirm the sequence catches them.",
    evidence: [],
  });

  const order: Record<Risk["level"], number> = { critical: 0, high: 1, medium: 2 };
  return risks.sort((a, b) => order[a.level] - order[b.level]);
}

function scoreReadiness(
  ctx: DesignContext,
  files: SourceFile[],
  limits: Limit[],
  coverage: Coverage,
): Readiness {
  const factors: ReadinessFactor[] = [];

  const kinds = new Set(files.map((f) => f.kind));
  const sourceScore = ctx.hasConnectivity ? 25 : kinds.size >= 2 ? 14 : files.length ? 8 : 0;
  factors.push({
    label: "Design evidence",
    score: sourceScore,
    max: 25,
    detail: ctx.hasConnectivity
      ? "Netlist with pin-level connectivity"
      : kinds.size >= 2
        ? "Multiple sources, but no pin-level connectivity"
        : "Single source file",
  });

  const critical = [...ctx.netsOfClass("power"), ...ctx.netsOfClass("ground"), ...ctx.netsOfClass("swd", "jtag")];
  const probed = ctx.probedNets();
  const probedCount = critical.filter((n) => probed.has(n.name.toUpperCase())).length;
  const accessScore = critical.length ? Math.round((probedCount / critical.length) * 25) : 0;
  factors.push({
    label: "Test access",
    score: accessScore,
    max: 25,
    detail: critical.length
      ? `${probedCount} of ${critical.length} critical nets reach a test point`
      : "No power, ground or debug nets identified",
  });

  const measurable = limits.filter((l) => l.basis === "detected" && (l.min !== undefined || l.max !== undefined || l.note));
  const limitScore = limits.length ? Math.round((measurable.length / limits.length) * 25) : 0;
  factors.push({
    label: "Stated limits",
    score: limitScore,
    max: 25,
    detail: limits.length
      ? `${measurable.length} of ${limits.length} limits came from your requirements rather than an assumption`
      : "No requirements supplied",
  });

  const coverageScore = Math.round((coverage.percent / 100) * 25);
  factors.push({
    label: "Functional coverage",
    score: coverageScore,
    max: 25,
    detail: coverage.testablePartCount
      ? `${coverage.coveredCount} of ${coverage.testablePartCount} testable parts exercised`
      : "No testable parts identified",
  });

  const score = factors.reduce((sum, f) => sum + f.score, 0);
  const label =
    score >= 75
      ? "Ready for engineer review"
      : score >= 50
        ? "Usable start, needs design-for-test work"
        : score >= 25
          ? "Missing critical inputs"
          : "Not enough evidence to plan a test";

  return { score, factors, label };
}

/**
 * Recomputes the figures a review can move, without regenerating the draft.
 * Rejecting a step drops both its coverage contribution and its time.
 */
export function recomputeTotals(draft: Draft): { coverage: Coverage; estCycleSeconds: number } {
  const ctx = new DesignContext(draft.parts, draft.nets, draft.limits);
  return {
    coverage: buildCoverage(ctx, draft.tests),
    estCycleSeconds: draft.tests
      .filter((t) => t.review !== "rejected")
      .reduce((sum, t) => sum + t.estSeconds, 0),
  };
}

export { NET_CLASS_LABEL };
