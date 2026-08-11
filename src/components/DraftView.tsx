import { useState } from "react";
import type { Draft, ReviewStatus, TestStep } from "../lib/types";
import { NET_CLASS_LABEL, SUBSYSTEM_LABEL } from "../lib/classify";
import type { ExportFormat } from "../lib/export";
import { EvidenceBadge, EvidenceChips, StandingBadge, ConfidenceBadge, useCountUp } from "./bits";

type Tab = "sequence" | "coverage" | "fixture" | "subsystems" | "questions" | "sources";

interface Props {
  draft: Draft;
  onUpdateTest: (id: string, patch: Partial<TestStep>) => void;
  onExport: (format: ExportFormat) => void;
}

export default function DraftView({ draft, onUpdateTest, onExport }: Props) {
  const [tab, setTab] = useState<Tab>("sequence");
  const [open, setOpen] = useState<string | null>(draft.tests[0]?.id ?? null);

  const p = draft.provenance;
  const active = draft.tests.filter((t) => t.review !== "rejected");
  const infeasible = active.filter((t) => !t.feasible);
  const coveragePct = useCountUp(draft.coverage.percent);
  const uncovered = draft.coverage.rows.filter((r) => !r.covered);

  if (draft.blocked) {
    return (
      <section className="panel">
        <div className="draft-head">
          <div>
            <span className="label">Blocked</span>
            <h3>{p.projectName}</h3>
            <p>No plan was generated.</p>
          </div>
        </div>
        <div className="panel-body">
          <p className="notice warn" style={{ marginTop: 0 }}>{draft.blocked}</p>
          <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 14 }}>
            Nothing downstream is shown. A plan built on unresolved connectivity would look specific and be
            electrically wrong, which is worse than no plan.
          </p>
          {p.files.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead><tr><th>File</th><th>Kind</th><th>Bytes</th><th>SHA-256</th></tr></thead>
                <tbody>
                  {p.files.map((f) => (
                    <tr key={f.name}>
                      <td><code>{f.name}</code></td><td>{f.kind}</td><td className="pin-cell">{f.size}</td>
                      <td className="pin-cell">{f.hash || "n/a"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="draft-head">
        <div>
          <span className="label">Draft</span>
          <h3>
            {p.projectName}
            {p.revision && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> rev {p.revision}</span>}
          </h3>
          <p>
            {p.company ? `${p.company} · ` : ""}
            {draft.connectivity.pinsOnNet}/{draft.connectivity.pinsTotal} pins on a net ·{" "}
            {draft.tests.filter((t) => t.review !== "unreviewed").length} of {draft.tests.length} steps reviewed
          </p>
        </div>
        <div className="export-row">
          <button className="btn btn-sm" onClick={() => onExport("json")}>JSON</button>
          <button className="btn btn-sm" onClick={() => onExport("csv")}>Plan</button>
          <button className="btn btn-sm" onClick={() => onExport("coverage")}>Coverage</button>
          <button className="btn btn-sm" onClick={() => onExport("pinout")}>Pinout</button>
          <button className="btn btn-sm" onClick={() => onExport("pytest")}>pytest</button>
          <button className="btn btn-primary btn-sm" onClick={() => onExport("md")}>Export spec</button>
        </div>
      </div>

      {p.revisionConflict && (
        <p className="notice warn" style={{ margin: 16 }}>
          <strong>Revision conflict.</strong> {p.revisionConflict}
        </p>
      )}
      {infeasible.length > 0 && (
        <p className="notice warn" style={{ margin: 16, marginTop: p.revisionConflict ? 0 : 16 }}>
          <strong>{infeasible.length} step{infeasible.length === 1 ? "" : "s"} cannot run on the proposed fixture.</strong>{" "}
          {infeasible.map((t) => t.id).join(", ")}. Add the missing contacts or drop the steps.
        </p>
      )}

      <div className="metrics">
        <div className="metric"><span>Steps</span><strong>{active.length}</strong></div>
        <div className="metric">
          <span>Behaviours covered</span>
          <strong>{coveragePct}<small>%</small></strong>
        </div>
        <div className="metric"><span>Open questions</span><strong>{draft.openQuestions.length}</strong></div>
        <div className="metric"><span>Risks</span><strong>{draft.risks.length}</strong></div>
      </div>

      <div className="tabs" role="tablist">
        {([
          ["sequence", "Sequence", active.length],
          ["coverage", "Coverage", uncovered.length],
          ["fixture", "Fixture", draft.fixture.length],
          ["subsystems", "Subsystems", draft.subsystems.filter((s) => s.present).length],
          ["questions", "Questions", draft.openQuestions.length],
          ["sources", "Sources", draft.parts.length],
        ] as [Tab, string, number][]).map(([key, title, count]) => (
          <button key={key} role="tab" aria-selected={tab === key}
            className={`tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
            {title} <b>{count}</b>
          </button>
        ))}
      </div>

      <div className="tab-body">
        {tab === "sequence" && (
          <div className="steps">
            {draft.tests.map((t, i) => (
              <StepCard key={t.id} test={t} index={i} expanded={open === t.id}
                onToggle={() => setOpen(open === t.id ? null : t.id)}
                onUpdate={(patch) => onUpdateTest(t.id, patch)} />
            ))}
          </div>
        )}

        {tab === "coverage" && (
          <>
            <div className="coverage-top">
              <div><div className="coverage-pct">{coveragePct}<small>%</small></div></div>
              <div>
                <strong style={{ fontSize: 14 }}>
                  {draft.coverage.covered} of {draft.coverage.total} required behaviours covered
                </strong>
                <div className="coverage-bar">
                  <span className="coverage-fill" style={{ width: `${draft.coverage.percent}%`, transition: "width 800ms cubic-bezier(0.16,1,0.3,1)" }} />
                </div>
                <p style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 8 }}>{draft.coverage.basis}</p>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Req</th><th>Subsystem</th><th>Behaviour</th><th>Basis</th><th>Covered by</th><th>Why it is required</th></tr>
                </thead>
                <tbody>
                  {draft.coverage.rows.map((r) => (
                    <tr key={r.requirementId}>
                      <td className="pin-cell">{r.requirementId}</td>
                      <td>{SUBSYSTEM_LABEL[r.subsystem]}</td>
                      <td>{r.behaviour}</td>
                      <td><EvidenceBadge evidenceClass={r.evidenceClass} /></td>
                      <td className="pin-cell" style={{ color: r.covered ? "var(--ok)" : "var(--danger)" }}>
                        {r.byTests.join(" ") || "nothing"}
                      </td>
                      <td style={{ color: "var(--text-dim)" }}>{r.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {draft.coverage.excluded.length > 0 && (
              <>
                <h4 style={{ fontSize: 13, margin: "18px 0 8px" }}>
                  Excluded from the denominator ({draft.coverage.excluded.length})
                </h4>
                <div className="cov-grid">
                  {draft.coverage.excluded.map((e) => (
                    <div className="cov-cell excluded" key={e.ref} title={e.reason}>
                      <span className="cov-ref">{e.ref}</span>
                      <span className="cov-value">{e.reason}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "fixture" && (
          <>
            <p className="notice">
              A contact is only listed as reachable when a pad or untented via on that net exists in the PCB.
              Nothing here is inferred from a schematic net.
            </p>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr><th>Pin</th><th>Net</th><th>Access</th><th>Side</th><th>Location (mm)</th><th>Confidence</th><th>Basis</th></tr>
                </thead>
                <tbody>
                  {draft.fixture.map((f) => (
                    <tr key={f.id}>
                      <td className="pin-cell">{String(f.id).padStart(2, "0")}</td>
                      <td><code>{f.net}</code></td>
                      <td>{f.access.kind}{f.access.ref ? ` ${f.access.ref}.${f.access.pad}` : ""}</td>
                      <td>{f.access.side ?? "n/a"}</td>
                      <td className="pin-cell">{f.access.x !== undefined ? `${f.access.x}, ${f.access.y}` : "n/a"}</td>
                      <td style={{ color: f.access.confidence === "pcb-confirmed" ? "var(--ok)" : "var(--danger)" }}>
                        {f.access.confidence}
                      </td>
                      <td style={{ color: "var(--text-dim)" }}>{f.access.reason}</td>
                    </tr>
                  ))}
                  {!draft.fixture.length && (
                    <tr><td colSpan={7} style={{ color: "var(--text-dim)" }}>
                      No fixture contacts required: every step runs through the product's own interfaces.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "subsystems" && (
          <div className="risks">
            {draft.subsystems.map((s) => (
              <article className="risk" key={s.id}>
                <span className={`risk-level ${s.present ? "medium" : "high"}`}>{s.present ? "present" : "absent"}</span>
                <div>
                  <h4>{s.label} <EvidenceBadge evidenceClass={s.evidenceClass} /></h4>
                  <p>{s.detail}</p>
                  {s.parts.length > 0 && (
                    <span className="covers">{s.parts.map((r) => <span className="ref-tag" key={r}>{r}</span>)}</span>
                  )}
                  {s.evidence.length > 0 && <div style={{ marginTop: 8 }}><EvidenceChips evidence={s.evidence} /></div>}
                </div>
              </article>
            ))}
          </div>
        )}

        {tab === "questions" && (
          <>
            <p className="notice warn">
              These are the things the design files cannot answer. Every one of them needs the customer before
              this plan is complete.
            </p>
            <div className="risks" style={{ marginTop: 12 }}>
              {draft.openQuestions.map((q) => (
                <article className="risk" key={q}>
                  <span className="risk-level high">ask</span>
                  <div><p style={{ marginBottom: 0 }}>{q}</p></div>
                </article>
              ))}
              {!draft.openQuestions.length && <p style={{ color: "var(--text-dim)" }}>Nothing outstanding.</p>}
            </div>

            <h4 style={{ fontSize: 14, margin: "20px 0 10px" }}>Risks ({draft.risks.length})</h4>
            <div className="risks">
              {draft.risks.map((r) => (
                <article className="risk" key={r.id}>
                  <span className={`risk-level ${r.level}`}>{r.level}</span>
                  <div>
                    <h4>{r.title}</h4>
                    <p>{r.detail}</p>
                    <div className="risk-action"><b>Next</b>{r.action}</div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {tab === "sources" && (
          <>
            <div className="source-note">
              <strong>Provenance</strong>
              <ul>
                <li>Project name and revision taken from the design files, not from any earlier run.</li>
                {p.files.map((f) => (
                  <li key={f.name}>{f.name} · {f.kind} · {f.size} bytes{f.hash ? ` · sha256:${f.hash}` : ""}</li>
                ))}
              </ul>
            </div>
            {draft.sourceNotes.map((n) => (
              <div className="source-note" key={n.file}>
                <strong>{n.file}</strong>
                <ul>{n.messages.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            ))}

            <h4 style={{ fontSize: 14, margin: "20px 0 10px" }}>Parts ({draft.parts.length})</h4>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Ref</th><th>Value</th><th>Class</th><th>Subsystem</th><th>Pins</th><th>Source</th></tr></thead>
                <tbody>
                  {draft.parts.map((part) => (
                    <tr key={part.ref}>
                      <td><code>{part.ref}</code></td>
                      <td>{part.value}</td>
                      <td style={{ color: part.excludedReason ? "var(--text-faint)" : undefined }}>
                        {part.klass}{part.excludedReason ? " (excluded)" : ""}
                      </td>
                      <td>{SUBSYSTEM_LABEL[part.subsystem]}</td>
                      <td className="pin-cell">{part.pins.length}</td>
                      <td><EvidenceChips evidence={part.evidence} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 style={{ fontSize: 14, margin: "20px 0 10px" }}>Nets ({draft.nets.length})</h4>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Net</th><th>Class</th><th>Named</th><th>Nodes</th></tr></thead>
                <tbody>
                  {draft.nets.slice(0, 80).map((n) => (
                    <tr key={n.name}>
                      <td><code>{n.name}</code></td>
                      <td>{NET_CLASS_LABEL[n.klass]}</td>
                      <td className="pin-cell">{n.named ? "label" : "auto"}</td>
                      <td className="pin-cell">{n.nodes.map((x) => `${x.ref}.${x.pin}`).join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

const REVIEW_ACTIONS: [ReviewStatus, string][] = [
  ["accepted", "Looks right"],
  ["flagged", "Needs change"],
  ["rejected", "Drop it"],
];

function StepCard({
  test, index, expanded, onToggle, onUpdate,
}: {
  test: TestStep; index: number; expanded: boolean;
  onToggle: () => void; onUpdate: (patch: Partial<TestStep>) => void;
}) {
  const fields: [keyof TestStep, string][] = [
    ["access", "Access"],
    ["stimulus", "Procedure"],
    ["expected", "Expected"],
    ["instrument", "Equipment"],
  ];

  return (
    <article className={`step ${test.review} ${test.feasible ? "" : "infeasible"}`}
      style={{ animationDelay: `${Math.min(index, 14) * 26}ms` }}>
      <div className="step-top">
        <span className="step-id">{test.id}</span>
        <div className="step-main">
          <div className="step-title">
            <h4>{test.name}</h4>
            <EvidenceBadge evidenceClass={test.evidenceClass} />
            <StandingBadge standing={test.standing} />
            <ConfidenceBadge confidence={test.confidence} />
            {!test.feasible && <span className="badge unresolved">fixture cannot run</span>}
            {test.edited && <span className="badge">edited</span>}
          </div>
          <p className="step-purpose">{test.purpose}</p>
        </div>
        <button className="step-toggle" onClick={onToggle} aria-expanded={expanded}>{expanded ? "−" : "+"}</button>
      </div>

      {expanded && (
        <div className="step-detail">
          <dl style={{ display: "grid", gap: 9 }}>
            <div className="kv"><dt>Subsystem</dt><dd>{SUBSYSTEM_LABEL[test.subsystem]}</dd></div>
            {fields.map(([key, label]) => (
              <div className="kv" key={key}>
                <dt>{label}</dt>
                <dd>
                  <input value={String(test[key] ?? "")} aria-label={`${label} for ${test.id}`}
                    onChange={(e) => onUpdate({ [key]: e.target.value, edited: true })} />
                </dd>
              </div>
            ))}
            <div className="kv">
              <dt>Fixture</dt>
              <dd style={{ color: test.feasible ? "var(--ok)" : "var(--danger)" }}>{test.feasibilityNote}</dd>
            </div>
            <div className="kv"><dt>Evidence</dt><dd><EvidenceChips evidence={test.evidence} /></dd></div>
            {test.satisfies.length > 0 && (
              <div className="kv"><dt>Satisfies</dt><dd>
                <span className="covers">{test.satisfies.map((r) => <span className="ref-tag" key={r}>{r}</span>)}</span>
              </dd></div>
            )}
            {test.covers.length > 0 && (
              <div className="kv"><dt>Covers</dt><dd>
                <span className="covers">{test.covers.map((r) => <span className="ref-tag" key={r}>{r}</span>)}</span>
              </dd></div>
            )}
            {test.assumptions.map((a) => (
              <div className="kv" key={a}><dt>Assumption</dt><dd style={{ color: "var(--text-dim)" }}>{a}</dd></div>
            ))}
            {test.openQuestions.map((q) => (
              <div className="kv" key={q}><dt>Open</dt><dd style={{ color: "var(--warn)" }}>{q}</dd></div>
            ))}
            <div className="kv">
              <dt>Note</dt>
              <dd>
                <input value={test.note ?? ""} placeholder="What's wrong with this step?"
                  aria-label={`Reviewer note for ${test.id}`}
                  onChange={(e) => onUpdate({ note: e.target.value })} />
              </dd>
            </div>
          </dl>

          <div className="step-actions">
            {REVIEW_ACTIONS.map(([status, text]) => (
              <button key={status}
                className={`review-btn ${test.review === status ? `on-${status}` : ""}`}
                onClick={() => onUpdate({ review: test.review === status ? "unreviewed" : status })}>
                {text}
              </button>
            ))}
            <span className="spacer" />
            <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{test.ruleId}</span>
          </div>
        </div>
      )}
    </article>
  );
}
