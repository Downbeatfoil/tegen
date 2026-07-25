/**
 * Core data model.
 *
 * The rule the whole app is built around: nothing shows up in the output
 * without saying where it came from. Every net, part and limit carries the
 * file and line it was read out of, and every generated test step carries the
 * facts it leaned on. An engineer reviewing the draft should never have to
 * guess whether a number was read off their design or invented for them.
 */

/** A pointer back into a source file. Line numbers are 1-indexed. */
export interface Evidence {
  file: string;
  line: number;
  snippet: string;
}

/** Where a piece of the draft came from. Drives the badge in the UI. */
export type Basis =
  /** Read directly out of the design files. */
  | "detected"
  /** Derived from a convention or a rule of thumb, not from the files. */
  | "inferred"
  /** We know something belongs here but the files don't say what. */
  | "unresolved";

export type Confidence = "high" | "review" | "specialist";

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
  | "clock"
  | "reset"
  | "gpio"
  | "rf"
  | "unknown";

export type PartClass =
  | "mcu"
  | "sensor"
  | "regulator"
  | "connector"
  | "led"
  | "switch"
  | "transceiver"
  | "crystal"
  | "memory"
  | "passive"
  | "testpoint"
  | "unknown";

export interface NetNode {
  ref: string;
  pin: string;
}

export interface Net {
  name: string;
  klass: NetClass;
  nodes: NetNode[];
  /** Nominal rail voltage in volts, when the net name implies one. */
  nominalV?: number;
  evidence: Evidence[];
}

export interface Part {
  ref: string;
  value: string;
  description?: string;
  footprint?: string;
  klass: PartClass;
  /** Set for parts we decide can't meaningfully be tested electrically. */
  untestableReason?: string;
  evidence: Evidence[];
}

export interface Limit {
  /** Human label, e.g. "3V3 rail voltage". */
  parameter: string;
  net?: string;
  min?: number;
  max?: number;
  nominal?: number;
  unit: string;
  basis: Basis;
  evidence: Evidence[];
  /** Free-text for limits we can't express numerically (device IDs etc). */
  note?: string;
}

export type ReviewStatus = "unreviewed" | "accepted" | "flagged" | "rejected";

export interface TestStep {
  id: string;
  name: string;
  purpose: string;
  access: string;
  stimulus: string;
  expected: string;
  instrument: string;
  confidence: Confidence;
  basis: Basis;
  /** Which rule produced this, so a reviewer can reason about the generator. */
  ruleId: string;
  evidence: Evidence[];
  /** Refs of parts this step actually exercises. Feeds the coverage view. */
  covers: string[];
  nets: string[];
  estSeconds: number;
  /** Engineer review state — the whole point of the tool. */
  review: ReviewStatus;
  note?: string;
  /** True when a human edited any field away from what was generated. */
  edited?: boolean;
  /** True for steps a human added by hand. */
  userAdded?: boolean;
}

export interface InterfaceRow {
  signal: string;
  role: string;
  instrument: string;
  fixturePath: string;
  /** Suggested fixture connector pin. Sequential, but stable per draft. */
  pin: number;
  net?: string;
  evidence: Evidence[];
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

export interface CoverageEntry {
  ref: string;
  value: string;
  klass: PartClass;
  covered: boolean;
  byTests: string[];
  reason?: string;
}

export interface Coverage {
  entries: CoverageEntry[];
  testablePartCount: number;
  coveredCount: number;
  /** 0-100, over testable parts only. Passives are excluded on purpose. */
  percent: number;
}

export interface ReadinessFactor {
  label: string;
  score: number;
  max: number;
  detail: string;
}

export interface Readiness {
  score: number;
  factors: ReadinessFactor[];
  label: string;
}

export interface SourceFile {
  name: string;
  size: number;
  text: string;
  /** What the parser decided this file was. */
  kind: SourceKind;
}

export type SourceKind =
  | "kicad-sch"
  | "kicad-net"
  | "bom-csv"
  | "netlist-txt"
  | "requirements"
  | "json"
  | "unknown";

export interface ParseResult {
  parts: Part[];
  nets: Net[];
  /** Anything the parser wants to tell the user about this file. */
  notes: string[];
  kind: SourceKind;
}

export interface Draft {
  id: string;
  projectName: string;
  generatedAt: string;
  sourceFiles: { name: string; kind: SourceKind; size: number }[];
  parts: Part[];
  nets: Net[];
  limits: Limit[];
  tests: TestStep[];
  interfaceRows: InterfaceRow[];
  risks: Risk[];
  coverage: Coverage;
  readiness: Readiness;
  assumptions: string[];
  estCycleSeconds: number;
  /** Requirements text as entered, kept so a reload restores the input. */
  requirements: string;
}

export interface StoredProject {
  id: string;
  projectName: string;
  savedAt: string;
  requirements: string;
  files: SourceFile[];
  draft: Draft | null;
}
