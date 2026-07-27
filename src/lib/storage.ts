/**
 * Local persistence.
 *
 * Everything stays in this browser. That isn't a marketing line — there is no
 * server in this project to send a design to even if we wanted one.
 */

import type { StoredProject } from "./types";

const KEY = "tegen.projects.v1";
const MAX_PROJECTS = 12;

function safeParse(raw: string | null): StoredProject[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as StoredProject[]) : [];
  } catch {
    return [];
  }
}

export function loadProjects(): StoredProject[] {
  if (typeof localStorage === "undefined") return [];
  return safeParse(localStorage.getItem(KEY)).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveProject(project: StoredProject): StoredProject[] {
  if (typeof localStorage === "undefined") return [];
  const existing = loadProjects().filter((p) => p.id !== project.id);
  const next = [project, ...existing].slice(0, MAX_PROJECTS);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded — drop the draft bodies and keep the inputs, which are
    // small and enough to regenerate from.
    const lean = next.map((p) => ({ ...p, draft: null }));
    try {
      localStorage.setItem(KEY, JSON.stringify(lean));
    } catch {
      return next;
    }
  }
  return next;
}

export function deleteProject(id: string): StoredProject[] {
  if (typeof localStorage === "undefined") return [];
  const next = loadProjects().filter((p) => p.id !== id);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearAll(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
}
