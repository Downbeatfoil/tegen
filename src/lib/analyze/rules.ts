/**
 * Test-generation rules.
 *
 * Each rule looks at the merged design and either produces steps or stays
 * quiet. Two things every rule must do:
 *
 *  1. Attach the evidence it relied on, so the reviewer can jump to the line.
 *  2. Report `basis: "detected"` only when pin-level connectivity backs the
 *     claim. If the rule is pattern-matching a net name or guessing which part
 *     sits on a bus, that's `inferred`, and the UI says so.
 */

import type { Basis, Confidence, Evidence, Limit, Net, NetClass, Part, PartClass } from "../types";
import { NET_CLASS_LABEL } from "../classify";

export interface GeneratedStep {
  ruleId: string;
  name: string;
  purpose: string;
  access: string;
  stimulus: string;
  expected: string;
  instrument: string;
  confidence: Confidence;
  basis: Basis;
  evidence: Evidence[];
  covers: string[];
  nets: string[];
  estSeconds: number;
}

export class DesignContext {
  readonly parts: Part[];
  readonly nets: Net[];
  readonly limits: Limit[];
  /** True when at least one net carries pin-level nodes. */
  readonly hasConnectivity: boolean;

  private readonly partByRef = new Map<string, Part>();

  constructor(parts: Part[], nets: Net[], limits: Limit[]) {
    this.parts = parts;
    this.nets = nets;
    this.limits = limits;
    this.hasConnectivity = nets.some((n) => n.nodes.length > 0);
    for (const part of parts) this.partByRef.set(part.ref.toUpperCase(), part);
  }

  netsOfClass(...classes: NetClass[]): Net[] {
    return this.nets.filter((n) => classes.includes(n.klass));
  }

  partsOfClass(...classes: PartClass[]): Part[] {
    return this.parts.filter((p) => classes.includes(p.klass));
  }

  /** Parts electrically on a net. Empty when we only have net names. */
  partsOn(net: Net): Part[] {
    const out: Part[] = [];
    for (const node of net.nodes) {
      const part = this.partByRef.get(node.ref.toUpperCase());
      if (part && !out.includes(part)) out.push(part);
    }
    return out;
  }

  /**
   * Which parts a bus touches. Falls back to "every part of these classes"
   * when connectivity is missing — the caller downgrades basis accordingly.
   */
  partsOnBus(nets: Net[], fallbackClasses: PartClass[]): { refs: string[]; basis: Basis } {
    const connected = new Set<string>();
    for (const net of nets) {
      for (const part of this.partsOn(net)) {
        if (part.klass !== "passive" && part.klass !== "testpoint") connected.add(part.ref);
      }
    }
    if (connected.size) return { refs: [...connected], basis: "detected" };
    return {
      refs: this.partsOfClass(...fallbackClasses).map((p) => p.ref),
      basis: "inferred",
    };
  }

  /** Prefers a limit with an actual pass band over a bare nominal value. */
  limitFor(netName: string | undefined): Limit | undefined {
    if (!netName) return undefined;
    const matches = this.limits.filter((l) => l.net && l.net.toUpperCase() === netName.toUpperCase());
    return matches.find((l) => l.min !== undefined && l.max !== undefined) ?? matches[0];
  }

  /** Nets that a TP-prefixed part lands on. */
  probedNets(): Set<string> {
    const out = new Set<string>();
    for (const net of this.nets) {
      if (net.nodes.some((n) => /^TP/i.test(n.ref))) out.add(net.name.toUpperCase());
    }
    return out;
  }

  testPointCount(): number {
    return this.parts.filter((p) => p.klass === "testpoint").length;
  }

