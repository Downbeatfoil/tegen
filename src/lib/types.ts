/**
 * Core data model.
 *
 * Two rules the whole app is built around:
 *
 * 1. Nothing appears in the output without saying where it came from. Every
 *    part, net and limit carries the file and line it was read out of.
 * 2. A claim is only as strong as its weakest input. Evidence class is not a
 *    presentation detail; it gates what the tool is allowed to assert. A test
 *    cannot be "required" unless a requirement backs it, and a fixture contact
 *    cannot be claimed reachable without a PCB feature to point at.
 */

export interface Evidence {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Where a statement came from. Ordered weakest-last.
 *
 * `derived` exists because a lot of genuinely solid facts are neither read
 * verbatim nor guessed: an I²C address strapped by A0/A1/A2 tied to GND is
 * arrived at by explicit electrical reasoning over read facts, and collapsing
 * that into "inferred" alongside naming-convention guesswork loses the
 * distinction an engineer needs to review it.
 */
export type EvidenceClass =
  /** Read directly out of the schematic or PCB. */
  | "detected"
  /** Reasoned from detected facts by a stated electrical rule. */
  | "derived"
  /** Taken from product documentation or a stated requirement. */
  | "documented"
  /** Nothing in the inputs answers this. Needs the customer. */
  | "unresolved";

export type Confidence = "high" | "review" | "specialist";

export type SubsystemId =
  | "power"
  | "charging"
  | "mcu"
  | "i2c"
  | "keys"
  | "midi"
  | "audio"
  | "led"
  | "touch"
  | "usb"
  | "ble"
  | "unclassified";

export interface Subsystem {
  id: SubsystemId;
  label: string;
  present: boolean;
  parts: string[];
  nets: string[];
  detail: string;
  evidenceClass: EvidenceClass;
  evidence: Evidence[];
}

export type NetClass =
  | "power"
  | "ground"
  | "i2c"
  | "spi"
  | "uart"
  | "swd"
  | "jtag"
  | "can"
  | "usb"
  | "analog"
  | "audio"
  | "clock"
  | "reset"
  | "gpio"
  | "rf"
  | "unknown";

export type PartClass =
  | "mcu"
  | "module"
  | "sensor"
  | "regulator"
  | "connector"
  | "led"
  | "switch"
  | "key"
  | "transceiver"
  | "expander"
  | "amplifier"
  | "speaker"
  | "battery"
  | "crystal"
  | "memory"
  | "passive"
  | "testpoint"
  | "mechanical"
  | "unknown";

export interface NetNode {
  ref: string;
  pin: string;
  pinName?: string;
  pinType?: string;
}

export interface Net {
  name: string;
  klass: NetClass;
  /** True when a label or power symbol named it rather than us generating one. */
  named: boolean;
  nodes: NetNode[];
  nominalV?: number;
  evidence: Evidence[];
}

export interface Part {
  ref: string;
  value: string;
  description?: string;
  footprint?: string;
  klass: PartClass;
  subsystem: SubsystemId;
  /** Set when the part is not a functional-test target. */
  excludedReason?: string;
  pins: NetNode[];
  evidence: Evidence[];
}

/** A pass/fail threshold. Never invented; see `evidenceClass`. */
export interface Limit {
  parameter: string;
  net?: string;
  min?: number;
  max?: number;
  nominal?: number;
  unit: string;
  evidenceClass: EvidenceClass;
  evidence: Evidence[];
  note?: string;
  /** Set when the value is a starting point for characterisation, not a limit. */
  proposedForCharacterisation?: boolean;
}

/** A behaviour the product has to exhibit. Drives coverage. */
export interface Requirement {
  id: string;
  subsystem: SubsystemId;
  behaviour: string;
  evidenceClass: EvidenceClass;
  /** Why we believe this is a shipping behaviour. */
  rationale: string;
  evidence: Evidence[];
}

export interface PhysicalAccess {
  net: string;
  kind: "pad" | "via" | "connector" | "none";
  ref?: string;
  pad?: string;
  side?: string;
  x?: number;
  y?: number;
  sizeMm?: string;
  /** pcb-confirmed | no-pcb-supplied | not-found */
  confidence: "pcb-confirmed" | "no-pcb-supplied" | "not-found";
  reason: string;
  evidence: Evidence[];
}

export interface FixtureContact {
  id: number;
  net: string;
  purpose: string;
  access: PhysicalAccess;
}

export type ReviewStatus = "unreviewed" | "accepted" | "flagged" | "rejected";

export interface TestStep {
  id: string;
  name: string;
  subsystem: SubsystemId;
  purpose: string;
  access: string;
  stimulus: string;
  expected: string;
  instrument: string;
  confidence: Confidence;
  evidenceClass: EvidenceClass;
  /** "required" only when a requirement backs it; otherwise a suggestion. */
  standing: "required" | "proposed" | "optional";
  ruleId: string;
  evidence: Evidence[];
  /** Requirement ids this step demonstrates. */
  satisfies: string[];
  covers: string[];
  nets: string[];
  /** Nets the fixture must physically reach for this step to run. */
  needsContacts: string[];
  needsEquipment: string[];
  needsFirmware: boolean;
  /** Set by the fixture feasibility check. */
  feasible: boolean;
  feasibilityNote: string;
  assumptions: string[];
  openQuestions: string[];
  estSeconds?: number;
  review: ReviewStatus;
  note?: string;
  edited?: boolean;
  userAdded?: boolean;
}

export interface CoverageRow {
  requirementId: string;
  subsystem: SubsystemId;
  behaviour: string;
  covered: boolean;
  byTests: string[];
  why: string;
  evidenceClass: EvidenceClass;
}

export interface Coverage {
  rows: CoverageRow[];
  covered: number;
  total: number;
  percent: number;
  /** Plain-language statement of what the denominator is. */
  basis: string;
  excluded: { ref: string; reason: string }[];
}

export type RiskLevel = "critical" | "high" | "medium";

export interface Risk {
  id: string;
  level: RiskLevel;
  title: string;
  detail: string;
  action: string;
  evidence: Evidence[];
}

export interface SourceFile {
  name: string;
  size: number;
  text: string;
  kind: SourceKind;
  /** SHA-256 of the file contents, for traceability. */
  hash?: string;
}

export type SourceKind =
  | "kicad-sch"
  | "kicad-pcb"
  | "kicad-pro"
  | "kicad-net"
  | "bom-csv"
  | "netlist-txt"
  | "requirements"
  | "json"
  | "ignored"
  | "unknown";

export interface Provenance {
  projectName: string;
  /** Revision as stated inside the design file. */
  revision?: string;
  /** Revision implied by the filename, when it disagrees. */
  filenameRevision?: string;
  revisionConflict?: string;
  company?: string;
  designDate?: string;
  files: { name: string; kind: SourceKind; size: number; hash: string }[];
  generatedAt: string;
}

export interface ConnectivityReport {
  resolved: boolean;
  pinsTotal: number;
  pinsOnNet: number;
  wires: number;
  junctions: number;
  namedNets: number;
  noConnects: number;
  blockedReason?: string;
}

export interface Draft {
  id: string;
  provenance: Provenance;
  connectivity: ConnectivityReport;
  /** Set when analysis could not proceed. Everything else stays empty. */
  blocked?: string;
  parts: Part[];
  nets: Net[];
  limits: Limit[];
  requirements: Requirement[];
  subsystems: Subsystem[];
  tests: TestStep[];
  fixture: FixtureContact[];
  risks: Risk[];
  coverage: Coverage;
  openQuestions: string[];
  assumptions: string[];
  requirementsText: string;
  sourceNotes: { file: string; messages: string[] }[];
}

export interface StoredProject {
  id: string;
  projectName: string;
  savedAt: string;
  requirements: string;
  files: SourceFile[];
  draft: Draft | null;
}
