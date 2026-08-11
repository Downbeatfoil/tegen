/**
 * KB1 acceptance tests.
 *
 * These encode the acceptance criteria from the review, against the real
 * PocketMidi KB1 design. The golden connectivity set below was checked by hand
 * against the schematic, so a regression in the geometry or net merging fails
 * here rather than in a customer's report.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveConnectivity } from "../src/lib/parse/kicadGraph";
import { parseKicadPcb } from "../src/lib/parse/kicadPcb";
import { buildDraft } from "../src/lib/analyze";
import type { SourceFile } from "../src/lib/types";

/**
 * The fixture is PocketMidi's design, not ours, so it is not committed. Fetch
 * it before running these:
 *
 *   curl -L -o kb1.zip https://raw.githubusercontent.com/PocketMidi/KB1/main/hardware/electronics/KB1_KiCad.zip
 *   unzip kb1.zip -d .kb1/extracted
 */
const DIR = ".kb1/extracted/KB1_KiCad";
const AVAILABLE = existsSync(`${DIR}/KB1v8.1.kicad_sch`);

describe.skipIf(!AVAILABLE)("KB1", () => {
  runKb1Suite();
});

function runKb1Suite() {
const schText = readFileSync(`${DIR}/KB1v8.1.kicad_sch`, "utf8");
const pcbText = readFileSync(`${DIR}/KB1v8.1.kicad_pcb`, "utf8");

const sch: SourceFile = {
  name: "KB1v8.1.kicad_sch", size: schText.length, text: schText, kind: "kicad-sch", hash: "test",
};
const pcb: SourceFile = {
  name: "KB1v8.1.kicad_pcb", size: pcbText.length, text: pcbText, kind: "kicad-pcb", hash: "test",
};

const draft = buildDraft({ projectNameHint: "", files: [sch, pcb], requirementsText: "" });

describe("connectivity", () => {
  const conn = resolveConnectivity(schText);

  it("reconstructs pin-level connectivity instead of claiming none exists", () => {
    expect(conn.blocked).toBeUndefined();
    expect(conn.stats.wires).toBeGreaterThan(400);
    // Every pin that isn't explicitly no-connected should land on a net.
    expect(conn.stats.pinsOnNet).toBe(conn.stats.pinsTotal - conn.stats.noConnects);
  });

  it("treats same-named power symbols as one global net", () => {
    const gnd = conn.nets.filter((n) => n.name === "GND");
    expect(gnd).toHaveLength(1);
    expect(gnd[0].nodes.length).toBeGreaterThan(50);
    expect(conn.nets.filter((n) => n.name === "+3V3")).toHaveLength(1);
  });

  /** Golden set: checked by hand against the schematic. */
  it("matches the golden connectivity set", () => {
    const netFor = (ref: string, pin: string) =>
      conn.nets.find((n) => n.nodes.some((nd) => nd.ref === ref && nd.pin === pin))?.name;

    // Both expanders share the bus from the module.
    expect(netFor("U1", "12")).toBe(netFor("U2", "12"));
    expect(netFor("U1", "13")).toBe(netFor("U2", "13"));
    // Supplies.
    expect(netFor("U1", "9")).toBe("+3V3");
    expect(netFor("U1", "10")).toBe("GND");
    expect(netFor("U3", "4")).toBe("+3V3");
    // Address strapping: U1 all low, U2 has A0 high.
    expect(netFor("U1", "15")).toBe("GND");
    expect(netFor("U2", "15")).toBe("+3V3");
    expect(netFor("U2", "16")).toBe("GND");
    // The slide switch reaches the amplifier shutdown pin.
    expect(netFor("SLSW1", "6")).toBe(netFor("U3", "12"));
  });
});

describe("project isolation and traceability", () => {
  it("takes the name and revision from the design, not from anywhere else", () => {
    expect(draft.provenance.projectName).toBe("KB1");
    expect(draft.provenance.revision).toBe("8.0");
    expect(draft.provenance.company).toBe("SMJ");
  });

  it("flags the revision conflict between schematic and filename", () => {
    expect(draft.provenance.filenameRevision).toBe("8.1");
    expect(draft.provenance.revisionConflict).toMatch(/8\.0.*8\.1/);
    expect(draft.risks.some((r) => r.id === "revision-conflict")).toBe(true);
  });

  it("records every input file", () => {
    expect(draft.provenance.files.map((f) => f.name)).toEqual([
      "KB1v8.1.kicad_sch",
      "KB1v8.1.kicad_pcb",
    ]);
  });

  it("carries nothing over from another project", () => {
    const other = buildDraft({
      projectNameHint: "",
      files: [{ name: "tiny.kicad_sch", size: 20, text: "(kicad_sch (version 1))", kind: "kicad-sch", hash: "x" }],
      requirementsText: "",
    });
    // A different, unusable project must not inherit KB1's identity or content.
    expect(other.provenance.projectName).not.toBe("KB1");
    expect(other.tests).toHaveLength(0);
    expect(other.blocked).toBeTruthy();

    const text = JSON.stringify(other);
    expect(text).not.toMatch(/KB1/);
    expect(text).not.toMatch(/MCP23017/);
    expect(text).not.toMatch(/PAM8406/);
  });
});

describe("classification", () => {
  const ref = (r: string) => draft.parts.find((p) => p.ref === r);

  it("identifies the major devices correctly", () => {
    expect(ref("U1")?.klass).toBe("expander");
    expect(ref("U2")?.klass).toBe("expander");
    expect(ref("U3")?.klass).toBe("amplifier");
    expect(ref("M2")?.klass).toBe("module");
  });

  it("does not treat S6 as a firmware-readable key", () => {
    // S6 is the power switch; only its own function test may reference it.
    expect(ref("S6")?.klass).toBe("switch");
    const keyTest = draft.tests.find((t) => t.ruleId === "keys");
    expect(keyTest?.covers).not.toContain("S6");
  });

  it("counts 19 keys and controls", () => {
    expect(draft.parts.filter((p) => p.klass === "key")).toHaveLength(19);
  });

  it("excludes mechanical items and passives from the test target list", () => {
    for (const r of ["H1", "H2", "LOGO1"]) {
      expect(ref(r)?.excludedReason).toBeTruthy();
    }
    expect(draft.coverage.excluded.some((e) => e.ref === "LOGO1")).toBe(true);
  });
});

describe("no invented content", () => {
  const text = JSON.stringify(draft);

  it("invents no oscillator or antenna test", () => {
    expect(text).not.toMatch(/oscillator/i);
    expect(text).not.toMatch(/antenna.feed/i);
    expect(draft.parts.some((p) => p.klass === "crystal")).toBe(false);
  });

  it("invents no provisioning requirements", () => {
    const required = draft.tests.filter((t) => t.standing === "required");
    expect(required.some((t) => /serial|calibrat|lock|provision/i.test(t.name))).toBe(false);
  });

  it("produces no readiness score or cycle-time estimate", () => {
    expect(draft).not.toHaveProperty("readiness");
    // No "n/100" style score anywhere, and no per-step timing.
    expect(text).not.toMatch(/\d+\s*\/\s*100/);
    expect(draft.tests.every((t) => t.estSeconds === undefined)).toBe(true);
  });

  it("invents no rail tolerance when none was supplied", () => {
    // With no requirements text there is no source for a pass band, so the
    // rail step must say so rather than assume a percentage.
    const rail = draft.tests.find((t) => t.ruleId.startsWith("rail:"));
    expect(rail?.evidenceClass).toBe("unresolved");
    expect(rail?.expected).toMatch(/no pass band|derive/i);
    expect(text).not.toMatch(/3\.201|3\.399/);
  });
});

describe("derived facts", () => {
  it("derives both expander addresses from strapping, showing the working", () => {
    const scan = draft.tests.find((t) => t.ruleId === "i2c-scan");
    expect(scan).toBeTruthy();
    expect(scan!.expected).toMatch(/0x20/);
    expect(scan!.expected).toMatch(/0x21/);
    expect(scan!.evidenceClass).toBe("derived");
    expect(scan!.assumptions.join(" ")).toMatch(/A0=/);
  });
});

describe("subsystem coverage", () => {
  it("covers the subsystems that define the product", () => {
    const present = draft.subsystems.filter((s) => s.present).map((s) => s.id);
    for (const id of ["power", "mcu", "i2c", "keys", "audio", "led", "charging"]) {
      expect(present).toContain(id);
    }
  });

  it("exercises U1, U2 and U3 rather than listing them as untested", () => {
    const covered = new Set(draft.tests.flatMap((t) => t.covers));
    for (const r of ["U1", "U2", "U3"]) expect(covered).toContain(r);
  });

  it("bases coverage on behaviours, not on part counts", () => {
    expect(draft.coverage.total).toBe(draft.requirements.length);
    expect(draft.coverage.basis).toMatch(/behaviours/i);
    for (const row of draft.coverage.rows) expect(row.why.length).toBeGreaterThan(0);
  });

  it("marks BLE and the key mapping as unresolved rather than guessing", () => {
    expect(draft.subsystems.find((s) => s.id === "ble")?.evidenceClass).toBe("unresolved");
    expect(draft.openQuestions.join(" ")).toMatch(/note or action/i);
  });
});

describe("physical access", () => {
  const pcbResult = parseKicadPcb(pcbText);

  it("reads pads and vias from the PCB", () => {
    expect(pcbResult.ok).toBe(true);
    expect(pcbResult.footprints.length).toBeGreaterThan(50);
    expect(pcbResult.access.filter((a) => a.kind === "pad").length).toBeGreaterThan(200);
  });

  it("backs every claimed contact with a PCB feature", () => {
    for (const contact of draft.fixture) {
      if (contact.access.confidence === "pcb-confirmed") {
        expect(contact.access.x).toBeTypeOf("number");
        expect(contact.access.reason).toBeTruthy();
      }
    }
  });

  it("never claims a fixture can run a step it cannot reach", () => {
    for (const t of draft.tests) {
      if (!t.feasible) expect(t.feasibilityNote).toMatch(/cannot/i);
      for (const net of t.needsContacts) {
        const contact = draft.fixture.find((c) => c.net === net);
        if (t.feasible) expect(contact?.access.confidence).toBe("pcb-confirmed");
      }
    }
  });
});

describe("evidence gating", () => {
  it("gives every test a source or an explicit reason it has none", () => {
    for (const t of draft.tests) {
      expect(["detected", "derived", "documented", "unresolved"]).toContain(t.evidenceClass);
    }
  });

  it("only calls a step required when a requirement or accepted rule backs it", () => {
    for (const t of draft.tests.filter((x) => x.standing === "required")) {
      expect(t.evidenceClass).not.toBe("unresolved");
    }
  });
});
}
