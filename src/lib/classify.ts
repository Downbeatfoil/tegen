/**
 * Naming-convention classifiers.
 *
 * These are heuristics over net and reference-designator names, and they are
 * wrong sometimes — a net called `CS` might be chip-select or it might be
 * current-sense. Everything downstream that depends on a guess made here is
 * labelled "inferred" rather than "detected" so a reviewer knows to check it.
 */

import type { NetClass, PartClass } from "./types";

const norm = (s: string) => s.toUpperCase().replace(/^[/\\]+/, "").trim();

/** Strips hierarchical path and bus index: "/power/+3V3[0]" -> "+3V3". */
export function baseNetName(raw: string): string {
  const withoutPath = raw.replace(/^.*[/\\]/, "");
  return withoutPath.replace(/\[\d+\]$/, "").trim();
}

interface Pattern {
  klass: NetClass;
  test: RegExp;
}

// Order matters: the first match wins, so put specific before general.
const NET_PATTERNS: Pattern[] = [
  { klass: "ground", test: /^(GND|GNDA|GNDD|GNDPWR|AGND|DGND|PGND|VSS|VSSA|EARTH|0V)([_-]\w+)?$/ },
  { klass: "usb", test: /^(USB[_-]?)?(D[+-]|DP|DM|USB_?D[PM])$/ },
  { klass: "swd", test: /^(SWDIO|SWCLK|SWO|SWDCLK|SWDAT)$/ },
  { klass: "jtag", test: /^(TCK|TMS|TDI|TDO|TRST|NTRST|JTAG\w*)$/ },
  { klass: "can", test: /^(CAN[_-]?[HL]|CANH|CANL|CAN[_-]?(TX|RX)D?)$/ },
  { klass: "i2c", test: /^(I2C\w*|SDA\w*|SCL\w*|\w*[_-](SDA|SCL))$/ },
  { klass: "spi", test: /^(SPI\w*|MOSI|MISO|SCK|SCLK|COPI|CIPO|SDO|SDI|NSS|SS|CS\d*|[N]?CS[_-]?\w*)$/ },
  { klass: "uart", test: /^(UART\w*|TXD?\d*|RXD?\d*|CTS|RTS|DTR|\w*[_-](TX|RX)D?)$/ },
  { klass: "reset", test: /^(N?RST|N?RESET|MCLR|EN|ENABLE|SHDN|N?SHUTDOWN)([_-]\w+)?$/ },
  { klass: "clock", test: /^(X(TAL)?\d*[AB]?|OSC\w*|M?CLK\w*|CLK(IN|OUT)?)$/ },
  { klass: "rf", test: /^(ANT\w*|RF\w*|BALUN\w*|2G4|LNA\w*|PA[_-]?OUT)$/ },
  { klass: "analog", test: /^(A(IN|DC|OUT)\w*|VREF\w*|ANALOG\w*|NTC\w*|THERM\w*|ISENSE\w*|VSENSE\w*|\w*[_-]ADC)$/ },
  { klass: "gpio", test: /^(GPIO\w*|IO\d+|P[A-K]\d+|LED\w*|\w*[_-]LED|BTN\w*|BUTTON\w*|SW\d*|RELAY\w*|MOTOR\w*|FAN\w*|BUZZ\w*|\w*[_-]EN)$/ },
];

const POWER_PREFIX = /^(VBUS|VIN|VCC\w*|VDD\w*|VBAT|VSYS|VMOT|VMAIN|PWR\w*|\+?\d+V\d*|\+?\d+[.,]\d+V|V\d+V\d+)([_-]\w+)?$/;

/** Rail voltage implied by a net name, if the name states one. */
export function railVoltage(name: string): number | undefined {
  const n = norm(name);

  // 3V3 / 1V8 / 12V0 -> digit V digit
  const split = n.match(/(?:^|[_+-])(\d{1,2})V(\d{1,2})(?:$|[_-])/);
  if (split) return Number(`${split[1]}.${split[2]}`);

  // 5V / 3.3V / 12V
  const plain = n.match(/(?:^|[_+-])(\d{1,2}(?:[.,]\d{1,2})?)V(?:$|[_-])/);
  if (plain) return Number(plain[1].replace(",", "."));

  if (/^VBUS/.test(n)) return 5.0;
  return undefined;
}

export function classifyNet(rawName: string): NetClass {
  const n = norm(baseNetName(rawName));
  if (!n) return "unknown";

  for (const { klass, test } of NET_PATTERNS) {
    if (test.test(n)) return klass;
  }
  if (POWER_PREFIX.test(n) || railVoltage(n) !== undefined) return "power";
  return "unknown";
}

/** Human label for a net class, used in tables and exports. */
export const NET_CLASS_LABEL: Record<NetClass, string> = {
  power: "Power rail",
  ground: "Ground",
  i2c: "I²C",
  spi: "SPI",
  uart: "UART",
  swd: "SWD",
  jtag: "JTAG",
  can: "CAN",
  usb: "USB",
  analog: "Analog",
  clock: "Clock",
  reset: "Reset",
  gpio: "GPIO",
  rf: "RF",
  unknown: "Unclassified",
};

interface PartRule {
  klass: PartClass;
  test: RegExp;
}

