import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { SourceFile, StoredProject } from "../lib/types";
import { KIND_LABEL } from "../lib/parse";
import { formatBytes } from "./bits";

interface Props {
  projectHint: string;
  onProjectHint: (v: string) => void;
  files: SourceFile[];
  onAddFiles: (list: FileList | File[]) => void;
  onRemoveFile: (name: string) => void;
  requirementsText: string;
  onRequirementsText: (v: string) => void;
  onGenerate: () => void;
  onStartFresh: () => void;
  notice: { text: string; tone: "info" | "warn" } | null;
  projects: StoredProject[];
  onOpenProject: (p: StoredProject) => void;
  onDeleteProject: (id: string) => void;
}

export default function InputPanel({
  projectHint, onProjectHint, files, onAddFiles, onRemoveFile,
  requirementsText, onRequirementsText, onGenerate, onStartFresh,
  notice, projects, onOpenProject, onDeleteProject,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const hasSchematic = files.some((f) => f.kind === "kicad-sch");
  const hasPcb = files.some((f) => f.kind === "kicad-pcb");

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) onAddFiles(e.target.files);
    e.target.value = "";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    onAddFiles(e.dataTransfer.files);
  }

  return (
    <section className="panel" aria-labelledby="input-heading">
      <div className="panel-head">
        <div>
          <span className="label">Input</span>
          <h3 id="input-heading">Design files</h3>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onStartFresh}>Clear</button>
      </div>

      <div className="panel-body">
        {projects.length > 0 && (
          <div className="field">
            <span className="field-label">Saved on this machine</span>
            <div className="projects">
              {projects.slice(0, 4).map((p) => (
                <div className="project-row" key={p.id}>
                  <button className="open" onClick={() => onOpenProject(p)}>
                    <strong>{p.projectName}</strong>
                    <small>{new Date(p.savedAt).toLocaleDateString()} · {p.files.length} files</small>
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => onDeleteProject(p.id)}
                    aria-label={`Delete ${p.projectName}`}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span className="field-label">Design files</span>
          <div className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
            role="button" tabIndex={0} aria-label="Add design files">
            <input ref={input} className="file-input" type="file" multiple
              accept=".csv,.tsv,.txt,.md,.net,.json,.kicad_sch,.kicad_pcb,.kicad_pro,.kicad_prl"
              onChange={handleChange} />
            <span className="dropzone-plus">+</span>
            <strong>Drop the KiCad project</strong>
            <span>.kicad_sch required · .kicad_pcb for access</span>
            <small>stays in this browser</small>
          </div>

          {files.length > 0 && (
            <div className="filelist">
              {files.map((f) => (
                <div className="filerow" key={f.name}>
                  <span className={`filerow-kind ${f.kind === "unknown" || f.kind === "ignored" ? "" : "ok"}`}>
                    {KIND_LABEL[f.kind]}
                  </span>
                  <div className="filerow-main">
                    <strong>{f.name}</strong>
                    <small>{formatBytes(f.size)}{f.hash ? ` · ${f.hash}` : ""}</small>
                  </div>
                  <button onClick={() => onRemoveFile(f.name)} aria-label={`Remove ${f.name}`}>×</button>
                </div>
              ))}
            </div>
          )}

          {files.length > 0 && (
            <p className="notice" style={{ marginTop: 10 }}>
              {hasSchematic ? "Schematic present." : "No schematic yet; connectivity cannot be rebuilt without one."}{" "}
              {hasPcb ? "PCB present, so probe access will be confirmed." : "No PCB, so physical access will be reported as unconfirmed."}
            </p>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="project-hint">Project name (only if the files carry none)</label>
          <input id="project-hint" type="text" value={projectHint}
            onChange={(e) => onProjectHint(e.target.value)} placeholder="Taken from the schematic title block" />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="requirements">What has to work</label>
          <textarea id="requirements" value={requirementsText} rows={8}
            onChange={(e) => onRequirementsText(e.target.value)}
            placeholder={"One requirement per line. Numbers become pass/fail limits:\n\nThe 3V3 rail must stay between 3.20 V and 3.40 V.\nEvery key sends its assigned MIDI note.\nBLE must be working at shipment."} />
        </div>

        <button className="btn btn-primary btn-block" onClick={onGenerate}>
          Generate draft <span aria-hidden="true">→</span>
        </button>

        {notice && <p className={`notice ${notice.tone === "warn" ? "warn" : ""}`} role="status">{notice.text}</p>}
      </div>
    </section>
  );
}
