/**
 * Part and net classification.
 *
 * These are heuristics over part numbers, symbol library ids and net names.
 * They are wrong sometimes, so anything downstream that leans on a guess is
 * labelled `derived` at best and never `detected`.
 */

import type { NetClass, PartClass, SubsystemId } from "./types";

const norm = (s: string) => s.toUpperCase().replace(/^[/\\]+/, "").trim();

export function baseNetName(raw: string): string {
  return raw.replace(/^.*[/\\]/, "").replace(/\[\d+\]$/, "").trim();
}

const NET_PATTERNS: { klass: NetClass; test: RegExp }[] = [
  { klass: "ground", test: /^[+-]?(GND\w*|AGND|DGND|PGND|VSS\w*|EARTH|0V)$/ },
  { klass: "usb", test: /^(USB[_-]?)?(D[+-]|DP|DM|USB_?D[PM])$/ },
  { klass: "swd", test: /^(SWDIO|SWCLK|SWO)$/ },
  { klass: "jtag", test: /^(TCK|TMS|TDI|TDO|N?TRST)$/ },
  { klass: "can", test: /^(CAN[_-]?[HL]|CAN[_-]?(TX|RX)D?)$/ },
  { klass: "i2c", test: /^(I2C\w*|SDA\w*|SCL\w*|SCK|\w*[_-](SDA|SCL))$/ },
  { klass: "spi", test: /^(SPI\w*|MOSI|MISO|SCLK|COPI|CIPO|N?CS\d*)$/ },
  { klass: "uart", test: /^(UART\w*|MIDI\w*|TXD?\d*|RXD?\d*|\w*[_-](TX|RX)D?)$/ },
  { klass: "audio", test: /^(AUD\w*|AUDIO\w*|SPK\w*|SPEAKER\w*|LINE[_-]?(IN|OUT)|HP\w*|[+-]?OUT_[LR]|IN[LR]|VREF)$/ },
  { klass: "reset", test: /^(N?RST|N?RESET|MCLR|SHDN|EN)$/ },
  { klass: "clock", test: /^(X(TAL)?\d*[AB]?|OSC\w*|M?CLK\w*)$/ },
  { klass: "rf", test: /^(ANT\w*|RF\w*|BALUN\w*)$/ },
  { klass: "analog", test: /^(A(IN|DC|OUT)\w*|VREF\w*|NTC\w*|THERM\w*)$/ },
];

const POWER_NAME = /^[+-]?(VBUS|VIN|VCC\w*|VDD\w*|VBAT|VSYS|VMOT|PWR\w*|\d+V\d*|\d+[.,]\d+V)$/;

export function railVoltage(name: string): number | undefined {
  const n = norm(name);
  const split = n.match(/(?:^|[_+-])(\d{1,2})V(\d{1,2})(?:$|[_-])/);
  if (split) return Number(`${split[1]}.${split[2]}`);
  const plain = n.match(/(?:^|[_+-])(\d{1,2}(?:[.,]\d{1,2})?)V(?:$|[_-])/);
  if (plain) return Number(plain[1].replace(",", "."));
  if (/^\+?VBUS/.test(n)) return 5.0;
  return undefined;
}

