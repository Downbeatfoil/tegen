# Tegen

Reads a KiCad project, rebuilds the board's connectivity, and drafts the production test for it. Every claim says where it came from, and anything the design files cannot answer is listed as a question rather than filled in.

Runs entirely in the browser. There is no server in this project, so a design file has nowhere to go even if it wanted one.

**[Live demo](https://www.tegen.us/)**

---

## The idea

Most of what a production test needs is already in the schematic. Not as a list, though: as geometry. Wires, junctions, pin positions. So the first job is to rebuild the netlist the way KiCad does, and the second is to be honest about everything that *isn't* in there.

A report that looks specific and is electrically wrong is worse than no report. That principle drives the design more than any feature does.

## How it works

**Connectivity first.** A `.kicad_sch` carries full connectivity, but geometrically. Tegen places every pin in sheet coordinates (rotation, mirroring, multi-unit symbols), then unions pins, wires, junctions and labels into nets. A pin touching a wire anywhere along its length connects, with no junction needed, so endpoint-only matching silently drops connections. Same-named power symbols and global labels merge into one net.

The pin transform was not taken from memory. Every plausible convention was scored against a real board, keeping the one that actually landed pins on wires.

**If connectivity fails, everything stops.** The project is reported blocked. No subsystems, no tests, no coverage number. Anything built on unresolved connectivity would look specific and be guesswork.

**Four evidence classes**, and they gate what the tool may assert:

| | |
|---|---|
| `detected` | read out of the schematic or PCB |
| `derived` | reasoned from read facts by a stated rule, with the reasoning shown |
| `documented` | stated in the supplied requirements |
| `unresolved` | nothing answers this; it needs the customer |

`derived` exists because plenty of solid facts are neither read verbatim nor guessed. An I²C address strapped by A0/A1/A2 tied to GND is arrived at by electrical reasoning over read facts, and the tool shows the strapping so you can check it.

**Physical access comes from the PCB, never from a schematic net.** A net can exist and have nowhere a probe can reach. Tegen reads pads and vias, and KiCad states via tenting explicitly, so "this via is exposed" is a read fact. No PCB supplied means access is reported as unconfirmed, not assumed.

**The fixture is checked against the plan.** Every step declares the contacts, equipment and firmware it needs. A step whose nets have no confirmed probe target is marked as unable to run, and that is a defect in the plan rather than a footnote.

**Coverage is over required behaviours, not part counts.** Each row states the behaviour, where the requirement came from, and what covers it. Logos, mounting holes and passives are not behaviours and are excluded, with the exclusions listed.

**Nothing numeric is invented.** No tolerance, no cycle time, no readiness score. If a rail has no stated pass band, the step says so and asks for one. A nominal with no tolerance is flagged as needing characterisation rather than promoted to a limit.

**Project isolation.** Name and revision come from the schematic title block, then the filename, and only then from what you typed. They are never inherited from a previous run. A revision stated in the schematic that disagrees with the filename is flagged. New files clear any existing draft.

## Exports

Markdown spec, JSON, test-plan CSV, fixture-pinout CSV, coverage-matrix CSV, and a `pytest` skeleton. All of them lead with provenance: file names, sizes and SHA-256, so a report can be tied to exact inputs. Steps the fixture can't run emit a skip rather than an assertion.

## What it deliberately doesn't do

Fixture mechanics, Gerbers, probe force, tooling plates. Driving instruments or applying power. Signing off RF, safety or regulatory limits. Deciding a board is good enough to ship.

The output is a draft. A qualified engineer owns the final limits and the release decision.

## Running it

```bash
npm install
npm run dev
```

```bash
npm run build   # production build
npm run check   # typecheck
npm test        # acceptance tests
```

### Test fixture

The acceptance suite runs against the public PocketMidi KB1 design, which is not committed here because it isn't ours to redistribute. The tests skip cleanly without it. To run them:

```bash
curl -L -o kb1.zip https://raw.githubusercontent.com/PocketMidi/KB1/main/hardware/electronics/KB1_KiCad.zip && unzip kb1.zip -d .kb1/extracted
```

The suite pins a golden connectivity set checked by hand against the schematic (shared I²C bus, supply rails, address strapping, the slide switch reaching the amplifier shutdown pin), so a regression in the geometry fails here rather than in a customer's report. It also asserts the negatives: no invented oscillator, no antenna-feed access, no provisioning requirements, no readiness score, and no content carried over between projects.

## Layout

```
src/lib/
  types.ts              data model and evidence classes
  classify.ts           part and net classification
  parse/
    sexpr.ts            S-expression reader that tracks line numbers
    kicadGraph.ts       connectivity resolver
    kicadPcb.ts         pads, vias and tenting for physical access
    requirements.ts     prose to structured numeric limits
  analyze/index.ts      subsystems, requirements, tests, fixture, coverage
  export/index.ts       markdown, json, csv, pytest
```

## Licence

MIT
