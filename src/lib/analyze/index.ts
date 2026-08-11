/**
 * Draft builder.
 *
 * Order matters: provenance, then connectivity, then subsystems, then
 * requirements, then tests, then fixture, then coverage. Each stage is only
 * allowed to use what the earlier stages actually established. If connectivity
 * fails, everything downstream is skipped and the project is reported blocked
 * rather than filled in with plausible-looking guesses.
 */

import type {
  ConnectivityReport,
  Coverage,
  CoverageRow,
  Draft,
  Evidence,
  EvidenceClass,
  FixtureContact,
  Limit,
  Net,
  Part,
  PhysicalAccess,
  Provenance,
  Requirement,
  Risk,
  SourceFile,
  Subsystem,
  SubsystemId,
  TestStep,
} from "../types";
import {
  NET_CLASS_LABEL,
  SUBSYSTEM_LABEL,
  classifyNet,
  classifyPart,
  excludedReason,
  railVoltage,
  subsystemOf,
} from "../classify";
import { resolveConnectivity, type ConnectivityResult } from "../parse/kicadGraph";
import { bestAccessForNet, parseKicadPcb, type PcbResult } from "../parse/kicadPcb";
import { parseRequirements } from "../parse/requirements";
import { evidence, toLines } from "../parse/util";

export interface BuildInput {
  /** Only used when the design files carry no title of their own. */
  projectNameHint: string;
  files: SourceFile[];
  requirementsText: string;
}

// ------------------------------------------------------------- provenance --

function revisionFromFilename(name: string): string | undefined {
  const m = name.match(/[_-]?v(\d+(?:\.\d+)?)/i);
  return m ? m[1] : undefined;
}

function buildProvenance(files: SourceFile[], conn: ConnectivityResult | null, hint: string): Provenance {
  const sch = files.find((f) => f.kind === "kicad-sch");
  const titleBlock = conn?.titleBlock ?? {};

  // Name comes from the design itself where possible, then the filename, and
  // only then from whatever the user typed. It is never inherited from a
  // previous run: that is how one board's report ends up titled with another
  // board's name.
  const fromFile = sch ? sch.name.replace(/\.[^.]+$/, "") : "";
  const projectName = titleBlock.title?.trim() || fromFile || hint.trim() || "Untitled board";

  const revision = titleBlock.rev?.trim() || undefined;
  const filenameRevision = sch ? revisionFromFilename(sch.name) : undefined;
  let revisionConflict: string | undefined;
  if (revision && filenameRevision && revision !== filenameRevision) {
    revisionConflict = `The schematic states revision ${revision}, but the filename says ${filenameRevision}. Confirm which is the build revision before this plan is used.`;
  }

  return {
    projectName,
    revision,
    filenameRevision,
    revisionConflict,
    company: titleBlock.company?.trim() || undefined,
    designDate: titleBlock.date?.trim() || undefined,
    files: files.map((f) => ({ name: f.name, kind: f.kind, size: f.size, hash: f.hash ?? "" })),
    generatedAt: new Date().toISOString(),
  };
}

// -------------------------------------------------------------- I2C logic --

const EXPANDER_BASE: { test: RegExp; base: number; straps: string[] }[] = [
  { test: /MCP230(08|17)/i, base: 0x20, straps: ["A0", "A1", "A2"] },
  { test: /PCF8574A/i, base: 0x38, straps: ["A0", "A1", "A2"] },
  { test: /PCF8574/i, base: 0x20, straps: ["A0", "A1", "A2"] },
];

interface DerivedAddress {
  ref: string;
  address: number;
  workings: string;
}

/**
 * Works out a strapped I²C address from what the address pins are tied to.
 * This is reasoning over read facts, not a lookup, so it is reported as
 * `derived` with the strapping spelled out for review.
 */
