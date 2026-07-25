import { useState } from "react";
import type { Draft, ReviewStatus, TestStep } from "../lib/types";
import { NET_CLASS_LABEL, PART_CLASS_LABEL } from "../lib/classify";
import { BasisBadge, ConfidenceBadge, EvidenceChips, Gauge, useCountUp } from "./bits";

type Tab = "sequence" | "interface" | "coverage" | "risks" | "sources";

interface Props {
  draft: Draft;
  onUpdateTest: (id: string, patch: Partial<TestStep>) => void;
  onExport: (format: "md" | "json" | "csv" | "pinout" | "pytest") => void;
  sourceNotes: { file: string; messages: string[] }[];
}

export default function DraftView({ draft, onUpdateTest, onExport, sourceNotes }: Props) {
  const [tab, setTab] = useState<Tab>("sequence");
  const [open, setOpen] = useState<string | null>(draft.tests[0]?.id ?? null);

  const active = draft.tests.filter((t) => t.review !== "rejected");
  const reviewed = draft.tests.filter((t) => t.review !== "unreviewed").length;
  const corrections = draft.tests.filter((t) => t.edited || t.review === "flagged" || t.review === "rejected").length;

  const cycle = useCountUp(draft.estCycleSeconds);
  const coveragePct = useCountUp(draft.coverage.percent);
  const uncovered = draft.coverage.entries.filter((e) => !e.covered && !e.reason);

  return (
    <section className="panel" aria-labelledby="draft-heading">
      <div className="draft-head">
        <div>
          <span className="label">Draft · rev 0</span>
          <h3 id="draft-heading">{draft.projectName}</h3>
          <p>
            {draft.readiness.label} · {reviewed} of {draft.tests.length} steps reviewed
            {corrections > 0 && ` · ${corrections} correction${corrections === 1 ? "" : "s"} recorded`}
          </p>
        </div>
        <div className="export-row">
          <button className="btn btn-sm" onClick={() => onExport("json")} title="Full structured handoff">
            JSON
          </button>
          <button className="btn btn-sm" onClick={() => onExport("csv")} title="Test plan as a spreadsheet">
            Plan CSV
          </button>
          <button className="btn btn-sm" onClick={() => onExport("pinout")} title="Fixture pinout for a vendor">
            Pinout
          </button>
          <button className="btn btn-sm" onClick={() => onExport("pytest")} title="Runnable pytest skeleton">
            pytest
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => onExport("md")}>
            Export spec
          </button>
        </div>
      </div>

      <div className="metrics">
        <div className="metric">
          <span>Steps</span>
          <strong>{active.length}</strong>
        </div>
        <div className="metric">
          <span>Coverage</span>
          <strong>
            {coveragePct}
            <small>%</small>
          </strong>
        </div>
        <div className="metric">
          <span>Est. cycle</span>
          <strong>
            {cycle}
            <small>s</small>
          </strong>
        </div>
        <div className="metric">
          <span>Open risks</span>
          <strong>{draft.risks.length}</strong>
        </div>
      </div>

      <div className="readiness">
        <Gauge score={draft.readiness.score} />
        <div className="factors">
          {draft.readiness.factors.map((factor) => (
            <div className="factor" key={factor.label}>
              <span className="factor-name">{factor.label}</span>
              <span className="factor-track">
                <span
                  className="factor-fill"
                  style={{
                    width: `${(factor.score / factor.max) * 100}%`,
                    transition: "width 800ms cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              </span>
              <span className="factor-score">
                {factor.score}/{factor.max}
              </span>
              <span className="factor-detail">{factor.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ["sequence", "Sequence", active.length],
            ["interface", "Fixture", draft.interfaceRows.length],
            ["coverage", "Coverage", uncovered.length],
            ["risks", "Risks", draft.risks.length],
            ["sources", "Sources", draft.limits.length],
          ] as [Tab, string, number][]
        ).map(([key, title, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {title} <b>{count}</b>
          </button>
        ))}
      </div>

      <div className="tab-body">
        {tab === "sequence" && (
          <div className="steps">
            {draft.tests.map((test, index) => (
              <StepCard
                key={test.id}
                test={test}
                index={index}
                expanded={open === test.id}
                onToggle={() => setOpen(open === test.id ? null : test.id)}
                onUpdate={(patch) => onUpdateTest(test.id, patch)}
              />
            ))}
          </div>
        )}

        {tab === "interface" && (
          <>
            <p className="notice">
              Suggested fixture pinout. Ground gets two contacts by convention; pin numbers are sequential,
              not tied to a connector part yet.
            </p>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Pin</th>
                    <th>Signal</th>
                    <th>Role</th>
                    <th>Instrument</th>
                    <th>Proposed path</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.interfaceRows.map((row) => (
                    <tr key={`${row.pin}-${row.signal}`}>
                      <td className="pin-cell">{String(row.pin).padStart(2, "0")}</td>
                      <td>
                        <code>{row.signal}</code>
                      </td>
                      <td>{row.role}</td>
                      <td>{row.instrument}</td>
                      <td>{row.fixturePath}</td>
                      <td>
                        <EvidenceChips evidence={row.evidence} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "coverage" && (
          <>
            <div className="coverage-top">
              <div>
                <div className="coverage-pct">
                  {coveragePct}
                  <small>%</small>
                </div>
              </div>
              <div>
                <strong style={{ fontSize: 14 }}>
                  {draft.coverage.coveredCount} of {draft.coverage.testablePartCount} testable parts are
                  exercised
                </strong>
                <div className="coverage-bar">
                  <span
                    className="coverage-fill"
                    style={{
                      width: `${draft.coverage.percent}%`,
                      transition: "width 800ms cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  />
                </div>
                <p style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 8 }}>
                  Passives and test points are left out of the denominator on purpose. Nobody probes every
                  decoupling cap, and counting them would make this number meaningless.
                </p>
              </div>
            </div>

            {uncovered.length > 0 && (
              <p className="notice warn">
                {uncovered.length} part{uncovered.length === 1 ? "" : "s"} nothing touches:{" "}
                {uncovered.map((e) => e.ref).join(", ")}. A board with one of these dead would pass this
                sequence.
              </p>
            )}

            <div className="cov-grid" style={{ marginTop: 14 }}>
              {draft.coverage.entries.map((entry) => (
                <div
                  className={`cov-cell ${entry.reason ? "excluded" : entry.covered ? "" : "uncovered"}`}
                  key={entry.ref}
                  title={entry.reason ?? (entry.covered ? `Covered by ${entry.byTests.join(", ")}` : "Not covered")}
                >
                  <span className="cov-ref">
                    <i className={`dot ${entry.reason ? "warn" : entry.covered ? "pass" : "fail"}`} />
                    {entry.ref}
                  </span>
                  <span className="cov-value">{entry.value || PART_CLASS_LABEL[entry.klass]}</span>
                  <span className={`cov-tests ${!entry.covered && !entry.reason ? "missing" : ""}`}>
                    {entry.reason ? "excluded" : entry.covered ? entry.byTests.join(" ") : "no test"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "risks" && (
          <div className="risks">
            {draft.risks.map((risk) => (
              <article className="risk" key={risk.id}>
                <span className={`risk-level ${risk.level}`}>{risk.level}</span>
                <div>
                  <h4>{risk.title}</h4>
                  <p>{risk.detail}</p>
                  <div className="risk-action">
                    <b>Next</b>
                    {risk.action}
                  </div>
                  {risk.evidence.length > 0 && (
                    <div style={{ marginTop: 9 }}>
                      <EvidenceChips evidence={risk.evidence} />
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {tab === "sources" && (
          <>
            {sourceNotes.map((note) => (
              <div className="source-note" key={note.file}>
                <strong>{note.file}</strong>
                <ul>
                  {note.messages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ))}

            <h4 style={{ fontSize: 14, margin: "20px 0 10px" }}>
              Limits ({draft.limits.length})
            </h4>
            <div className="table-wrap">
              {draft.limits.length ? (
                draft.limits.map((limit, index) => (
                  <div className="limit-row" key={`${limit.parameter}-${index}`}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{limit.parameter}</div>
                      {limit.note && (
                        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>
                          {limit.note}
                        </div>
                      )}
                      <div style={{ marginTop: 5 }}>
                        <EvidenceChips evidence={limit.evidence} />
                      </div>
                    </div>
                    <span className="limit-value">
                      {limit.min !== undefined && limit.max !== undefined
                        ? `${limit.min}–${limit.max} ${limit.unit}`
                        : limit.max !== undefined
                          ? `≤ ${limit.max} ${limit.unit}`
                          : limit.min !== undefined
                            ? `≥ ${limit.min} ${limit.unit}`
                            : limit.nominal !== undefined
                              ? `${limit.nominal} ${limit.unit}`
                              : "n/a"}
                    </span>
                    <BasisBadge basis={limit.basis} />
                  </div>
                ))
              ) : (
                <p style={{ padding: 14, fontSize: 13, color: "var(--text-dim)" }}>
                  No measurable limits found. Add requirement lines with numbers and units.
                </p>
              )}
            </div>

            <h4 style={{ fontSize: 14, margin: "22px 0 10px" }}>
              Nets read ({draft.nets.length})
            </h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Net</th>
                    <th>Class</th>
                    <th>Nodes</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.nets.map((net) => (
                    <tr key={net.name}>
                      <td>
                        <code>{net.name}</code>
                      </td>
                      <td>{NET_CLASS_LABEL[net.klass]}</td>
                      <td className="pin-cell">
                        {net.nodes.length
                          ? net.nodes.map((n) => `${n.ref}.${n.pin}`).join(" ")
                          : "name only"}
                      </td>
                      <td>
                        <EvidenceChips evidence={net.evidence.slice(0, 2)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="callout">
        <div>
          <span className="label">The step that actually matters</span>
          <h4>Give this to an engineer and ask them to break it.</h4>
          <p>
            Every claim above points at the line it came from, so a reviewer can check the reasoning instead
            of taking it on faith. The corrections they make are the useful output.
          </p>
        </div>
        <button className="btn" onClick={() => onExport("md")}>
          Export for review
        </button>
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
  test,
  index,
  expanded,
  onToggle,
  onUpdate,
}: {
  test: TestStep;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<TestStep>) => void;
}) {
  const editable: [keyof TestStep, string][] = [
    ["access", "Access"],
    ["stimulus", "Stimulus"],
    ["expected", "Pass"],
    ["instrument", "Tool"],
  ];

  return (
    <article className={`step ${test.review}`} style={{ animationDelay: `${Math.min(index, 14) * 26}ms` }}>
      <div className="step-top">
        <span className="step-id">{test.id}</span>
        <div className="step-main">
          <div className="step-title">
            <h4>{test.name}</h4>
            <BasisBadge basis={test.basis} />
            <ConfidenceBadge confidence={test.confidence} />
            {test.edited && <span className="badge">edited</span>}
            {test.userAdded && <span className="badge">added</span>}
          </div>
          <p className="step-purpose">{test.purpose}</p>
        </div>
        <button className="step-toggle" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? "−" : "+"}
        </button>
      </div>

      {expanded && (
        <div className="step-detail">
          <dl style={{ display: "grid", gap: 9 }}>
            {editable.map(([key, label]) => (
              <div className="kv" key={key}>
                <dt>{label}</dt>
                <dd>
                  <input
                    value={String(test[key] ?? "")}
                    onChange={(event) => onUpdate({ [key]: event.target.value, edited: true })}
                    aria-label={`${label} for ${test.id}`}
                  />
                </dd>
              </div>
            ))}
            <div className="kv">
              <dt>Evidence</dt>
              <dd>
                <EvidenceChips evidence={test.evidence} />
              </dd>
            </div>
            {test.covers.length > 0 && (
              <div className="kv">
                <dt>Covers</dt>
                <dd>
                  <span className="covers">
                    {test.covers.map((ref) => (
                      <span className="ref-tag" key={ref}>
                        {ref}
                      </span>
                    ))}
                  </span>
                </dd>
              </div>
            )}
            <div className="kv">
              <dt>Note</dt>
              <dd>
                <input
                  value={test.note ?? ""}
                  placeholder="What's wrong with this step?"
                  onChange={(event) => onUpdate({ note: event.target.value })}
                  aria-label={`Reviewer note for ${test.id}`}
                />
              </dd>
            </div>
          </dl>

          <div className="step-actions">
            {REVIEW_ACTIONS.map(([status, text]) => (
              <button
                key={status}
                className={`review-btn ${test.review === status ? `on-${status}` : ""}`}
                onClick={() => onUpdate({ review: test.review === status ? "unreviewed" : status })}
              >
                {text}
              </button>
            ))}
            <span className="spacer" />
            <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
              ~{test.estSeconds}s · {test.ruleId}
            </span>
          </div>
        </div>
      )}
    </article>
  );
}
