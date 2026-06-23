/**
 * 项目级配置 — `.ccui/project.yaml` + `.ccui/contrib.yaml`
 * daemon 启动时 merge 到 router / verify / disabledResources。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

export type ProjectConfig = {
  verify?: { onDone?: string[]; smoke?: string[] }
  router?: { mode?: string; strongModel?: string; weakModel?: string }
  disabledResources?: string[]
  dev?: { health?: string[] }
  pack?: { defaultApply?: string[] }
}

export type ContribConfig = {
  agents?: string[]
  skills?: string[]
  rules?: string[]
  mcp?: string[]
  hooks?: string[]
  verify?: string[]
}

async function readYamlFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    return parseYaml(raw) as T
  } catch {
    return null
  }
}

export async function loadProjectConfig(cwd: string): Promise<ProjectConfig | null> {
  return (
    (await readYamlFile<ProjectConfig>(join(cwd, '.ccui', 'project.yaml'))) ??
    (await readYamlFile<ProjectConfig>(join(cwd, '.ccui', 'project.json')))
  )
}

export async function loadContribConfig(cwd: string): Promise<ContribConfig | null> {
  return (
    (await readYamlFile<ContribConfig>(join(cwd, '.ccui', 'contrib.yaml'))) ??
    (await readYamlFile<ContribConfig>(join(cwd, 'contrib.yaml')))
  )
}

/** 将 project.yaml 路由段应用到 ModelRouter（best-effort） */
export function routerPatchFromProject(cfg: ProjectConfig | null): Record<string, unknown> {
  if (!cfg?.router) return {}
  const p: Record<string, unknown> = {}
  if (cfg.router.mode) p.mode = cfg.router.mode
  if (cfg.router.strongModel) p.strongModel = cfg.router.strongModel
  if (cfg.router.weakModel) p.weakModel = cfg.router.weakModel
  return p
}

export async function mergeProjectConfigOnBoot(
  cwd: string,
  applyRouter: (patch: Record<string, unknown>) => void,
  applyDisabled: (ids: string[]) => void,
): Promise<{ project: ProjectConfig | null; contrib: ContribConfig | null }> {
  const project = await loadProjectConfig(cwd)
  const contrib = await loadContribConfig(cwd)
  const routerPatch = routerPatchFromProject(project)
  if (Object.keys(routerPatch).length) applyRouter(routerPatch)
  const disabled = [
    ...(project?.disabledResources ?? []),
  ]
  if (disabled.length) applyDisabled(disabled)
  return { project, contrib }
}
