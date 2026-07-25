import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { SourceFile, SourceKind, StoredProject } from "../lib/types";
import { formatBytes } from "./bits";

const KIND_LABEL: Record<SourceKind, string> = {
  "kicad-sch": "SCH",
  "kicad-net": "NET",
  "bom-csv": "BOM",
  "netlist-txt": "NET",
  requirements: "REQ",
  json: "JSON",
  unknown: "??",
};

interface Props {
  projectName: string;
  onProjectName: (value: string) => void;
  files: SourceFile[];
  onAddFiles: (list: FileList | File[]) => void;
  onRemoveFile: (name: string) => void;
  requirements: string;
  onRequirements: (value: string) => void;
  onGenerate: () => void;
  onLoadSample: () => void;
  notice: { text: string; tone: "info" | "warn" } | null;
  projects: StoredProject[];
  onOpenProject: (project: StoredProject) => void;
  onDeleteProject: (id: string) => void;
}

export default function InputPanel({
  projectName,
  onProjectName,
  files,
  onAddFiles,
  onRemoveFile,
  requirements,
  onRequirements,
  onGenerate,
  onLoadSample,
  notice,
  projects,
  onOpenProject,
  onDeleteProject,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) onAddFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    onAddFiles(event.dataTransfer.files);
  }

  return (
    <section className="panel" aria-labelledby="input-heading">
      <div className="panel-head">
        <div>
          <span className="label">Input</span>
          <h3 id="input-heading">Board evidence</h3>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onLoadSample}>
          Load sample
        </button>
      </div>

      <div className="panel-body">
        {projects.length > 0 && (
          <div className="field">
            <span className="field-label">Saved on this machine</span>
            <div className="projects">
              {projects.slice(0, 4).map((project) => (
                <div className="project-row" key={project.id}>
                  <button className="open" onClick={() => onOpenProject(project)}>
                    <strong>{project.projectName}</strong>
                    <small>
                      {new Date(project.savedAt).toLocaleDateString()} · {project.files.length} file
                      {project.files.length === 1 ? "" : "s"}
                    </small>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => onDeleteProject(project.id)}
                    aria-label={`Delete ${project.projectName}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="project-name">
            Project
          </label>
          <input
            id="project-name"
            type="text"
            value={projectName}
            onChange={(event) => onProjectName(event.target.value)}
            placeholder="Motor controller rev B"
          />
        </div>

        <div className="field">
          <span className="field-label">Design files</span>
          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => input.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                input.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Add design files"
          >
            <input
              ref={input}
              className="file-input"
              type="file"
              multiple
              accept=".csv,.tsv,.txt,.md,.net,.json,.kicad_sch,.kicad_net"
              onChange={handleChange}
            />
            <span className="dropzone-plus">+</span>
            <strong>Drop a netlist, BOM or schematic</strong>
            <span>.net, .kicad_sch, .csv, .txt</span>
            <small>stays in this browser · 4 MB each</small>
          </div>

          {files.length > 0 && (
            <div className="filelist">
              {files.map((file) => (
                <div className="filerow" key={file.name}>
                  <span className={`filerow-kind ${file.kind === "unknown" ? "" : "ok"}`}>
                    {KIND_LABEL[file.kind]}
                  </span>
                  <div className="filerow-main">
                    <strong>{file.name}</strong>
                    <small>{formatBytes(file.size)}</small>
                  </div>
                  <button onClick={() => onRemoveFile(file.name)} aria-label={`Remove ${file.name}`}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="requirements">
            What has to work
          </label>
          <textarea
            id="requirements"
            value={requirements}
            onChange={(event) => onRequirements(event.target.value)}
            placeholder={
              "One requirement per line. Numbers get pulled out as pass/fail limits:\n\nThe 3V3 rail must stay between 3.20 V and 3.40 V.\nThe IMU must return a WHO_AM_I of 0x47.\nTest time must be under 60 seconds."
            }
            rows={9}
          />
        </div>

        <button className="btn btn-primary btn-block" onClick={onGenerate}>
          Generate draft <span aria-hidden="true">→</span>
        </button>

        {notice && <p className={`notice ${notice.tone === "warn" ? "warn" : ""}`} role="status">{notice.text}</p>}
      </div>
    </section>
  );
}
