# FixtureForge

Reads a PCB design and drafts the production test for it — the sequence, the fixture pinout, the pass/fail limits, and the list of parts nothing tests. Then it shows you the file and line behind every claim, so you can argue with it instead of trusting it.

Runs entirely in the browser. There is no server in this project, so a design file has nowhere to go even if it wanted one.

**[Live demo](https://downbeatfoil.github.io/fixtureforge/)** · load the sample board to see a worked example.

---

## The problem

When a board goes from working prototype to production, someone senior has to turn bench knowledge into a repeatable factory process: decide what proves a board can ship, find the signals a fixture can reach, define instruments and limits, and get all of it written down clearly enough that a contract manufacturer or fixture vendor can act on it.

That usually happens under an NPI deadline, in a spreadsheet, from scratch, every time.

Most of the information needed is already sitting in the netlist. FixtureForge reads it out.

## What it actually does

**Parses the design.** A real S-expression reader for KiCad `.kicad_sch` and `.net` exports, a BOM reader that sniffs CSV/TSV headers and expands `R1-R7` ranges, and a plain-text netlist fallback. A netlist is the useful one — it carries which pin of which part every signal lands on, so the fixture map is read rather than guessed.

**Pulls limits out of prose.** "The 3V3 rail must remain between 3.20 V and 3.40 V" becomes `{min: 3.2, max: 3.4, unit: "V"}`, attached to the `+3V3` net. Units are normalised, so `120 mA` and `0.12 A` are the same limit.

**Generates a sequence from connectivity.** 16 rules, each of which looks at the merged design and either produces steps or stays quiet. A CAN step only appears if there's a transceiver on a CAN net.

**Labels every claim.** Three states, and the distinction is the whole point:

| | |
|---|---|
| `detected` | read out of your files |
| `inferred` | assumed from a naming convention — check it |
| `unresolved` | nothing answers this; an engineer has to supply it |

A stated nominal with no tolerance ("accepts 5 V") counts as a gap, not a limit. There's nothing there a test could fail a board on.

**Finds what nothing tests.** Coverage is computed over parts a functional test could plausibly target. Passives and test points are excluded from the denominator on purpose — claiming 4% because a board has 200 decoupling caps would be noise.

**Takes corrections.** Every step can be edited, accepted, flagged or dropped. Rejecting a step recomputes coverage and cycle time. The corrections export with the spec, because they're the useful output.

## Exports

| Format | For |
|---|---|
| Markdown | the engineer reviewing it, with a sign-off line |
| JSON | re-importing, or feeding something else |
| Test plan CSV | the contract manufacturer |
| Fixture pinout CSV | the fixture vendor |
| `pytest` skeleton | whoever writes the station code |

The pytest export is a real file with your limits already in it:

```python
LIMITS = {
    "t_3v3": {"min": 3.2, "max": 3.4, "unit": "V"},  # DETECTED — read from the design files
    "vbus":  {"nominal": 5.0, "unit": "V"},          # INFERRED — assumed from a naming convention
}

def test_t04_t_3v3_rail_check(dut):
    limit = LIMITS["t_3v3"]
    measured = dut.measure_voltage("+3V3")
    assert limit["min"] <= measured <= limit["max"], (
        f'+3V3 measured {measured} V, expected {limit["min"]}-{limit["max"]} V'
    )
```

Steps with no resolvable limit emit `pytest.skip("UNRESOLVED: …")` rather than a guessed assertion.

## What it deliberately doesn't do

Fixture mechanics, Gerbers, probe force, tooling plates. Driving instruments or applying power to anything. Signing off RF, safety or regulatory limits. Deciding a board is good enough to ship.

The output is a draft. A qualified engineer owns the final limits, the safety case, and the release decision.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and hit **Run the sample board**.

```bash
npm run build     # production build into dist/
npm run check     # typecheck only
```

## How it's put together

```
src/
  lib/
    types.ts          data model — Evidence, Basis, TestStep, Draft
    classify.ts       net and part classification from naming conventions
    parse/
      sexpr.ts        S-expression reader that tracks line numbers
      kicad.ts        .kicad_sch symbols/labels, .net components/nets/nodes
      bom.ts          CSV/TSV with header sniffing and range expansion
      netlist.ts      plain-text netlists
      requirements.ts prose to structured numeric limits
      index.ts        format detection and merging by designator
    analyze/
      rules.ts        the 16 generation rules and the design context
      index.ts        coverage, DFT risks, readiness scoring
    export/           markdown, json, csv, pinout, pytest
  components/         Scope, InputPanel, DraftView
```

Line numbers are threaded from the tokenizer all the way to the UI. That's what makes `rover-sense.net:60` clickable-in-principle next to a claim, and it's the reason the S-expression reader tracks position rather than using a stock parser.

## Notes on accuracy

The classifiers are heuristics over naming conventions and they are wrong sometimes — a net called `CS` might be chip-select or current-sense. Anything that depends on a guess is labelled `inferred` rather than `detected`, which is the honest version of a confidence score.

Requirement-to-net matching is deliberately generous (three passes, loosening as they go). Schematic net names carry decoration that prose never does — nobody writes "the +3V3 rail must stay…" — and a dropped requirement gets silently replaced by an assumed limit, which is the worst thing this codebase can do.

## Licence

MIT