function deriveI2cAddresses(parts: Part[], nets: Net[]): DerivedAddress[] {
  /** Which net a given part pin sits on. */
  const netForPin = (ref: string, pin: string): Net | undefined =>
    nets.find((n) => n.nodes.some((nd) => nd.ref === ref && nd.pin === pin));

  const out: DerivedAddress[] = [];
  for (const part of parts) {
    const rule = EXPANDER_BASE.find((r) => r.test.test(part.value));
    if (!rule) continue;

    let address = rule.base;
    const bits: string[] = [];
    let resolvable = true;

    rule.straps.forEach((strap, index) => {
      const pin = part.pins.find((p) => (p.pinName ?? "").toUpperCase() === strap);
      if (!pin) {
        resolvable = false;
        return;
      }
      const net = netForPin(part.ref, pin.pin);
      if (!net) {
        resolvable = false;
        return;
      }
      const high = net.klass === "power";
      const low = net.klass === "ground";
      if (!high && !low) {
        resolvable = false;
        return;
      }
      if (high) address |= 1 << index;
      bits.push(`${strap}=${high ? "high" : "low"} (${net.name})`);
    });

    if (resolvable) {
      out.push({
        ref: part.ref,
        address,
        workings: `base 0x${rule.base.toString(16)} with ${bits.join(", ")}`,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------- subsystems --

function detectSubsystems(parts: Part[], nets: Net[]): Subsystem[] {
  const out: Subsystem[] = [];
  const add = (
    id: SubsystemId,
    present: boolean,
    detail: string,
    evidenceClass: EvidenceClass,
    partRefs: string[],
    netNames: string[],
    ev: Evidence[],
  ) => {
    out.push({
      id,
      label: SUBSYSTEM_LABEL[id],
      present,
      parts: partRefs,
      nets: netNames,
      detail,
      evidenceClass,
      evidence: ev.slice(0, 3),
    });
  };

  const byClass = (...classes: string[]) => parts.filter((p) => classes.includes(p.klass));
  const ev = (items: { evidence: Evidence[] }[]) => items.flatMap((i) => i.evidence.slice(0, 1));

  const rails = nets.filter((n) => n.klass === "power");
  const grounds = nets.filter((n) => n.klass === "ground");
  if (rails.length || grounds.length) {
    add(
      "power",
      true,
      `${rails.length} power rail${rails.length === 1 ? "" : "s"} and ${grounds.length} ground net${grounds.length === 1 ? "" : "s"} identified.`,
      "detected",
      byClass("regulator").map((p) => p.ref),
      [...rails, ...grounds].map((n) => n.name),
      ev([...rails, ...grounds]),
    );
  }

  const batteries = byClass("battery");
  const chargers = parts.filter((p) => p.subsystem === "charging");
  if (batteries.length || chargers.length) {
    add(
      "charging",
      true,
      `${batteries.length ? "Battery present. " : ""}Charging behaviour is a product decision and is not fully described by the schematic.`,
      batteries.length ? "detected" : "derived",
      chargers.map((p) => p.ref),
      [],
      ev(chargers),
    );
  }

  const modules = byClass("module", "mcu");
  if (modules.length) {
    add(
      "mcu",
      true,
      `${modules.map((m) => m.value).join(", ")}. Programming and boot behaviour depend on the module, not on board-level circuitry.`,
      "detected",
      modules.map((p) => p.ref),
      [],
      ev(modules),
    );
  }

  const expanders = byClass("expander");
  if (expanders.length) {
    add(
      "i2c",
      true,
      `${expanders.length} I/O expander${expanders.length === 1 ? "" : "s"} on a shared bus.`,
      "detected",
      expanders.map((p) => p.ref),
      [],
      ev(expanders),
    );
  }

  const keys = byClass("key");
  const switches = byClass("switch");
  if (keys.length || switches.length) {
    add(
      "keys",
      true,
      `${keys.length} key/control part${keys.length === 1 ? "" : "s"} and ${switches.length} switch${switches.length === 1 ? "" : "es"}. Note-to-key mapping is a firmware behaviour and is not in the schematic.`,
      "detected",
      [...keys, ...switches].map((p) => p.ref),
      [],
      ev([...keys, ...switches]),
    );
  }

  const amps = byClass("amplifier");
  const speakers = byClass("speaker");
  const audioConn = parts.filter((p) => p.subsystem === "audio" && p.klass === "connector");
  if (amps.length || speakers.length || audioConn.length) {
    add(
      "audio",
      true,
      `${amps.length ? `${amps.map((a) => a.value).join(", ")} amplifier. ` : ""}${speakers.length ? "Speaker pads present. " : ""}${audioConn.length ? `${audioConn.length} audio connectors.` : ""}`,
      "detected",
      [...amps, ...speakers, ...audioConn].map((p) => p.ref),
      [],
      ev([...amps, ...speakers, ...audioConn]),
    );
  }

  const midiParts = parts.filter((p) => p.subsystem === "midi");
  const midiNets = nets.filter((n) => /midi/i.test(n.name));
  add(
    "midi",
    midiParts.length > 0 || midiNets.length > 0,
    midiParts.length || midiNets.length
      ? "MIDI hardware identified in the design."
      : "No dedicated MIDI hardware found. If MIDI ships over USB or BLE, that is a firmware behaviour the design files cannot confirm.",
    midiParts.length || midiNets.length ? "detected" : "unresolved",
    midiParts.map((p) => p.ref),
    midiNets.map((n) => n.name),
    ev(midiParts),
  );

  const leds = byClass("led");
  if (leds.length) {
    add("led", true, `${leds.length} indicators.`, "detected", leds.map((p) => p.ref), [], ev(leds));
  }

  const usbParts = parts.filter((p) => p.subsystem === "usb");
  const usbCapableModule = modules.some((m) => /XIAO|ESP32|RP2040|Pico|nRF52/i.test(m.value));
  add(
    "usb",
    usbParts.length > 0 || usbCapableModule,
    usbParts.length
      ? "USB connector on the board."
      : usbCapableModule
        ? "USB is provided by the module's own connector rather than by board-level circuitry, so board test reaches it only through the module."
        : "No USB found.",
    usbParts.length ? "detected" : usbCapableModule ? "derived" : "unresolved",
    usbParts.map((p) => p.ref),
    [],
    ev(usbParts),
  );

  const radioModule = modules.find((m) => /ESP32|nRF5|BLE|WiFi|XIAO/i.test(m.value));
  add(
    "ble",
    Boolean(radioModule),
    radioModule
      ? `The radio is inside ${radioModule.ref} (${radioModule.value}). There is no board-level antenna net, so no RF fixture access can be claimed. Whether BLE is a shipping requirement is a product question.`
      : "No radio identified.",
    "unresolved",
    radioModule ? [radioModule.ref] : [],
    [],
    radioModule ? radioModule.evidence.slice(0, 1) : [],
  );

  const touchNets = nets.filter((n) => /touch|cap(sense)?\d/i.test(n.name));
  add(
    "touch",
    touchNets.length > 0,
    touchNets.length
      ? "Touch nets identified by name."
      : "No touch inputs identified in the schematic. If the product ships touch, confirm which pins implement it.",
    touchNets.length ? "detected" : "unresolved",
    [],
    touchNets.map((n) => n.name),
    ev(touchNets),
  );

  return out;
}

// ----------------------------------------------------------- requirements --

let reqCounter = 0;
function req(
  subsystem: SubsystemId,
  behaviour: string,
  evidenceClass: EvidenceClass,
  rationale: string,
  ev: Evidence[],
): Requirement {
  reqCounter += 1;
  return { id: `R${String(reqCounter).padStart(2, "0")}`, subsystem, behaviour, evidenceClass, rationale, evidence: ev.slice(0, 2) };
}

function buildRequirements(
  subsystems: Subsystem[],
  parts: Part[],
  nets: Net[],
  addresses: DerivedAddress[],
  userLimits: Limit[],
): Requirement[] {
  reqCounter = 0;
  const out: Requirement[] = [];
  const on = (id: SubsystemId) => subsystems.find((s) => s.id === id && s.present);

  const power = on("power");
  if (power) {
    for (const rail of nets.filter((n) => n.klass === "power")) {
      out.push(
        req(
          "power",
          `${rail.name} is present and within its allowed range`,
          "derived",
          "A rail that powers active devices has to be verified before anything downstream means anything.",
          rail.evidence,
        ),
      );
    }
    out.push(
      req("power", "No rail is shorted to ground before power is applied", "derived", "Standard practice: a short found after power costs a board.", []),
    );
  }

  if (on("mcu")) {
    const m = parts.find((p) => p.klass === "module" || p.klass === "mcu");
    out.push(req("mcu", "The controller accepts production firmware and reports back", "derived", "Nothing else on the board can be exercised until firmware runs.", m?.evidence ?? []));
  }

  for (const addr of addresses) {
    out.push(
      req(
        "i2c",
        `${addr.ref} responds at 0x${addr.address.toString(16)}`,
        "derived",
        `Address strapping read from the schematic: ${addr.workings}.`,
        parts.find((p) => p.ref === addr.ref)?.evidence ?? [],
      ),
    );
  }

  const keys = parts.filter((p) => p.klass === "key");
  if (keys.length) {
    out.push(
      req(
        "keys",
        `All ${keys.length} keys and controls register when actuated`,
        "derived",
        `${keys.length} key parts are wired to expander or controller inputs.`,
        keys[0]?.evidence ?? [],
      ),
    );
    out.push(
      req(
        "keys",
        "No stuck, shorted or cross-coupled inputs",
        "derived",
        "A matrix or expander input network can pass a single-key test and still have a shorted row or column.",
        [],
      ),
    );
    out.push(
      req("keys", "Each key produces the note or action the product specifies", "unresolved", "The mapping is firmware behaviour; the schematic cannot state it.", []),
    );
  }

  const switches = parts.filter((p) => p.klass === "switch");
  for (const sw of switches) {
    out.push(req("keys", `${sw.ref} performs its intended function`, "derived", `Switch present in the design (${sw.value}).`, sw.evidence));
  }

  if (on("audio")) {
    out.push(req("audio", "Audio reaches both output channels at the expected level", "derived", "An amplifier and outputs are present in the design.", []));
    out.push(req("audio", "Audio input is captured", "derived", "Input jacks are present in the design.", []));
  }

  for (const led of parts.filter((p) => p.klass === "led")) {
    out.push(req("led", `${led.ref} (${led.value}) lights under control`, "derived", "Indicator present and driven from a controller or expander pin.", led.evidence));
  }

  if (on("charging")) {
    out.push(req("charging", "The unit runs from battery", "derived", "A battery and battery connector are in the design.", []));
    out.push(req("charging", "The battery charges when external power is applied", "unresolved", "Charging behaviour is not described by the supplied files.", []));
  }

  const usb = on("usb");
  if (usb) {
    out.push(req("usb", "The unit enumerates over USB and can be flashed", "derived", usb.detail, []));
  }

  const midi = subsystems.find((s) => s.id === "midi");
  out.push(
    req(
      "midi",
      "MIDI messages are sent and received as the product specifies",
      midi?.present ? "derived" : "unresolved",
      midi?.present ? "MIDI hardware is present." : "No MIDI hardware found; the transport has to be confirmed.",
      [],
    ),
  );

  out.push(req("ble", "BLE behaviour, if BLE is a shipping requirement", "unresolved", "The radio is inside the module and the requirement is a product decision.", []));

  // Anything the customer wrote down is a documented requirement in its own
  // right, whether or not we could turn it into a number.
  for (const limit of userLimits) {
    out.push(
      req(
        limit.net ? "power" : "unclassified",
        limit.parameter,
        "documented",
        "Stated in the supplied requirements.",
        limit.evidence,
      ),
    );
  }

  return out;
}

// ------------------------------------------------------------------ tests --

interface TestDraft extends Omit<TestStep, "id" | "review" | "feasible" | "feasibilityNote"> {}

function buildTests(
  subsystems: Subsystem[],
  parts: Part[],
  nets: Net[],
  requirements: Requirement[],
  addresses: DerivedAddress[],
  limits: Limit[],
): TestDraft[] {
  const tests: TestDraft[] = [];
  const on = (id: SubsystemId) => subsystems.find((s) => s.id === id && s.present);
  const reqIds = (subsystem: SubsystemId, match?: RegExp) =>
    requirements.filter((r) => r.subsystem === subsystem && (!match || match.test(r.behaviour))).map((r) => r.id);

  const grounds = nets.filter((n) => n.klass === "ground").map((n) => n.name);
  const rails = nets.filter((n) => n.klass === "power");

  tests.push({
    name: "Visual and assembly inspection",
    subsystem: "unclassified",
    purpose: "Catch assembly faults before power is applied.",
    access: "Both sides of the assembled board",
    stimulus: "Compare against the approved assembly drawing and BOM",
    expected: "No missing, reversed, bridged or damaged parts",
    instrument: "Operator",
    confidence: "high",
    evidenceClass: "derived",
    standing: "required",
    ruleId: "visual",
    evidence: [],
    satisfies: [],
    covers: parts.filter((p) => !p.excludedReason).map((p) => p.ref),
    nets: [],
    needsContacts: [],
    needsEquipment: ["assembly drawing"],
    needsFirmware: false,
    assumptions: ["An approved assembly drawing exists for this revision."],
    openQuestions: [],
  });

  if (rails.length && grounds.length) {
    tests.push({
      name: "Unpowered rail-to-ground check",
      subsystem: "power",
      purpose: "Find a short before power turns a cheap fault into a scrapped board.",
      access: `${rails.map((r) => r.name).join(", ")} against ${grounds[0]}`,
      stimulus: "Measure resistance with the board unpowered",
      expected: "No rail near zero ohms. The pass threshold has to come from measurements on known-good units.",
      instrument: "DMM",
      confidence: "review",
      evidenceClass: "derived",
      standing: "required",
      ruleId: "shorts",
      evidence: rails[0]?.evidence.slice(0, 1) ?? [],
      satisfies: reqIds("power", /shorted/),
      covers: parts.filter((p) => p.klass === "regulator").map((p) => p.ref),
      nets: [...rails.map((r) => r.name), grounds[0]],
      needsContacts: [...rails.map((r) => r.name), grounds[0]],
      needsEquipment: ["DMM"],
      needsFirmware: false,
      assumptions: [],
      openQuestions: ["What resistance floor counts as a pass? Needs known-good measurements."],
    });
  }

  for (const rail of rails) {
    const limit = limits.find((l) => l.net === rail.name && l.min !== undefined && l.max !== undefined);
    tests.push({
      name: `${rail.name} rail check`,
      subsystem: "power",
      purpose: `Confirm ${rail.name} comes up and sits where it should.`,
      access: rail.name,
      stimulus: "Power the unit through its normal input",
      expected: limit
        ? `${limit.min} to ${limit.max} ${limit.unit}`
        : `No pass band supplied for ${rail.name}. Derive it from the regulator tolerance or measure known-good units.`,
      instrument: "DMM",
      confidence: limit ? "high" : "review",
      evidenceClass: limit ? "documented" : "unresolved",
      standing: limit ? "required" : "proposed",
      ruleId: `rail:${rail.name}`,
      evidence: rail.evidence.slice(0, 1),
      satisfies: reqIds("power", new RegExp(rail.name.replace(/[+*]/g, "\\$&"))),
      covers: parts.filter((p) => p.klass === "regulator").map((p) => p.ref),
      nets: [rail.name],
      needsContacts: [rail.name, grounds[0] ?? ""].filter(Boolean),
      needsEquipment: ["DMM", "power source"],
      needsFirmware: false,
      assumptions: [],
      openQuestions: limit ? [] : [`What is the allowed range for ${rail.name}?`],
    });
  }

  const module = parts.find((p) => p.klass === "module" || p.klass === "mcu");
  if (module) {
    tests.push({
      name: "Power up, flash and boot",
      subsystem: "mcu",
      purpose: "Prove the controller runs and takes production firmware.",
      access: `${module.ref} USB or programming interface`,
      stimulus: "Flash the production image and read back the reported firmware revision",
      expected: "Flash succeeds and the unit reports the expected firmware revision",
      instrument: "Host PC",
      confidence: "high",
      evidenceClass: "derived",
      standing: "required",
      ruleId: "flash",
      evidence: module.evidence.slice(0, 1),
      satisfies: reqIds("mcu"),
      covers: [module.ref],
      nets: [],
      needsContacts: [],
      needsEquipment: ["host PC", `${module.ref} USB connector`],
      needsFirmware: true,
      assumptions: ["Programming is done through the module's own connector, not board-level test points."],
      openQuestions: [],
    });
  }

  if (addresses.length) {
    tests.push({
      name: "I²C device discovery",
      subsystem: "i2c",
      purpose: "Confirm every expected device is populated and answering.",
      access: "Through firmware over the shared bus",
      stimulus: "Scan the bus",
      expected: `Devices respond at ${addresses.map((a) => `0x${a.address.toString(16)} (${a.ref})`).join(" and ")}`,
      instrument: "Manufacturing firmware",
      confidence: "high",
      evidenceClass: "derived",
      standing: "required",
      ruleId: "i2c-scan",
      evidence: [],
      satisfies: reqIds("i2c"),
      covers: addresses.map((a) => a.ref),
      nets: [],
      needsContacts: [],
      needsEquipment: [],
      needsFirmware: true,
      assumptions: [`Addresses derived from strapping: ${addresses.map((a) => a.workings).join("; ")}`],
      openQuestions: [],
    });
  }

  const keys = parts.filter((p) => p.klass === "key");
  if (keys.length) {
    tests.push({
      name: `Actuate all ${keys.length} keys and controls`,
      subsystem: "keys",
      purpose: "Every input has to register, and register as the right input.",
      access: "Operator presses each key while firmware reports the event",
      stimulus: `Actuate ${keys.map((k) => k.ref).join(", ")} one at a time`,
      expected: "Each actuation reports exactly one event, matching the expected input",
      instrument: "Manufacturing firmware with an operator prompt",
      confidence: "review",
      evidenceClass: "derived",
      standing: "required",
      ruleId: "keys",
      evidence: keys[0]?.evidence.slice(0, 1) ?? [],
      satisfies: reqIds("keys", /register/),
      covers: keys.map((k) => k.ref),
      nets: [],
      needsContacts: [],
      needsEquipment: [],
      needsFirmware: true,
      assumptions: [],
      openQuestions: ["What note or action does each key map to? The mapping is not in the design files."],
    });
    tests.push({
      name: "Stuck and shorted input check",
      subsystem: "keys",
      purpose: "A per-key test passes even when a row or column is shorted.",
      access: "Through firmware",
      stimulus: "Read all inputs with nothing pressed, then with one pressed",
      expected: "No input reads active at rest, and pressing one activates only that input",
      instrument: "Manufacturing firmware",
      confidence: "review",
      evidenceClass: "derived",
      standing: "required",
      ruleId: "keys-faults",
      evidence: [],
      satisfies: reqIds("keys", /stuck|shorted/),
      covers: keys.map((k) => k.ref),
      nets: [],
      needsContacts: [],
      needsEquipment: [],
      needsFirmware: true,
      assumptions: [],
      openQuestions: [],
    });
  }

  for (const sw of parts.filter((p) => p.klass === "switch")) {
    tests.push({
      name: `${sw.ref} function check`,
      subsystem: "keys",
      purpose: `Confirm ${sw.ref} does what it is there to do.`,
      access: "Operator actuates the switch",
      stimulus: "Move the switch through its positions",
      expected: "The behaviour the switch controls changes accordingly",
      instrument: "Operator",
      confidence: "review",
      evidenceClass: "derived",
      standing: "proposed",
      ruleId: `switch:${sw.ref}`,
      evidence: sw.evidence.slice(0, 1),
      satisfies: reqIds("keys", new RegExp(`^${sw.ref}\\b`)),
      covers: [sw.ref],
      nets: [],
      needsContacts: [],
      needsEquipment: [],
      needsFirmware: false,
      assumptions: [],
      openQuestions: [`What is ${sw.ref} supposed to do? Confirm with the customer.`],
    });
  }

  if (on("audio")) {
    const amps = parts.filter((p) => p.klass === "amplifier");
    const speakers = parts.filter((p) => p.klass === "speaker");
    const jacks = parts.filter((p) => p.subsystem === "audio" && p.klass === "connector");
    tests.push({
      name: "Audio output and amplifier check",
      subsystem: "audio",
      purpose: "Verify the amplifier drives both channels.",
      access: "Speaker pads and audio output jack",
      stimulus: "Play a known tone from firmware",
      expected: "Both channels produce the tone. Level limits need known-good measurements.",
      instrument: "Audio capture or an operator listening",
      confidence: "specialist",
      evidenceClass: "derived",
      standing: "required",
      ruleId: "audio-out",
      evidence: amps[0]?.evidence.slice(0, 1) ?? [],
      satisfies: reqIds("audio", /output/),
      covers: [...amps, ...speakers, ...jacks].map((p) => p.ref),
      nets: [],
      needsContacts: [],
      needsEquipment: ["audio capture or operator"],
      needsFirmware: true,
      assumptions: [],
      openQuestions: ["What output level and distortion counts as a pass?"],
    });
    tests.push({
      name: "Audio input check",
      subsystem: "audio",
      purpose: "Verify the input path.",
      access: "Audio input jack",
      stimulus: "Inject a known signal",
      expected: "Firmware reports the signal within an agreed window",
      instrument: "Signal source",
      confidence: "specialist",
      evidenceClass: "derived",
      standing: "proposed",
      ruleId: "audio-in",
      evidence: [],
      satisfies: reqIds("audio", /input/),
      covers: jacks.map((p) => p.ref),
      nets: [],
      needsContacts: [],
      needsEquipment: ["signal source"],
      needsFirmware: true,
      assumptions: [],
      openQuestions: ["Is audio input a shipping requirement?"],
    });
  }

  const leds = parts.filter((p) => p.klass === "led");
  if (leds.length) {
    tests.push({
      name: "Indicator check",
      subsystem: "led",
      purpose: "Verify each indicator is fitted the right way round and can be driven.",
      access: "Visual, or a fixture photodiode",
      stimulus: "Drive each indicator on then off",
      expected: "Each indicator changes state visibly",
      instrument: "Operator",
      confidence: "review",
      evidenceClass: "derived",
      standing: "required",
      ruleId: "leds",
      evidence: leds[0]?.evidence.slice(0, 1) ?? [],
      satisfies: reqIds("led"),
      covers: leds.map((l) => l.ref),
      nets: [],
      needsContacts: [],
      needsEquipment: [],
      needsFirmware: true,
      assumptions: [],
      openQuestions: [],
    });
  }

  if (on("charging")) {
    tests.push({
      name: "Battery operation and charging",
      subsystem: "charging",
      purpose: "Confirm the unit runs on battery and charges.",
      access: "Battery connector and external power input",
      stimulus: "Run on battery, then apply external power",
      expected: "Runs on battery; charging behaviour matches the product specification",
      instrument: "DMM and bench supply",
      confidence: "review",
      evidenceClass: "unresolved",
      standing: "proposed",
      ruleId: "battery",
      evidence: [],
      satisfies: reqIds("charging"),
      covers: parts.filter((p) => p.subsystem === "charging").map((p) => p.ref),
      nets: [],
      needsContacts: [],
      needsEquipment: ["DMM", "bench supply"],
      needsFirmware: false,
      assumptions: [],
      openQuestions: ["What is the expected charge current and end-of-charge behaviour?"],
    });
  }

  const midi = subsystems.find((s) => s.id === "midi");
  tests.push({
    name: "MIDI send and receive",
    subsystem: "midi",
    purpose: "Confirm the product's MIDI behaviour.",
    access: midi?.present ? "MIDI connectors" : "Transport not identified",
    stimulus: "Send a known message and read it back",
    expected: "Messages match",
    instrument: "MIDI host",
    confidence: "review",
    evidenceClass: midi?.present ? "derived" : "unresolved",
    standing: midi?.present ? "required" : "proposed",
    ruleId: "midi",
    evidence: [],
    satisfies: reqIds("midi"),
    covers: parts.filter((p) => p.subsystem === "midi").map((p) => p.ref),
    nets: [],
    needsContacts: [],
    needsEquipment: ["MIDI host"],
    needsFirmware: true,
    assumptions: [],
    openQuestions: midi?.present ? [] : ["Does MIDI ship over USB, BLE or a DIN connector?"],
  });

  tests.push({
    name: "Record the result",
    subsystem: "unclassified",
    purpose: "A test that isn't recorded didn't happen.",
    access: "Station database or log file",
    stimulus: "Write firmware revision, results, failures and operator notes",
    expected: "A complete record exists for the unit",
    instrument: "Station software",
    confidence: "high",
    evidenceClass: "derived",
    standing: "required",
    ruleId: "record",
    evidence: [],
    satisfies: [],
    covers: [],
    nets: [],
    needsContacts: [],
    needsEquipment: ["station software"],
    needsFirmware: false,
    assumptions: [],
    openQuestions: [
      "Are serial numbers, calibration or locking part of the process? Nothing in the supplied files says so, so none of it is proposed as required.",
    ],
  });

  return tests;
}

// ---------------------------------------------------------------- fixture --

function buildFixture(tests: TestDraft[], pcb: PcbResult | null, pcbFile: string, pcbText: string): FixtureContact[] {
  const wanted = new Set<string>();
  for (const t of tests) for (const c of t.needsContacts) wanted.add(c);

  const contacts: FixtureContact[] = [];
  let pin = 1;
  for (const net of wanted) {
    let access: PhysicalAccess;
    if (!pcb) {
      access = {
        net,
        kind: "none",
        confidence: "no-pcb-supplied",
        reason: "No PCB file was supplied, so physical access cannot be confirmed from a schematic net alone.",
        evidence: [],
      };
    } else {
      const hit = bestAccessForNet(pcb.access, net);
      access = hit
        ? {
            net,
            kind: hit.kind,
            ref: hit.ref || undefined,
            pad: hit.pad || undefined,
            side: hit.side,
            x: hit.x,
            y: hit.y,
            sizeMm: `${hit.width} x ${hit.height}`,
            confidence: "pcb-confirmed",
            reason: hit.reason,
            evidence: pcbText ? [evidence(pcbFile, toLines(pcbText), hit.line)] : [],
          }
        : {
            net,
            kind: "none",
            confidence: "not-found",
            reason: `No exposed pad or untented via carries ${net}. A probe cannot reach it as the board stands.`,
            evidence: [],
          };
    }
    contacts.push({ id: pin++, net, purpose: "Measure or source", access });
  }
  return contacts;
}

/** A test is only feasible if the fixture can actually reach what it needs. */
function checkFeasibility(test: TestDraft, fixture: FixtureContact[]): { feasible: boolean; note: string } {
  const missing: string[] = [];
  for (const net of test.needsContacts) {
    const contact = fixture.find((c) => c.net === net);
    if (!contact || contact.access.confidence !== "pcb-confirmed") {
      missing.push(net);
    }
  }
  if (!missing.length) {
    return {
      feasible: true,
      note: test.needsContacts.length
        ? "Every net this step touches has a confirmed probe target."
        : "Runs through the product's own interfaces; no fixture contact needed.",
    };
  }
  return {
    feasible: false,
    note: `Cannot run as specified: no confirmed probe target for ${missing.join(", ")}.`,
  };
}

// --------------------------------------------------------------- coverage --

function buildCoverage(requirements: Requirement[], tests: TestStep[], parts: Part[]): Coverage {
  const rows: CoverageRow[] = requirements.map((r) => {
    const byTests = tests.filter((t) => t.review !== "rejected" && t.satisfies.includes(r.id)).map((t) => t.id);
    return {
      requirementId: r.id,
      subsystem: r.subsystem,
      behaviour: r.behaviour,
      covered: byTests.length > 0,
      byTests,
      why: r.rationale,
      evidenceClass: r.evidenceClass,
    };
  });

  const covered = rows.filter((r) => r.covered).length;
  return {
    rows,
    covered,
    total: rows.length,
    percent: rows.length ? Math.round((covered / rows.length) * 100) : 0,
    basis:
      "Denominator is the list of required behaviours below, not a part count. Each row states where the requirement came from. Mechanical items, logos and passives are not behaviours and are excluded.",
    excluded: parts
      .filter((p) => p.excludedReason)
      .map((p) => ({ ref: p.ref, reason: p.excludedReason! })),
  };
}

// ------------------------------------------------------------------ risks --

function buildRisks(
  draftTests: TestStep[],
  requirements: Requirement[],
  fixture: FixtureContact[],
  provenance: Provenance,
  pcb: PcbResult | null,
): Risk[] {
  const risks: Risk[] = [];

  if (provenance.revisionConflict) {
    risks.push({
      id: "revision-conflict",
      level: "critical",
      title: "Design revision is ambiguous",
      detail: provenance.revisionConflict,
      action: "Confirm the build revision before this plan is used to test anything.",
      evidence: [],
    });
  }

  if (!pcb) {
    risks.push({
      id: "no-pcb",
      level: "high",
      title: "No PCB supplied, so physical access is unknown",
      detail:
        "Electrical connectivity came from the schematic, but whether a probe can reach any given net depends on pads, vias and mask openings in the layout.",
      action: "Supply the .kicad_pcb so access can be confirmed rather than assumed.",
      evidence: [],
    });
  }

  const unreachable = fixture.filter((c) => c.access.confidence === "not-found");
  if (unreachable.length) {
    risks.push({
      id: "unreachable-nets",
      level: "high",
      title: `${unreachable.length} required net${unreachable.length === 1 ? " has" : "s have"} no probe target`,
      detail: `${unreachable.map((c) => c.net).join(", ")}. The layout has no exposed pad or untented via on ${unreachable.length === 1 ? "it" : "them"}.`,
      action: "Add test pads on the next revision, or accept manual probing and the cycle time that costs.",
      evidence: [],
    });
  }

  const infeasible = draftTests.filter((t) => !t.feasible);
  if (infeasible.length) {
    risks.push({
      id: "infeasible-tests",
      level: "critical",
      title: `${infeasible.length} step${infeasible.length === 1 ? "" : "s"} cannot run on the proposed fixture`,
      detail: infeasible.map((t) => `${t.id} ${t.name}`).join("; "),
      action: "Either add the missing contacts to the fixture or drop the step.",
      evidence: [],
    });
  }

  const unresolved = requirements.filter((r) => r.evidenceClass === "unresolved");
  if (unresolved.length) {
    risks.push({
      id: "unresolved-requirements",
      level: "high",
      title: `${unresolved.length} behaviour${unresolved.length === 1 ? "" : "s"} need${unresolved.length === 1 ? "s" : ""} customer confirmation`,
      detail: unresolved.map((r) => r.behaviour).join("; "),
      action: "Get these confirmed before treating the plan as complete.",
      evidence: [],
    });
  }

  risks.push({
    id: "golden-unit",
    level: "medium",
    title: "Nothing here is validated against real boards",
    detail: "Every threshold and sequence is unproven until it passes a known-good unit and fails a known-bad one.",
    action: "Run a golden unit, then inject representative faults and confirm the sequence catches them.",
    evidence: [],
  });

  return risks;
}

// ------------------------------------------------------------------ build --

export function buildDraft({ projectNameHint, files, requirementsText }: BuildInput): Draft {
  const sourceNotes: { file: string; messages: string[] }[] = [];

  const schFile = files.find((f) => f.kind === "kicad-sch");
  const pcbFile = files.find((f) => f.kind === "kicad-pcb");

  let conn: ConnectivityResult | null = null;
  if (schFile) {
    conn = resolveConnectivity(schFile.text);
    sourceNotes.push({ file: schFile.name, messages: conn.notes });
  }

  let pcb: PcbResult | null = null;
  if (pcbFile) {
    pcb = parseKicadPcb(pcbFile.text);
    sourceNotes.push({ file: pcbFile.name, messages: pcb.notes });
  }

  for (const f of files) {
    if (f.kind === "ignored") {
      sourceNotes.push({ file: f.name, messages: ["Local KiCad UI state; ignored on purpose."] });
    }
  }

  const provenance = buildProvenance(files, conn, projectNameHint);

  const connectivity: ConnectivityReport = {
    resolved: Boolean(conn && !conn.blocked),
    pinsTotal: conn?.stats.pinsTotal ?? 0,
    pinsOnNet: conn?.stats.pinsOnNet ?? 0,
    wires: conn?.stats.wires ?? 0,
    junctions: conn?.stats.junctions ?? 0,
    namedNets: conn?.stats.namedNets ?? 0,
    noConnects: conn?.stats.noConnects ?? 0,
    blockedReason: conn?.blocked,
  };

  const empty = (blocked: string): Draft => ({
    id: crypto.randomUUID(),
    provenance,
    connectivity,
    blocked,
    parts: [],
    nets: [],
    limits: [],
    requirements: [],
    subsystems: [],
    tests: [],
    fixture: [],
    risks: [],
    coverage: { rows: [], covered: 0, total: 0, percent: 0, basis: "", excluded: [] },
    openQuestions: [],
    assumptions: [],
    requirementsText,
    sourceNotes,
  });

  if (!schFile) {
    return empty("No KiCad schematic supplied. A schematic is required before any analysis can run.");
  }
  if (!conn || conn.blocked) {
    return empty(
      conn?.blocked ??
        "Connectivity could not be reconstructed from the schematic, so no dependent analysis was attempted.",
    );
  }

  const schLines = toLines(schFile.text);
  const ev = (line: number): Evidence[] => [evidence(schFile.name, schLines, line)];

  // -- parts and nets ------------------------------------------------------
  const parts: Part[] = conn.parts.map((p) => {
    const klass = classifyPart(p.ref, p.value, p.libId, p.footprint);
    return {
      ref: p.ref,
      value: p.value,
      footprint: p.footprint || undefined,
      description: p.libId,
      klass,
      subsystem: subsystemOf(klass, p.value, p.libId),
      excludedReason: excludedReason(klass, p.pins.length),
      pins: p.pins.map((pin) => ({ ref: p.ref, pin: pin.number, pinName: pin.name, pinType: pin.type })),
      evidence: ev(p.line),
    };
  });

  const nets: Net[] = conn.nets.map((n) => ({
    name: n.name,
    klass: classifyNet(n.name),
    named: n.named,
    nodes: n.nodes,
    nominalV: railVoltage(n.name),
    evidence: ev(n.line),
  }));

  // -- limits from the customer's own words -------------------------------
  const limits: Limit[] = requirementsText.trim()
    ? parseRequirements("requirements", requirementsText, nets)
    : [];

  const addresses = deriveI2cAddresses(parts, nets);
  const subsystems = detectSubsystems(parts, nets);
  const requirements = buildRequirements(subsystems, parts, nets, addresses, limits);
  const drafts = buildTests(subsystems, parts, nets, requirements, addresses, limits);
  const fixture = buildFixture(drafts, pcb, pcbFile?.name ?? "", pcbFile?.text ?? "");

  const tests: TestStep[] = drafts.map((d, i) => {
    const { feasible, note } = checkFeasibility(d, fixture);
    return { ...d, id: `T${String(i + 1).padStart(2, "0")}`, review: "unreviewed", feasible, feasibilityNote: note };
  });

  const coverage = buildCoverage(requirements, tests, parts);
  const risks = buildRisks(tests, requirements, fixture, provenance, pcb);

  const openQuestions = [
    ...new Set([
      ...tests.flatMap((t) => t.openQuestions),
      ...requirements.filter((r) => r.evidenceClass === "unresolved").map((r) => `Confirm: ${r.behaviour}`),
    ]),
  ];

  return {
    id: crypto.randomUUID(),
    provenance,
    connectivity,
    parts,
    nets,
    limits,
    requirements,
    subsystems,
    tests,
    fixture,
    risks,
    coverage,
    openQuestions,
    assumptions: [
      "This is a planning draft, not a release, a safety case or a certification.",
      "Only the supplied files were used. Nothing was carried over from any other project.",
      "No pass/fail number appears here unless it was stated in the inputs or derived from them with the reasoning shown.",
      "No readiness score or cycle-time estimate is given, because neither can be computed from these inputs.",
      "A qualified engineer owns the final limits and the decision to ship.",
    ],
    requirementsText,
    sourceNotes,
  };
}

export function recomputeCoverage(draft: Draft): Coverage {
  return buildCoverage(draft.requirements, draft.tests, draft.parts);
}

export { NET_CLASS_LABEL, SUBSYSTEM_LABEL };