// Matched against "VALUE DESCRIPTION FOOTPRINT" joined together.
const PART_VALUE_RULES: PartRule[] = [
  {
    klass: "mcu",
    test: /\b(RP2040|RP2350|STM32\w*|ATMEGA\w*|ATTINY\w*|ESP32\w*|ESP8266|NRF5\d+\w*|SAMD\d+\w*|PIC\d+\w*|MSP430\w*|GD32\w*|RA4\w*|APOLLO\d|MICROCONTROLLER|\bMCU\b|SOC)\b/i,
  },
  {
    klass: "regulator",
    test: /\b(AP2112\w*|AMS1117\w*|LM1117\w*|LM317|MIC5\d+\w*|LP298\d\w*|TPS6\d+\w*|TLV7\d+\w*|MCP1700\w*|XC6206\w*|RT9013|LDO|REGULATOR|BUCK|BOOST|DC[- ]?DC|SWITCHING SUPPLY|PMIC)\b/i,
  },
  {
    klass: "sensor",
    test: /\b(BME\d+|BMP\d+|BMI\d+|BNO\d+|MPU[- ]?\d+|LSM\d\w*|ICM[- ]?\d+|SHT\d+\w*|HDC\d+|TMP\d+\w*|LM75\w*|ADXL\d+|INA\d+\w*|MAX3\d{4}|VL53\w*|APDS\w*|SENSOR|IMU|ACCELEROM\w*|GYRO\w*|MAGNETOM\w*|BAROMET\w*|HUMIDITY|THERMOCOUPLE|LOAD CELL|HALL EFFECT)\b/i,
  },
  {
    klass: "transceiver",
    test: /\b(TCAN\d+\w*|MCP255\d|SN65HVD\w*|TJA10\d+|ISO1050|MAX(485|3485|13487)\w*|SP3485|ADM2\d+|LAN8\d+\w*|DP83\w*|KSZ8\w*|TRANSCEIVER|RS[- ]?485|RS[- ]?232|ETHERNET PHY|\bPHY\b)\b/i,
  },
  {
    klass: "memory",
    test: /\b(W25Q\w*|AT24\w*|24LC\w*|24AA\w*|M24\w*|MX25\w*|IS25\w*|SST26\w*|EEPROM|FLASH|SRAM|MRAM|FRAM|SD ?CARD|MICROSD)\b/i,
  },
  { klass: "crystal", test: /\b(CRYSTAL|RESONATOR|OSCILLATOR|XTAL|\d+(\.\d+)?\s?MHZ|\d+(\.\d+)?\s?KHZ|32\.?768)\b/i },
  { klass: "led", test: /\b(LED|WS28\d+|SK6812|NEOPIXEL|INDICATOR)\b/i },
  { klass: "connector", test: /\b(USB[- ]?[ABC]?\b|CONN\w*|CONNECTOR|HEADER|RECEPTACLE|JACK|TERMINAL BLOCK|JST|MOLEX|SWD|JTAG|RJ45|BARREL|SOCKET|FFC|FPC)\b/i },
  { klass: "switch", test: /\b(SWITCH|TACTILE|PUSHBUTTON|BUTTON|DIP ?SWITCH|RELAY|SPDT|SPST)\b/i },
];

const REF_PREFIX_RULES: { klass: PartClass; test: RegExp }[] = [
  { klass: "testpoint", test: /^(TP|MH|TEST)\d/i },
  { klass: "connector", test: /^(J|P|CN|CON|X)\d/i },
  { klass: "switch", test: /^(SW|S|K)\d/i },
  { klass: "crystal", test: /^(Y|XT?)\d/i },
  { klass: "led", test: /^(LED|DS)\d/i },
  { klass: "passive", test: /^(R|C|L|FB|FL|D|Q|F|RN|CN?P|VR|MOV|TVS)\d/i },
  { klass: "mcu", test: /^(U|IC)\d/i },
];

export function classifyPart(ref: string, value: string, description = "", footprint = ""): PartClass {
  const haystack = `${value} ${description} ${footprint}`;

  // A value/description match beats the reference prefix — "U3 / AP2112K-3.3"
  // is a regulator, not the microcontroller its `U` prefix would suggest.
  for (const { klass, test } of PART_VALUE_RULES) {
    if (test.test(haystack)) return klass;
  }

  for (const { klass, test } of REF_PREFIX_RULES) {
    if (test.test(ref)) {
      // Reaching here means no value rule matched, so a bare `U1` with an
      // unrecognised part number shouldn't be claimed as the microcontroller.
      if (klass === "mcu") return "unknown";
      return klass;
    }
  }
  return "unknown";
}

export const PART_CLASS_LABEL: Record<PartClass, string> = {
  mcu: "Controller",
  sensor: "Sensor",
  regulator: "Regulator",
  connector: "Connector",
  led: "Indicator",
  switch: "Switch",
  transceiver: "Transceiver",
  crystal: "Timing",
  memory: "Memory",
  passive: "Passive",
  testpoint: "Test point",
  unknown: "Unidentified",
};

/**
 * Parts a functional test can't sensibly target one-by-one. Excluded from the
 * coverage denominator so the percentage means something — claiming 4% because
 * a board has 200 decoupling caps would be noise, not signal.
 */
export function untestableReason(klass: PartClass): string | undefined {
  if (klass === "passive")
    return "Passive, covered indirectly by rail and functional checks rather than individually probed";
  if (klass === "testpoint") return "Test point, which provides access rather than being a device under test";
  return undefined;
}
