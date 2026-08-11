import { useCallback, useEffect, useRef, useState } from "react";
import Scope from "./components/Scope";
import InputPanel from "./components/InputPanel";
import DraftView from "./components/DraftView";
import { buildDraft, recomputeCoverage } from "./lib/analyze";
import { buildExport, download, type ExportFormat } from "./lib/export";
import { detectKind, hashText } from "./lib/parse";
import { deleteProject, loadProjects, saveProject } from "./lib/storage";
import type { Draft, SourceFile, StoredProject, TestStep } from "./lib/types";

const MAX_BYTES = 12_000_000;
const ACCEPTED = /\.(csv|tsv|txt|md|net|json|kicad_sch|kicad_pcb|kicad_pro|kicad_prl)$/i;

type Notice = { text: string; tone: "info" | "warn" } | null;

export default function App() {
  const [projectHint, setProjectHint] = useState("");
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [requirementsText, setRequirementsText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const projectId = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    setProjects(loadProjects());
  }, []);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const incoming = Array.from(list).slice(0, 12);
    const usable = incoming.filter((f) => ACCEPTED.test(f.name) && f.size <= MAX_BYTES);

    const parsed: SourceFile[] = await Promise.all(
      usable.map(async (f) => {
        const text = await f.text();
        return { name: f.name, size: f.size, text, kind: detectKind(f.name, text), hash: await hashText(text) };
      }),
    );

    // New evidence invalidates any existing draft. Leaving the old one on
    // screen is how a report ends up describing the wrong board.
    setDraft(null);
    setFiles((current) => {
      const kept = current.filter((c) => !parsed.some((n) => n.name === c.name));
      return [...kept, ...parsed].slice(0, 12);
    });

    const skipped = incoming.length - usable.length;
    if (skipped > 0) {
      setNotice({ text: `Skipped ${skipped} file${skipped === 1 ? "" : "s"}. Text formats only, under 12 MB.`, tone: "warn" });
    } else if (parsed.length) {
      const kinds = parsed.map((f) => f.kind);
      setNotice({
        text: `Read ${parsed.length} file${parsed.length === 1 ? "" : "s"}.${kinds.includes("kicad-sch") ? "" : " No schematic yet, which is required."}`,
        tone: kinds.includes("kicad-sch") ? "info" : "warn",
      });
    }
  }, []);

  const removeFile = useCallback((name: string) => {
    setDraft(null);
    setFiles((current) => current.filter((f) => f.name !== name));
  }, []);

  const startFresh = useCallback(() => {
    projectId.current = crypto.randomUUID();
    setProjectHint("");
    setFiles([]);
    setRequirementsText("");
    setDraft(null);
    setNotice({ text: "Cleared. Nothing from the previous project is carried over.", tone: "info" });
  }, []);

  const generate = useCallback(() => {
    if (!files.length) {
      setNotice({ text: "Add a KiCad schematic first.", tone: "warn" });
      return;
    }
    const result = buildDraft({ projectNameHint: projectHint, files, requirementsText });
    setDraft(result);
    setNotice(
      result.blocked
        ? { text: "Analysis blocked. See the panel for why.", tone: "warn" }
        : {
            text: `Done. ${result.tests.length} steps for ${result.provenance.projectName}${result.provenance.revision ? ` rev ${result.provenance.revision}` : ""}. Nothing left this browser.`,
            tone: "info",
          },
    );

    setProjects(
      saveProject({
        id: projectId.current,
        projectName: result.provenance.projectName,
        savedAt: new Date().toISOString(),
        requirements: requirementsText,
        files,
        draft: result,
      }),
    );

    window.setTimeout(() => document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [files, projectHint, requirementsText]);

  const updateTest = useCallback((id: string, patch: Partial<TestStep>) => {
    setDraft((current) => {
      if (!current) return current;
      const tests = current.tests.map((t) => (t.id === id ? { ...t, ...patch } : t));
      const next = { ...current, tests };
      return { ...next, coverage: recomputeCoverage(next) };
    });
  }, []);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (!draft) return;
      const file = buildExport(draft, format);
      download(file);
      setNotice({ text: `Saved ${file.filename}.`, tone: "info" });
    },
    [draft],
  );

  const openProject = useCallback((project: StoredProject) => {
    projectId.current = project.id;
    setProjectHint(project.projectName);
    setFiles(project.files);
    setRequirementsText(project.requirements);
    setDraft(project.draft);
    setNotice({ text: `Opened ${project.projectName}.`, tone: "info" });
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <a className="brand" href="#top"><span className="brand-mark">TG</span>Tegen</a>
          <nav className="topbar-nav">
            <a href="#workspace">Workspace</a>
            <a href="#scope">Scope</a>
            <button className="btn btn-sm" onClick={startFresh}>New project</button>
          </nav>
        </div>
      </header>

      <main>
        <div className="shell">
          <section className="hero" id="top">
            <div>
              <span className="label">Production test planning</span>
              <h1>The test plan is already in your <em>schematic</em>.</h1>
              <p className="hero-lede">
                Tegen rebuilds the connectivity from a KiCad schematic, works out what the board actually
                does, and drafts the production test for it. Every claim says where it came from, and
                anything the files cannot answer is listed as a question rather than filled in.
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary" href="#workspace">Analyse a board</a>
              </div>
              <div className="hero-facts">
                <span>wires and junctions resolved to real nets</span>
                <span>nothing uploaded</span>
                <span>no invented limits</span>
              </div>
            </div>
            <div id="scope"><Scope /></div>
          </section>
        </div>

        <div className="strip">
          <div><strong>4</strong><span>evidence classes: detected, derived, documented, unresolved</span></div>
          <div><strong>0</strong><span>bytes uploaded, because there is no server in this project</span></div>
          <div><strong>PCB</strong><span>access confirmed from real pads and untented vias, never from a schematic net</span></div>
          <div><strong>0</strong><span>invented tolerances, cycle times or readiness scores</span></div>
        </div>

        <div className="shell">
          <section className="section" id="workspace">
            <div className="section-head">
              <div>
                <span className="label">01 / Build the draft</span>
                <h2>Give it the KiCad project.</h2>
              </div>
              <p>
                The schematic is required: connectivity is rebuilt from its wires and junctions. Add the
                .kicad_pcb and physical access gets confirmed from real copper instead of assumed. Local
                editor state (.kicad_prl) is ignored on purpose.
              </p>
            </div>

            <div className="workspace">
              <InputPanel
                projectHint={projectHint}
                onProjectHint={setProjectHint}
                files={files}
                onAddFiles={addFiles}
                onRemoveFile={removeFile}
                requirementsText={requirementsText}
                onRequirementsText={setRequirementsText}
                onGenerate={generate}
                onStartFresh={startFresh}
                notice={notice}
                projects={projects}
                onOpenProject={openProject}
                onDeleteProject={(id) => setProjects(deleteProject(id))}
              />

              {draft ? (
                <DraftView draft={draft} onUpdateTest={updateTest} onExport={handleExport} />
              ) : (
                <section className="panel">
                  <div className="empty">
                    <div className="empty-steps"><span>01</span><span>02</span><span>03</span><span>04</span></div>
                    <span className="label">Output</span>
                    <h3>Nothing generated yet</h3>
                    <p>
                      Drop a .kicad_sch in, with the .kicad_pcb alongside it if you have one. Connectivity is
                      rebuilt first; if that fails, you get told so rather than given a plan built on guesses.
                    </p>
                  </div>
                </section>
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <div>
                <span className="label">02 / Scope</span>
                <h2>It says what it doesn't know.</h2>
              </div>
              <p>
                A report that looks specific and is electrically wrong is worse than no report. Every number
                here traces to a source, and the questions the design files cannot answer are collected
                rather than papered over.
              </p>
            </div>

            <div className="boundary">
              <article className="in">
                <span className="boundary-tag">In</span>
                <h3>What it does</h3>
                <ul>
                  <li>Rebuilds pin-to-net connectivity from schematic wires and junctions</li>
                  <li>Derives facts like strapped I²C addresses, showing the reasoning</li>
                  <li>Groups the board into functional subsystems</li>
                  <li>Confirms probe access against real PCB pads and vias</li>
                  <li>Checks the fixture can actually run every step it proposes</li>
                  <li>Scores coverage against required behaviours, not part counts</li>
                </ul>
              </article>
              <article className="out">
                <span className="boundary-tag">Out</span>
                <h3>What it won't do</h3>
                <ul>
                  <li>Invent a tolerance, a cycle time or a readiness score</li>
                  <li>Claim fixture access the layout doesn't support</li>
                  <li>Carry a name, revision or finding over from another project</li>
                  <li>Call a step required when no requirement backs it</li>
                  <li>Continue downstream when connectivity fails to resolve</li>
                </ul>
              </article>
            </div>
          </section>
        </div>

        <footer>
          <div className="shell footer-in">
            <div className="footer-brand">
              <span className="brand-mark">TG</span>
              <div><strong>Tegen</strong><span>Production test planning for small hardware teams</span></div>
            </div>
            <p>Every output is a draft. A qualified engineer owns the final limits and the decision to ship.</p>
          </div>
        </footer>
      </main>
    </>
  );
}