  evidenceOf(...items: { evidence: Evidence[] }[]): Evidence[] {
    const seen = new Set<string>();
    const out: Evidence[] = [];
    for (const item of items) {
      for (const ev of item.evidence) {
        const key = `${ev.file}:${ev.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ev);
      }
    }
    return out.slice(0, 6);
  }
}

/** Renders a limit as a pass criterion, or says plainly that there isn't one. */
export function describeLimit(limit: Limit | undefined, fallback: string): string {
  if (!limit) return fallback;
  if (limit.min !== undefined && limit.max !== undefined) {
    return `${limit.min}–${limit.max} ${limit.unit}`;
  }
  if (limit.max !== undefined) return `≤ ${limit.max} ${limit.unit}`;
  if (limit.min !== undefined) return `≥ ${limit.min} ${limit.unit}`;
  if (limit.note) return limit.note;
  if (limit.nominal !== undefined) return `${limit.nominal} ${limit.unit}, tolerance not stated`;
  return fallback;
}

const accessFor = (ctx: DesignContext, net: Net): string => {
  const probed = ctx.probedNets().has(net.name.toUpperCase());
  if (probed) return `${net.name} via test point`;
  if (ctx.hasConnectivity) return `${net.name} (no test point on this net, needs a probe target)`;
  return net.name;
};

type Rule = (ctx: DesignContext) => GeneratedStep[];

const visualInspection: Rule = (ctx) => {
  const connectors = ctx.partsOfClass("connector");
  return [
    {
      ruleId: "visual-inspection",
      name: "Visual and orientation check",
      purpose: "Catch assembly faults before any power is applied.",
      access: "Top and bottom of the assembled board",
      stimulus: "Compare against the approved assembly image",
      expected: "No missing, reversed, tombstoned, bridged or damaged parts",
      instrument: "Operator, or AOI if the line has it",
      confidence: "high",
      basis: "inferred",
      evidence: [],
      covers: connectors.map((c) => c.ref),
      nets: [],
      estSeconds: 12,
    },
  ];
};

const shortsCheck: Rule = (ctx) => {
  const grounds = ctx.netsOfClass("ground");
  const rails = ctx.netsOfClass("power");
  if (!rails.length) return [];

  const ground = grounds[0];
  const regulators = ctx.partsOfClass("regulator");

  return [
    {
      ruleId: "shorts-check",
      name: "Unpowered rail-to-ground resistance",
      purpose: "Find a shorted rail before power turns a cheap fault into a scrapped board.",
      access: ground
        ? `${rails.map((r) => r.name).join(", ")} against ${ground.name}`
        : "Rails against ground, but no ground net was found in the design files",
      stimulus: "Measure resistance with the board unpowered",
      expected: "Above the engineering-approved floor, with no rail near zero ohms",
      instrument: "DMM or fixture-side continuity channel",
      confidence: ground ? "review" : "specialist",
      basis: ground ? "detected" : "unresolved",
      evidence: ctx.evidenceOf(...rails.slice(0, 3), ...(ground ? [ground] : [])),
      covers: regulators.map((r) => r.ref),
      nets: [...rails.map((r) => r.name), ...(ground ? [ground.name] : [])],
      estSeconds: 15,
    },
  ];
};

const powerRails: Rule = (ctx) => {
  const rails = ctx.netsOfClass("power");
  if (!rails.length) return [];

  // Highest voltage first — that's normally the board input.
  const ordered = [...rails].sort((a, b) => (b.nominalV ?? 0) - (a.nominalV ?? 0));

  return ordered.map((net, index) => {
    const limit = ctx.limitFor(net.name);
    const onNet = ctx.partsOn(net).filter((p) => p.klass !== "passive");
    const regulators = onNet.filter((p) => p.klass === "regulator");
    const covers = (regulators.length ? regulators : onNet).map((p) => p.ref);

    return {
      ruleId: `power-rail:${net.name}`,
      name: `${net.name} rail check`,
      purpose:
        index === 0
          ? `Confirm the board powers up and ${net.name} regulates within limits.`
          : `Confirm ${net.name} comes up downstream of the input rail.`,
      access: accessFor(ctx, net),
      stimulus:
        index === 0
          ? "Apply rated input through a current-limited supply"
          : "Measure once the input rail is stable",
      expected: describeLimit(
        limit,
        net.nominalV !== undefined
          ? `Near ${net.nominalV} V, no tolerance found in the requirements`
          : "No limit stated for this rail",
      ),
      instrument: "Programmable PSU and DMM",
      // A stated nominal with no tolerance isn't a pass band, so it doesn't
      // earn high confidence however clearly the requirement stated it.
      confidence:
        limit?.basis === "detected" && limit.min !== undefined && limit.max !== undefined
          ? "high"
          : "review",
      basis: limit?.basis === "detected" ? "detected" : limit ? "inferred" : "unresolved",
      evidence: ctx.evidenceOf(net, ...(limit ? [limit] : [])),
      covers,
      nets: [net.name],
      estSeconds: 8,
    };
  });
};

const programController: Rule = (ctx) => {
  const debug = ctx.netsOfClass("swd", "jtag");
  const mcus = ctx.partsOfClass("mcu");
  if (!debug.length || !mcus.length) return [];

  const isSwd = debug.some((n) => n.klass === "swd");
  const programmingConnectors = ctx.partsOfClass("connector").filter((c) => {
    const text = `${c.value} ${c.description ?? ""}`;
    return /swd|jtag|debug|program/i.test(text);
  });

  return [
    {
      ruleId: "program-controller",
      name: "Program and identify the controller",
      purpose: "Prove the MCU is powered, reachable, and takes production firmware.",
      access: `${debug.map((n) => n.name).join(" + ")} + ground`,
      stimulus: "Read the device ID, erase, flash the production image, verify the checksum",
      expected: "Expected device ID, and a readback checksum matching the image",
      instrument: isSwd ? "SWD probe on the fixture" : "JTAG probe on the fixture",
      confidence: "high",
      basis: "detected",
      evidence: ctx.evidenceOf(...debug, ...mcus.slice(0, 1)),
      covers: [...mcus.map((m) => m.ref), ...programmingConnectors.map((c) => c.ref)],
      nets: debug.map((n) => n.name),
      estSeconds: 25,
    },
  ];
};

const i2cScan: Rule = (ctx) => {
  const bus = ctx.netsOfClass("i2c");
  if (!bus.length) return [];

  const { refs, basis } = ctx.partsOnBus(bus, ["sensor", "memory"]);
  const idLimit = ctx.limits.find((l) => l.unit === "id");

  return [
    {
      ruleId: "i2c-scan",
      name: "I²C bus scan",
      purpose: "Verify bus continuity, pull-ups, and that every expected device is populated.",
      access: `${bus.map((n) => n.name).join(" + ")} + ground`,
      stimulus: "Sweep the address range at the production bus speed",
      expected: idLimit?.note
        ? `${idLimit.note}${refs.length > 1 ? ", plus the other expected addresses" : ""}`
        : refs.length
          ? `All ${refs.length} expected device${refs.length === 1 ? "" : "s"} acknowledge`
          : "Expected address list acknowledges, though the addresses were not stated in the requirements",
      instrument: "Test controller running the manufacturing firmware",
      confidence: idLimit ? "high" : "review",
      basis: idLimit ? basis : basis === "detected" ? "detected" : "inferred",
      evidence: ctx.evidenceOf(...bus, ...(idLimit ? [idLimit] : [])),
      covers: refs,
      nets: bus.map((n) => n.name),
      estSeconds: 6,
    },
  ];
};

const spiCheck: Rule = (ctx) => {
  const bus = ctx.netsOfClass("spi");
  if (!bus.length) return [];
  const { refs, basis } = ctx.partsOnBus(bus, ["memory", "sensor"]);

  return [
    {
      ruleId: "spi-check",
      name: "SPI device identity read",
      purpose: "Verify the controller can clock a transaction and the peripheral answers.",
      access: `${bus.map((n) => n.name).join(" + ")} + chip select`,
      stimulus: "Read a fixed identity or manufacturer register",
      expected: "Known non-zero identity value for each device on the bus",
      instrument: "Manufacturing firmware",
      confidence: "review",
      basis,
      evidence: ctx.evidenceOf(...bus),
      covers: refs,
      nets: bus.map((n) => n.name),
      estSeconds: 5,
    },
  ];
};

const uartCheck: Rule = (ctx) => {
  const bus = ctx.netsOfClass("uart");
  if (!bus.length) return [];
  const { refs } = ctx.partsOnBus(bus, ["transceiver"]);

  return [
    {
      ruleId: "uart-check",
      name: "UART loopback",
      purpose: "Verify the transmit and receive paths independently of higher-level protocol.",
      access: `${bus.map((n) => n.name).join(" + ")} + ground`,
      stimulus: "Send a deterministic 256-byte pattern and read it back",
      expected: "Exact echo, zero framing or parity errors",
      instrument: "USB-UART bridge on the fixture",
      confidence: "high",
      basis: "detected",
      evidence: ctx.evidenceOf(...bus),
      covers: refs,
      nets: bus.map((n) => n.name),
      estSeconds: 6,
    },
  ];
};

const canCheck: Rule = (ctx) => {
  const bus = ctx.netsOfClass("can");
  if (!bus.length) return [];
  const { refs, basis } = ctx.partsOnBus(bus, ["transceiver"]);

  return [
    {
      ruleId: "can-check",
      name: "CAN transceiver and frame test",
      purpose: "Verify the transceiver, bus termination, and a full frame round trip.",
      access: `${bus.map((n) => n.name).join(" + ")} + ground`,
      stimulus: "Transmit a known frame and require an acknowledgement from the fixture node",
      expected: "Frame acknowledged, no error counters incrementing, differential levels in spec",
      instrument: "CAN interface, plus a scope for the differential check",
      confidence: "specialist",
      basis,
      evidence: ctx.evidenceOf(...bus),
      covers: refs,
      nets: bus.map((n) => n.name),
      estSeconds: 10,
    },
  ];
};

const usbCheck: Rule = (ctx) => {
  const bus = ctx.netsOfClass("usb");
  const usbConnectors = ctx
    .partsOfClass("connector")
    .filter((c) => /usb/i.test(`${c.value} ${c.description ?? ""} ${c.footprint ?? ""}`));
  if (!bus.length && !usbConnectors.length) return [];

  return [
    {
      ruleId: "usb-check",
      name: "USB enumeration",
      purpose: "Verify the connector, data pair routing, and that the device enumerates.",
      access: usbConnectors.length ? `${usbConnectors[0].ref} connector` : "USB data pair",
      stimulus: "Connect the fixture host and wait for enumeration",
      expected: "Device enumerates with the expected VID/PID inside the timeout",
      instrument: "Fixture USB host",
      confidence: "review",
      basis: bus.length ? "detected" : "inferred",
      evidence: ctx.evidenceOf(...bus, ...usbConnectors.slice(0, 1)),
      covers: usbConnectors.map((c) => c.ref),
      nets: bus.map((n) => n.name),
      estSeconds: 12,
    },
  ];
};

const indicatorCheck: Rule = (ctx) => {
  const leds = ctx.partsOfClass("led");
  if (!leds.length) return [];

  return [
    {
      ruleId: "indicator-check",
      name: "Indicator actuation",
      purpose: "Verify each indicator is populated the right way round and the MCU can drive it.",
      access: leds.map((l) => l.ref).join(", "),
      stimulus: "Drive each indicator on for 500 ms, then off",
      expected: "Optical change detected in both commanded states",
      instrument: "Fixture photodiode, or operator confirmation",
      confidence: "review",
      basis: "detected",
      evidence: ctx.evidenceOf(...leds.slice(0, 3)),
      covers: leds.map((l) => l.ref),
      nets: ctx.netsOfClass("gpio").filter((n) => /led/i.test(n.name)).map((n) => n.name),
      estSeconds: 5,
    },
  ];
};

const switchCheck: Rule = (ctx) => {
  const switches = ctx.partsOfClass("switch");
  if (!switches.length) return [];

  return [
    {
      ruleId: "switch-check",
      name: "User input actuation",
      purpose: "Verify switch fitment, contact, and the input's pull state.",
      access: switches.map((s) => s.ref).join(", "),
      stimulus: "Actuate and release each input from the fixture",
      expected: "Clean logical transition both ways, no chatter outside the debounce window",
      instrument: "Fixture actuator and manufacturing firmware",
      confidence: "review",
      basis: "detected",
      evidence: ctx.evidenceOf(...switches.slice(0, 3)),
      covers: switches.map((s) => s.ref),
      nets: [],
      estSeconds: 6,
    },
  ];
};

const sensorPlausibility: Rule = (ctx) => {
  const sensors = ctx.partsOfClass("sensor");
  if (!sensors.length) return [];

  return [
    {
      ruleId: "sensor-plausibility",
      name: "Sensor reading plausibility",
      purpose:
        "A device that answers on the bus can still be dead. Read it and check the value makes sense at room conditions.",
      access: "Through the manufacturing firmware, over the sensor's bus",
      stimulus: "Take three readings, one second apart",
      expected: "Readings inside the ambient window, changing slightly rather than frozen",
      instrument: "Manufacturing firmware",
      confidence: "review",
      basis: "inferred",
      evidence: ctx.evidenceOf(...sensors.slice(0, 3)),
      covers: sensors.map((s) => s.ref),
      nets: [],
      estSeconds: 8,
    },
  ];
};

const clockCheck: Rule = (ctx) => {
  const crystals = ctx.partsOfClass("crystal");
  if (!crystals.length) return [];

  return [
    {
      ruleId: "clock-check",
      name: "Oscillator start-up",
      purpose: "A marginal crystal boots on the bench and fails in the field or over temperature.",
      access: "Firmware-reported clock source, or a scope probe on the oscillator output",
      stimulus: "Read the clock source and measure a firmware-generated reference edge",
      expected: "Running from the external oscillator, frequency inside the part's tolerance",
      instrument: "Manufacturing firmware, or a frequency counter",
      confidence: "specialist",
      basis: "inferred",
      evidence: ctx.evidenceOf(...crystals),
      covers: crystals.map((c) => c.ref),
      nets: ctx.netsOfClass("clock").map((n) => n.name),
      estSeconds: 7,
    },
  ];
};

const analogCheck: Rule = (ctx) => {
  const analog = ctx.netsOfClass("analog");
  if (!analog.length) return [];
  const { refs, basis } = ctx.partsOnBus(analog, ["sensor"]);

  return [
    {
      ruleId: "analog-check",
      name: "Analog channel check",
      purpose: "Verify the analog path and the reference, which digital checks won't touch.",
      access: analog.map((n) => n.name).join(", "),
      stimulus: "Drive a known level from the fixture and read it back through the ADC",
      expected: "Reading within the converter's error budget, which is not stated in the sources",
      instrument: "Fixture DAC or precision divider",
      confidence: "specialist",
      basis: basis === "detected" ? "detected" : "unresolved",
      evidence: ctx.evidenceOf(...analog),
      covers: refs,
      nets: analog.map((n) => n.name),
      estSeconds: 9,
    },
  ];
};

const rfCheck: Rule = (ctx) => {
  const rfNets = ctx.netsOfClass("rf");
  const rfParts = ctx.parts.filter((p) =>
    /antenna|\brf\b|bluetooth|wifi|wi-fi|lora|zigbee|2\.4\s?ghz|nrf5|esp32/i.test(
      `${p.value} ${p.description ?? ""}`,
    ),
  );
  if (!rfNets.length && !rfParts.length) return [];

  return [
    {
      ruleId: "rf-check",
      name: "RF path verification",
      purpose: "Radiated performance cannot be inferred from connectivity checks.",
      access: rfNets.length ? rfNets.map((n) => n.name).join(", ") : "Antenna feed",
      stimulus: "Conducted power and frequency measurement, defined by a test engineer",
      expected: "Not derivable from these files. Needs calibrated limits and a guard band",
      instrument: "Spectrum analyser or a vendor RF test mode",
      confidence: "specialist",
      basis: "unresolved",
      evidence: ctx.evidenceOf(...rfNets, ...rfParts.slice(0, 2)),
      covers: rfParts.map((p) => p.ref),
      nets: rfNets.map((n) => n.name),
      estSeconds: 20,
    },
  ];
};

const finalise: Rule = (ctx) => {
  const memory = ctx.partsOfClass("memory");
  const cycleLimit = ctx.limits.find((l) => l.unit === "s" && l.max !== undefined);

  return [
    {
      ruleId: "finalise",
      name: "Serialise and lock",
      purpose: "Give the unit an identity and leave it in its shipping state.",
      access: "Programming interface",
      stimulus: "Write the serial number and calibration record, then set the production flag",
      expected: "Serial reads back correctly; unit is in shipping configuration",
      instrument: "Manufacturing firmware and the station database",
      confidence: "review",
      basis: "inferred",
      evidence: ctx.evidenceOf(...(cycleLimit ? [cycleLimit] : [])),
      covers: memory.map((m) => m.ref),
      nets: [],
      estSeconds: 10,
    },
  ];
};

/** Ordered so the output reads like a real station flow. */
export const RULES: Rule[] = [
  visualInspection,
  shortsCheck,
  powerRails,
  programController,
  i2cScan,
  spiCheck,
  uartCheck,
  canCheck,
  usbCheck,
  sensorPlausibility,
  analogCheck,
  clockCheck,
  indicatorCheck,
  switchCheck,
  rfCheck,
  finalise,
];

export function runRules(ctx: DesignContext): GeneratedStep[] {
  const steps: GeneratedStep[] = [];
  for (const rule of RULES) {
    try {
      steps.push(...rule(ctx));
    } catch {
      // A broken rule shouldn't take the whole draft down with it.
    }
  }
  return steps;
}

export { NET_CLASS_LABEL };
