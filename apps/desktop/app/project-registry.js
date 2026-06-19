// 项目工作区 — 与主进程 projects-store 同步
export async function getProjectsState() {
  return window.ccui.getProjects()
}

export async function pickAndOpenProject() {
  return window.ccui.pickProject()
}

export async function switchProject(projectPath) {
  return window.ccui.switchProject(projectPath)
}

export async function pinProject(projectPath, pinned) {
  return window.ccui.pinProject(projectPath, pinned)
}

export async function removeProject(projectPath) {
  return window.ccui.removeProject(projectPath)
}

export async function openInExplorer(projectPath) {
  return window.ccui.openInExplorer(projectPath)
}

export function onProjectChanged(cb) {
  return window.ccui.onProjectChanged(cb)
}

export function projectDisplayName(entry) {
  if (!entry) return '未选择项目'
  return entry.name || entry.path?.split(/[/\\]/).pop() || entry.path || 'Project'
}
