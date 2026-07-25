/**
 * The sample project.
 *
 * A synthetic board, but a realistic one: RP2040 with an I²C environmental
 * sensor, an SPI IMU, CAN, USB-C, external flash and a crystal. It exercises
 * every parser path and produces a draft with genuine gaps in it — two parts
 * nothing covers, one assumed rail limit, and a specialist CAN step. A demo
 * that comes back 100% green teaches the viewer nothing.
 */

import type { SourceFile } from "./types";

const netlist = `(export (version "E")
  (design
    (source "/home/eng/proj/rover-sense/rover-sense.kicad_sch")
    (date "2026-07-18T09:12:44+0000")
    (tool "Eeschema 8.0.4"))
  (components
    (comp (ref "U1") (value "RP2040") (footprint "Package_DFN_QFN:QFN-56-1EP_7x7mm")
      (description "Dual ARM Cortex-M0+ microcontroller"))
    (comp (ref "U2") (value "BME280") (footprint "Sensor:Bosch_LGA-8_2.5x2.5mm")
      (description "I2C/SPI temperature humidity pressure sensor"))
    (comp (ref "U3") (value "AP2112K-3.3") (footprint "Package_TO_SOT_SMD:SOT-23-5")
      (description "600mA low dropout regulator 3.3V"))
    (comp (ref "U4") (value "ICM-42688-P") (footprint "Sensor_Motion:InvenSense_QFN-14")
      (description "6-axis SPI IMU accelerometer gyroscope"))
    (comp (ref "U5") (value "TCAN334") (footprint "Package_SO:SOIC-8")
      (description "CAN FD transceiver 5Mbps"))
    (comp (ref "U6") (value "W25Q128JV") (footprint "Package_SO:SOIC-8_5.3x5.3mm")
      (description "128Mbit SPI NOR flash memory"))
    (comp (ref "Y1") (value "12MHz") (footprint "Crystal:Crystal_SMD_3225-4Pin")
      (description "Crystal 12MHz 20ppm"))
    (comp (ref "J1") (value "USB-C") (footprint "Connector_USB:USB_C_Receptacle_16P")
      (description "USB-C receptacle power and data"))
    (comp (ref "J2") (value "SWD") (footprint "Connector_PinHeader_1.27mm:PinHeader_2x05")
      (description "SWD debug programming header"))
    (comp (ref "J3") (value "CAN") (footprint "Connector_JST:JST_PH_4pin")
      (description "CAN bus and power connector"))
    (comp (ref "U7") (value "DRV8833") (footprint "Package_SO:TSSOP-16")
      (description "Dual H-bridge motor driver 1.5A"))
    (comp (ref "BZ1") (value "MAGNETIC_BUZZER") (footprint "Buzzer_Beeper:Buzzer_12x9.5RM7.6")
      (description "Magnetic buzzer 3V continuous tone"))
    (comp (ref "J4") (value "MOTOR") (footprint "Connector_JST:JST_PH_4pin")
      (description "Motor output connector"))
    (comp (ref "D1") (value "LED_GREEN") (footprint "LED_SMD:LED_0603")
      (description "Status indicator LED"))
    (comp (ref "SW1") (value "BOOTSEL") (footprint "Button_Switch_SMD:SW_SPST_TL3342")
      (description "Tactile switch bootloader select"))
    (comp (ref "R1") (value "5.1k") (footprint "Resistor_SMD:R_0402"))
    (comp (ref "R2") (value "5.1k") (footprint "Resistor_SMD:R_0402"))
    (comp (ref "R3") (value "4.7k") (footprint "Resistor_SMD:R_0402"))
    (comp (ref "R4") (value "4.7k") (footprint "Resistor_SMD:R_0402"))
    (comp (ref "R5") (value "120") (footprint "Resistor_SMD:R_0805"))
    (comp (ref "R6") (value "1k") (footprint "Resistor_SMD:R_0402"))
    (comp (ref "C1") (value "10uF") (footprint "Capacitor_SMD:C_0805"))
    (comp (ref "C2") (value "10uF") (footprint "Capacitor_SMD:C_0805"))
    (comp (ref "C3") (value "100nF") (footprint "Capacitor_SMD:C_0402"))
    (comp (ref "C4") (value "100nF") (footprint "Capacitor_SMD:C_0402"))
    (comp (ref "TP1") (value "VBUS") (footprint "TestPoint:TestPoint_Pad_D1.5mm"))
    (comp (ref "TP2") (value "3V3") (footprint "TestPoint:TestPoint_Pad_D1.5mm"))
    (comp (ref "TP3") (value "GND") (footprint "TestPoint:TestPoint_Pad_D1.5mm"))
    (comp (ref "TP4") (value "GND") (footprint "TestPoint:TestPoint_Pad_D1.5mm"))
    (comp (ref "TP5") (value "SWDIO") (footprint "TestPoint:TestPoint_Pad_D1.5mm"))
    (comp (ref "TP6") (value "SWCLK") (footprint "TestPoint:TestPoint_Pad_D1.5mm")))
  (nets
    (net (code "1") (name "VBUS")
      (node (ref "J1") (pin "A4") (pinfunction "VBUS"))
      (node (ref "U3") (pin "1") (pinfunction "VIN"))
      (node (ref "U7") (pin "3") (pinfunction "VM"))
      (node (ref "C1") (pin "1"))
      (node (ref "TP1") (pin "1")))
    (net (code "2") (name "+3V3")
      (node (ref "U3") (pin "5") (pinfunction "VOUT"))
      (node (ref "U1") (pin "44") (pinfunction "IOVDD"))
      (node (ref "U2") (pin "1") (pinfunction "VDD"))
      (node (ref "U4") (pin "1") (pinfunction "VDD"))
      (node (ref "U5") (pin "3") (pinfunction "VCC"))
      (node (ref "U6") (pin "8") (pinfunction "VCC"))
      (node (ref "C2") (pin "1"))
      (node (ref "C3") (pin "1"))
      (node (ref "R3") (pin "1"))
      (node (ref "R4") (pin "1"))
      (node (ref "TP2") (pin "1")))
    (net (code "3") (name "GND")
      (node (ref "J1") (pin "A1") (pinfunction "GND"))
      (node (ref "U1") (pin "57") (pinfunction "EP"))
      (node (ref "U2") (pin "8") (pinfunction "GND"))
      (node (ref "U3") (pin "2") (pinfunction "GND"))
      (node (ref "U4") (pin "7") (pinfunction "GND"))
      (node (ref "U5") (pin "2") (pinfunction "GND"))
      (node (ref "U6") (pin "4") (pinfunction "GND"))
      (node (ref "U7") (pin "9") (pinfunction "GND"))
      (node (ref "BZ1") (pin "2"))
      (node (ref "C1") (pin "2"))
      (node (ref "C2") (pin "2"))
      (node (ref "C3") (pin "2"))
      (node (ref "C4") (pin "2"))
      (node (ref "TP3") (pin "1"))
      (node (ref "TP4") (pin "1")))
    (net (code "4") (name "SDA")
      (node (ref "U1") (pin "3") (pinfunction "GPIO2"))
      (node (ref "U2") (pin "6") (pinfunction "SDI"))
      (node (ref "R3") (pin "2")))
    (net (code "5") (name "SCL")
      (node (ref "U1") (pin "4") (pinfunction "GPIO3"))
      (node (ref "U2") (pin "4") (pinfunction "SCK"))
      (node (ref "R4") (pin "2")))
    (net (code "6") (name "SPI0_SCK")
      (node (ref "U1") (pin "24") (pinfunction "GPIO18"))
      (node (ref "U4") (pin "14") (pinfunction "SCLK"))
      (node (ref "U6") (pin "6") (pinfunction "CLK")))
    (net (code "7") (name "SPI0_MOSI")
      (node (ref "U1") (pin "25") (pinfunction "GPIO19"))
      (node (ref "U4") (pin "13") (pinfunction "SDI"))
      (node (ref "U6") (pin "5") (pinfunction "DI")))
    (net (code "8") (name "SPI0_MISO")
      (node (ref "U1") (pin "21") (pinfunction "GPIO16"))
      (node (ref "U4") (pin "12") (pinfunction "SDO"))
      (node (ref "U6") (pin "2") (pinfunction "DO")))
    (net (code "9") (name "IMU_CS")
      (node (ref "U1") (pin "22") (pinfunction "GPIO17"))
      (node (ref "U4") (pin "11") (pinfunction "CS")))
    (net (code "10") (name "FLASH_CS")
      (node (ref "U1") (pin "26") (pinfunction "GPIO20"))
      (node (ref "U6") (pin "1") (pinfunction "CS")))
    (net (code "11") (name "SWDIO")
      (node (ref "U1") (pin "51") (pinfunction "SWDIO"))
      (node (ref "J2") (pin "2"))
      (node (ref "TP5") (pin "1")))
    (net (code "12") (name "SWCLK")
      (node (ref "U1") (pin "52") (pinfunction "SWCLK"))
      (node (ref "J2") (pin "4"))
      (node (ref "TP6") (pin "1")))
    (net (code "13") (name "USB_D+")
      (node (ref "J1") (pin "A6") (pinfunction "DP"))
      (node (ref "U1") (pin "46") (pinfunction "USB_DP")))
    (net (code "14") (name "USB_D-")
      (node (ref "J1") (pin "A7") (pinfunction "DN"))
      (node (ref "U1") (pin "47") (pinfunction "USB_DM")))
    (net (code "15") (name "CANH")
      (node (ref "U5") (pin "7") (pinfunction "CANH"))
      (node (ref "J3") (pin "1"))
      (node (ref "R5") (pin "1")))
    (net (code "16") (name "CANL")
      (node (ref "U5") (pin "6") (pinfunction "CANL"))
      (node (ref "J3") (pin "2"))
      (node (ref "R5") (pin "2")))
    (net (code "17") (name "CAN_TX")
      (node (ref "U1") (pin "5") (pinfunction "GPIO4"))
      (node (ref "U5") (pin "1") (pinfunction "TXD")))
    (net (code "18") (name "CAN_RX")
      (node (ref "U1") (pin "6") (pinfunction "GPIO5"))
      (node (ref "U5") (pin "4") (pinfunction "RXD")))
    (net (code "19") (name "LED_STATUS")
      (node (ref "U1") (pin "27") (pinfunction "GPIO21"))
      (node (ref "R6") (pin "1")))
    (net (code "20") (name "XIN")
      (node (ref "U1") (pin "20") (pinfunction "XIN"))
      (node (ref "Y1") (pin "1")))
    (net (code "21") (name "RUN")
      (node (ref "U1") (pin "26") (pinfunction "RUN"))
      (node (ref "SW1") (pin "1")))
    (net (code "22") (name "CC1")
      (node (ref "J1") (pin "A5") (pinfunction "CC1"))
      (node (ref "R1") (pin "1")))
    (net (code "23") (name "CC2")
      (node (ref "J1") (pin "B5") (pinfunction "CC2"))
      (node (ref "R2") (pin "1")))
    (net (code "24") (name "MOTOR_AIN1")
      (node (ref "U1") (pin "29") (pinfunction "GPIO22"))
      (node (ref "U7") (pin "1") (pinfunction "AIN1")))
    (net (code "25") (name "MOTOR_AIN2")
      (node (ref "U1") (pin "30") (pinfunction "GPIO23"))
      (node (ref "U7") (pin "2") (pinfunction "AIN2")))
    (net (code "26") (name "MOTOR_AOUT1")
      (node (ref "U7") (pin "15") (pinfunction "AOUT1"))
      (node (ref "J4") (pin "1")))
    (net (code "27") (name "MOTOR_AOUT2")
      (node (ref "U7") (pin "16") (pinfunction "AOUT2"))
      (node (ref "J4") (pin "2")))
    (net (code "28") (name "BUZZER_PWM")
      (node (ref "U1") (pin "31") (pinfunction "GPIO24"))
      (node (ref "BZ1") (pin "1")))))
`;