export function classifyNet(rawName: string): NetClass {
  const n = norm(baseNetName(rawName));
  if (!n) return "unknown";
  // Auto-generated names carry no meaning; don't read conventions into them.
  if (/^NET-\(/.test(n)) return "unknown";
  for (const { klass, test } of NET_PATTERNS) if (test.test(n)) return klass;
  if (POWER_NAME.test(n) || railVoltage(n) !== undefined) return "power";
  return "unknown";
}

export const NET_CLASS_LABEL: Record<NetClass, string> = {
  power: "Power rail",
  ground: "Ground",
  i2c: "I²C",
  spi: "SPI",
  uart: "UART / MIDI",
  swd: "SWD",
  jtag: "JTAG",
  can: "CAN",
  usb: "USB",
  analog: "Analog",
  audio: "Audio",
  clock: "Clock",
  reset: "Reset / enable",
  gpio: "GPIO",
  rf: "RF",
  unknown: "Unnamed",
};

interface Rule {
  klass: PartClass;
  test: RegExp;
}

/** Matched against "libId value footprint description". */
const PART_RULES: Rule[] = [
  { klass: "mechanical", test: /\b(MountingHole|Fiducial|Logo\d*|NPTH|Graphic)\b/i },
  // Trailing package/grade suffixes run straight on from the digits
  // (PAM8406DR, MCP23017_SS), so a closing \b would never match.
  { klass: "expander", test: /\b(MCP230\d\d|PCF857\d|TCA95\d\d|PCA95\d\d|IO.?Expander)\w*/i },
  { klass: "amplifier", test: /\b(PAM8\d{3}|TPA\d{4}|MAX9\d{3}|LM48\d\d|TDA\d{4}|Amplifier|Class.?D)\w*/i },
  { klass: "module", test: /\b(XIAO\w*|ESP32\w*|ESP8266|NRF5\d\w*|RP2040|Feather|Pico|WROOM|WROVER|Seeed)\b/i },
  { klass: "battery", test: /\b(Battery\w*|LiPo|Li-?Ion|CR20\d\d|Cell)\b/i },
  { klass: "speaker", test: /\b(Speaker\w*|Buzzer\w*|Transducer)\b/i },
  {
    klass: "regulator",
    test: /\b(AP2112\w*|AMS1117\w*|LM1117\w*|MIC5\d+\w*|LP298\d\w*|TPS6\d+\w*|TLV7\d+\w*|MCP170\d|XC6206\w*|LDO|Regulator|Buck|Boost|DC.?DC|PMIC|Charger|MCP73\d\d|TP4056)\b/i,
  },
  {
    klass: "sensor",
    test: /\b(BME\d+|BMP\d+|BMI\d+|MPU[- ]?\d+|LSM\d\w*|ICM[- ]?\d+|SHT\d+\w*|TMP\d+\w*|ADXL\d+|INA\d+\w*|VL53\w*|Sensor|IMU|Accelerom\w*|Gyro\w*)\b/i,
  },
  {
    klass: "transceiver",
    test: /\b(TCAN\d+\w*|MCP255\d|SN65HVD\w*|TJA10\d+|MAX(485|3485)\w*|SP3485|Transceiver|RS.?485|6N13\d|H11L1|PC900)\b/i,
  },
  { klass: "memory", test: /\b(W25Q\w*|AT24\w*|24LC\w*|MX25\w*|EEPROM|FLASH|SRAM|FRAM|SD.?Card)\b/i },
  // Ferrite beads are specified as impedance at a frequency ("120Ω@100MHz"),
  // which a bare MHz pattern reads as an oscillator. That is how a board with
  // no oscillator on it ends up with an oscillator test.
  { klass: "passive", test: /\b(FerriteBead\w*|Ferrite|Choke|Bead)\b/i },
  { klass: "crystal", test: /\b(Crystal|Resonator|Oscillator|XTAL|32\.?768\s?kHz)\b/i },
  { klass: "led", test: /\b(LED\w*|LTST\w*|WS28\d+|SK6812|NeoPixel|SMLD\w*)\b/i },
  { klass: "connector", test: /\b(Connector\w*|Conn_\w*|AudioJack\w*|AudioPlug\w*|USB\w*|Header|Receptacle|Jack|Terminal|JST|Molex|RJ45|Barrel|FFC|FPC|S2B-PH|PinHeader|TestPoint)\b/i },
  // Keys are the repeated playing surface; a five-way control, an illuminated
  // switch and a slide switch each do their own job and get their own step.
  { klass: "key", test: /\b(EVQQ\w*|Tactile|Pushbutton|Keyswitch|SW_Push)\b/i },
  { klass: "switch", test: /\b(JS20\d+\w*|MSS-\d+\w*|K1-5\d+\w*|ML4-\w*|5_Way|Slide|Toggle|SPDT|DPDT|Rotary|Encoder|Relay)\b/i },
  { klass: "passive", test: /\b(FerriteBead\w*|Device:[RCL](_Small)?$|Resistor|Capacitor|Inductor|Diode|Varistor|TVS|Fuse)\b/i },
];

const REF_RULES: Rule[] = [
  { klass: "testpoint", test: /^(TP|TEST)\d/i },
  { klass: "mechanical", test: /^(H|MH|FID|LOGO)\d*/i },
  { klass: "battery", test: /^BT\d/i },
  { klass: "speaker", test: /^(LS|SP)\d/i },
  { klass: "led", test: /^(LED|DS|D)\d/i },
  { klass: "connector", test: /^(J|P|CN|CON|X|plug_)\d*/i },
  { klass: "key", test: /^(SB|SWD)\d/i },
  { klass: "switch", test: /^(S|SW|SLSW|K)\d/i },
  { klass: "crystal", test: /^(Y|XT?)\d/i },
  { klass: "passive", test: /^(R|C|L|FB|FL|Q|F|RN|VR|MOV|TVS|D)\d/i },
];

export function classifyPart(ref: string, value: string, libId = "", footprint = ""): PartClass {
  // Drop the KiCad library name. "Switch:EVQQ2B03W" is a tactile key that
  // happens to live in the Switch library, and matching on the library turns
  // every key on the board into a switch.
  const part = libId.includes(":") ? libId.slice(libId.indexOf(":") + 1) : libId;
  const hay = `${part} ${value} ${footprint}`;
  for (const { klass, test } of PART_RULES) if (test.test(hay)) return klass;
  for (const { klass, test } of REF_RULES) if (test.test(ref)) return klass;
  if (/^(U|IC)\d/i.test(ref)) return "unknown";
  return "unknown";
}

export const PART_CLASS_LABEL: Record<PartClass, string> = {
  mcu: "Controller",
  module: "Module",
  sensor: "Sensor",
  regulator: "Power supply",
  connector: "Connector",
  led: "Indicator",
  switch: "Switch",
  key: "Key / control",
  transceiver: "Transceiver",
  expander: "I/O expander",
  amplifier: "Amplifier",
  speaker: "Speaker",
  battery: "Battery",
  crystal: "Timing",
  memory: "Memory",
  passive: "Passive",
  testpoint: "Test point",
  mechanical: "Mechanical",
  unknown: "Unidentified",
};

/**
 * Parts that are not functional-test targets, and why.
 *
 * A logo is not an electrical object and a mounting hole cannot be
 * electrically dead, so counting either in a coverage denominator makes the
 * percentage meaningless.
 */
export function excludedReason(klass: PartClass, pinCount: number): string | undefined {
  if (klass === "mechanical") return "Mechanical or graphic item, not an electrical test target";
  if (klass === "testpoint") return "Test point: provides access, is not a device under test";
  if (klass === "passive") return "Passive, exercised indirectly by the functions it supports";
  if (pinCount === 0) return "No electrical pins in the schematic";
  return undefined;
}

export function subsystemOf(klass: PartClass, value: string, libId: string): SubsystemId {
  const hay = `${libId} ${value}`;
  if (klass === "module" || klass === "mcu") return "mcu";
  if (klass === "expander") return "i2c";
  if (klass === "amplifier" || klass === "speaker") return "audio";
  if (klass === "battery") return "charging";
  if (klass === "regulator") return /charg|MCP73|TP4056/i.test(hay) ? "charging" : "power";
  if (klass === "led") return "led";
  if (klass === "key") return "keys";
  if (klass === "switch") return "keys";
  if (klass === "connector") {
    if (/audio|jack|plug|speaker/i.test(hay)) return "audio";
    if (/usb/i.test(hay)) return "usb";
    if (/midi|din/i.test(hay)) return "midi";
    if (/batt|S2B-PH|JST/i.test(hay)) return "charging";
    return "unclassified";
  }
  if (klass === "transceiver") return /6N13|H11L|PC900|opto/i.test(hay) ? "midi" : "unclassified";
  return "unclassified";
}

export const SUBSYSTEM_LABEL: Record<SubsystemId, string> = {
  power: "Power",
  charging: "Battery and charging",
  mcu: "Controller and programming",
  i2c: "I²C devices",
  keys: "Keys and controls",
  midi: "MIDI",
  audio: "Audio path",
  led: "Indicators",
  touch: "Touch inputs",
  usb: "USB",
  ble: "BLE / radio",
  unclassified: "Unclassified",
};
