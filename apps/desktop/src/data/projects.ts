/**
 * Typed projects API — mirrors the vanilla app/project-registry.js, but with
 * narrowed types. Thin stateless wrappers over window.ccui.* (main-process IPC),
 * so bundling a copy into the island is safe (state lives in main, not here).
 */

export interface ProjectEntry {
  path: string
  name?: string
  pinned?: boolean
  lastOpened?: number
}

export interface ProjectsState {
  current: string
  recent?: ProjectEntry[]
}

export interface SwitchResult {
  ok: boolean
  error?: string
  name?: string
  path?: string
}

export interface PickResult {
  ok: boolean
  path?: string
}

export interface ProjectInfo {
  graphStats?: { files: number; dirs: number }
  skills?: number
  agents?: number
  rules?: number
  mcp?: number
  gitBranch?: string
  hasClaudeMd?: boolean
  hasEnv?: boolean
}

export const projects = {
  getState: () => window.ccui.getProjects() as Promise<ProjectsState>,
  pickAndOpen: () => window.ccui.pickProject() as Promise<PickResult>,
  switch: (p: string) => window.ccui.switchProject(p) as Promise<SwitchResult>,
  pin: (p: string, pinned: boolean) => window.ccui.pinProject(p, pinned),
  remove: (p: string) => window.ccui.removeProject(p),
  openInExplorer: (p: string) => window.ccui.openInExplorer(p),
}

export function projectDisplayName(entry?: { name?: string; path?: string } | null): string {
  if (!entry) return '未选择项目'
  return entry.name || entry.path?.split(/[/\\]/).pop() || entry.path || 'Project'
}
