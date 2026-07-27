import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Scope from "./components/Scope";
import InputPanel from "./components/InputPanel";
import DraftView from "./components/DraftView";
import { buildDraft, recomputeTotals } from "./lib/analyze";
import { buildExport, download } from "./lib/export";
import { detectKind, mergeSources } from "./lib/parse";
import { SAMPLE_PROJECT_NAME, SAMPLE_REQUIREMENTS, sampleFiles } from "./lib/sample";
import { deleteProject, loadProjects, saveProject } from "./lib/storage";
import type { Draft, SourceFile, StoredProject, TestStep } from "./lib/types";

const MAX_BYTES = 4_000_000;
const ACCEPTED = /\.(csv|tsv|txt|md|net|json|kicad_sch|kicad_net)$/i;

type Notice = { text: string; tone: "info" | "warn" } | null;

export default function App() {
  const [projectName, setProjectName] = useState(SAMPLE_PROJECT_NAME);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [requirements, setRequirements] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const projectId = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    setProjects(loadProjects());
  }, []);

  const sourceNotes = useMemo(() => (files.length ? mergeSources(files).notes : []), [files]);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const incoming = Array.from(list).slice(0, 10);
    const usable = incoming.filter((file) => ACCEPTED.test(file.name) && file.size <= MAX_BYTES);

    const parsed = await Promise.all(
      usable.map(async (file) => {
        const text = await file.text();
        return { name: file.name, size: file.size, text, kind: detectKind(file.name, text) };
      }),
    );

    setFiles((current) => {
      const withoutDupes = current.filter((item) => !parsed.some((next) => next.name === item.name));
      return [...withoutDupes, ...parsed].slice(0, 10);
    });

    const skipped = incoming.length - usable.length;
    const unknown = parsed.filter((f) => f.kind === "unknown");
    if (skipped > 0) {
      setNotice({
        text: `Skipped ${skipped} file${skipped === 1 ? "" : "s"}. Text formats only, under 4 MB.`,
        tone: "warn",
      });
    } else if (unknown.length) {
      setNotice({
        text: `Couldn't work out what ${unknown.map((f) => f.name).join(", ")} is. It'll be ignored.`,
        tone: "warn",
      });
    } else if (parsed.length) {
      setNotice({ text: `Read ${parsed.length} file${parsed.length === 1 ? "" : "s"}.`, tone: "info" });
    }
  }, []);

  const removeFile = useCallback((name: string) => {
    setFiles((current) => current.filter((file) => file.name !== name));
  }, []);

  const loadSample = useCallback(() => {
    setProjectName(SAMPLE_PROJECT_NAME);
    setFiles(sampleFiles());
    setRequirements(SAMPLE_REQUIREMENTS);
    setDraft(null);
    projectId.current = crypto.randomUUID();
    setNotice({
      text: "Sample loaded: a KiCad netlist with pin-level connectivity, plus a BOM. Generate to see it worked through.",
      tone: "info",
    });
  }, []);

  const generate = useCallback(() => {
    if (!files.length) {
      setNotice({ text: "Add a design file first, or load the sample.", tone: "warn" });
      return;
    }
    const result = buildDraft({ projectName, files, requirements });
    setDraft(result);
    setNotice({
      text: `Done. ${result.tests.length} steps, ${result.risks.length} open risks. Nothing left this browser.`,
      tone: "info",
    });

    const stored: StoredProject = {
      id: projectId.current,
      projectName: result.projectName,
      savedAt: new Date().toISOString(),
      requirements,
      files,
      draft: result,
    };
    setProjects(saveProject(stored));

    window.setTimeout(() => {
      document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, [files, projectName, requirements]);

  const updateTest = useCallback((id: string, patch: Partial<TestStep>) => {
    setDraft((current) => {
      if (!current) return current;
      const tests = current.tests.map((test) => (test.id === id ? { ...test, ...patch } : test));
      const next = { ...current, tests };
      return { ...next, ...recomputeTotals(next) };
    });
  }, []);

  const handleExport = useCallback(
    (format: "md" | "json" | "csv" | "pinout" | "pytest") => {
      if (!draft) return;
      const file = buildExport(draft, format);
      download(file);
      setNotice({ text: `Saved ${file.filename}.`, tone: "info" });
    },
    [draft],
  );

  const openProject = useCallback((project: StoredProject) => {
    projectId.current = project.id;
    setProjectName(project.projectName);
    setFiles(project.files);
    setRequirements(project.requirements);
    setDraft(project.draft);
    setNotice({ text: `Opened ${project.projectName}.`, tone: "info" });
  }, []);

  const removeProject = useCallback((id: string) => {
    setProjects(deleteProject(id));
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <a className="brand" href="#top">
            <span className="brand-mark">TG</span>
            Tegen
          </a>
          <nav className="topbar-nav">
            <a href="#workspace">Workspace</a>
            <a href="#scope">Scope</a>
            <button className="btn btn-sm" onClick={loadSample}>
              Open sample
            </button>
          </nav>
        </div>
      </header>

      <main>
        <div className="shell">
          <section className="hero" id="top">
            <div>
              <span className="label">Production test planning</span>
              <h1>
                The test plan is already in your <em>netlist</em>.
              </h1>
              <p className="hero-lede">
                Tegen reads a KiCad export and drafts the production test sequence, the fixture
                pinout, and the list of parts nothing tests. Then it shows you the file and line behind
                every claim, so you can argue with it instead of trusting it.
              </p>
              <div className="hero-actions">
                <button className="btn btn-primary" onClick={loadSample}>
                  Run the sample board
                </button>
                <a className="btn" href="#workspace">
                  Use my own files
                </a>
              </div>
              <div className="hero-facts">
                <span>nothing uploaded</span>
                <span>evidence on every line</span>
                <span>exports to markdown, csv, pytest</span>
              </div>
            </div>
            <div id="scope">
              <Scope />
            </div>
          </section>
        </div>

        <div className="strip">
          <div>
            <strong>16</strong>
            <span>rules that read connectivity, rather than filling in a template</span>
          </div>
          <div>
            <strong>0</strong>
            <span>bytes uploaded, because there is no server in this project to send a design to</span>
          </div>
          <div>
            <strong>5</strong>
            <span>handoff formats, including a pytest skeleton with your limits already in it</span>
          </div>
          <div>
            <strong>3</strong>
            <span>labels on every claim: detected, inferred, or nobody has answered this yet</span>
          </div>
        </div>

        <div className="shell">
          <section className="section" id="workspace">
            <div className="section-head">
              <div>
                <span className="label">01 / Build the draft</span>
                <h2>Give it what you already have.</h2>
              </div>
              <p>
                A netlist is the useful one, because it carries which pin of which part every signal lands on, so
                the fixture map is read rather than guessed. A BOM and requirements text fill in the rest.
                Everything is parsed here in the page.
              </p>
            </div>

            <div className="workspace">
              <InputPanel
                projectName={projectName}
                onProjectName={setProjectName}
                files={files}
                onAddFiles={addFiles}
                onRemoveFile={removeFile}
                requirements={requirements}
                onRequirements={setRequirements}
                onGenerate={generate}
                onLoadSample={loadSample}
                notice={notice}
                projects={projects}
                onOpenProject={openProject}
                onDeleteProject={removeProject}
              />

              {draft ? (
                <DraftView
                  draft={draft}
                  onUpdateTest={updateTest}
                  onExport={handleExport}
                  sourceNotes={sourceNotes}
                />
              ) : (
                <section className="panel">
                  <div className="empty">
                    <div className="empty-steps">
                      <span>01</span>
                      <span>02</span>
                      <span>03</span>
                      <span>04</span>
                    </div>
                    <span className="label">Output</span>
                    <h3>Nothing generated yet</h3>
                    <p>
                      Load the sample board to see a worked example: an RP2040 with an I²C sensor, an SPI
                      IMU, CAN and USB-C. It comes back with real gaps in it: two parts nothing covers, and
                      one rail limit that had to be assumed.
                    </p>
                    <button className="btn btn-primary" onClick={loadSample}>
                      Load sample board
                    </button>
                  </div>
                </section>
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <div>
                <span className="label">02 / Scope</span>
                <h2>Useful before autonomous.</h2>
              </div>
              <p>
                The hard part of production test isn't drawing the fixture, it's deciding what proves a
                board can ship. This does the deciding badly enough that you'll correct it, and shows its
                work so correcting it is quick. The rest is deliberately left alone.
              </p>
            </div>

            <div className="boundary">
              <article className="in">
                <span className="boundary-tag">In</span>
                <h3>What it does</h3>
                <ul>
                  <li>Parses KiCad schematics, netlists and BOMs in the browser</li>
                  <li>Pulls numeric pass/fail limits out of written requirements</li>
                  <li>Drafts a test sequence from actual pin-level connectivity</li>
                  <li>Maps a fixture pinout and flags nets with no test point</li>
                  <li>Names the parts no step exercises</li>
                  <li>Records your corrections and exports them with the spec</li>
                </ul>
              </article>
              <article className="out">
                <span className="boundary-tag">Out</span>
                <h3>What it won't touch</h3>
                <ul>
                  <li>Fixture mechanics, Gerbers, probe force, tooling plates</li>
                  <li>Driving instruments or applying power to anything</li>
                  <li>Signing off RF, safety or regulatory limits</li>
                  <li>Deciding a board is good enough to ship</li>
                  <li>Storing your design anywhere outside this browser</li>
                </ul>
              </article>
            </div>
          </section>
        </div>

        <footer>
          <div className="shell footer-in">
            <div className="footer-brand">
              <span className="brand-mark">TG</span>
              <div>
                <strong>Tegen</strong>
                <span>Production test planning for small hardware teams</span>
              </div>
            </div>
            <p>
              Everything here is a draft. A qualified engineer owns the final limits, the safety case, and
              the decision to ship.
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}