const bom = `Reference,Value,Description,Footprint,Qty
U1,RP2040,Dual ARM Cortex-M0+ microcontroller,QFN-56,1
U2,BME280,I2C temperature humidity pressure sensor,LGA-8,1
U3,AP2112K-3.3,600mA LDO regulator 3.3V,SOT-23-5,1
U4,ICM-42688-P,6-axis SPI IMU,QFN-14,1
U5,TCAN334,CAN FD transceiver,SOIC-8,1
U6,W25Q128JV,128Mbit SPI NOR flash,SOIC-8,1
U7,DRV8833,Dual H-bridge motor driver 1.5A,TSSOP-16,1
BZ1,MAGNETIC_BUZZER,Magnetic buzzer 3V continuous tone,Buzzer_12x9.5,1
J4,MOTOR,Motor output connector,JST_PH_4pin,1
Y1,12MHz,Crystal 12MHz 20ppm,3225-4Pin,1
J1,USB-C,USB-C receptacle power and data,USB_C_16P,1
J2,SWD,SWD debug header 2x05 1.27mm,PinHeader_2x05,1
J3,CAN,CAN bus and power connector,JST_PH_4pin,1
D1,LED_GREEN,Status indicator LED,LED_0603,1
SW1,BOOTSEL,Tactile switch bootloader select,SW_SPST,1
"R1,R2",5.1k,USB-C CC pulldown,R_0402,2
"R3,R4",4.7k,I2C pull-up,R_0402,2
R5,120,CAN bus termination,R_0805,1
R6,1k,LED series resistor,R_0402,1
C1-C2,10uF,Bulk decoupling,C_0805,2
C3-C4,100nF,Local decoupling,C_0402,2
TP1,VBUS,Test point VBUS,TestPoint_1.5mm,1
TP2,3V3,Test point 3V3,TestPoint_1.5mm,1
TP3-TP4,GND,Test point GND,TestPoint_1.5mm,2
TP5,SWDIO,Test point SWDIO,TestPoint_1.5mm,1
TP6,SWCLK,Test point SWCLK,TestPoint_1.5mm,1
`;

export const SAMPLE_REQUIREMENTS = `Board accepts 5 V from USB-C or from the CAN connector.
The 3V3 rail must remain between 3.20 V and 3.40 V under full load.
Quiescent current draw must be under 120 mA with the radio idle.
Firmware must program over SWD and verify by checksum.
The BME280 must respond at I2C address 0x76.
The IMU must return a WHO_AM_I of 0x47.
Status LED must turn on, then off, under firmware control.
CAN must acknowledge a frame at 500 kbps.
The board must enumerate over USB within 3 seconds of power-up.
Target factory test time is under 75 seconds per unit.
Every unit must be serialised before it leaves the station.`;

export const SAMPLE_PROJECT_NAME = "Rover sense rev C";

export function sampleFiles(): SourceFile[] {
  return [
    {
      name: "rover-sense.net",
      size: netlist.length,
      text: netlist,
      kind: "kicad-net",
    },
    {
      name: "rover-sense-bom.csv",
      size: bom.length,
      text: bom,
      kind: "bom-csv",
    },
  ];
}
