/**
 * 整合包应用（L1）—— 把 ccui-pack 里的 skills / rules / MCP 装进当前项目。
 * L2 harness 由 GUI 写入预设，不在此硬改引擎。
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { addMcpServer, addRuleFromPath, addSkillFromPath } from './resourceAdmin.js'
import { materializePortableBundle, resolveRuleFile, resolveSkillDir } from './packPortable.js'
import { analyzePortability, normalizeBinding, type CcuiBinding, type PortabilityReport } from './ccuiBinding.js'
import { deriveContract, normalizeContract, verifyContract, type CcuiContract, type ContractResult } from './ccuiContract.js'

export type PackDoc = {
  schema?: string
  name?: string
  version?: string
  runtime?: { id?: string; label?: string; verified?: boolean }
  knowledge?: {
    skills?: Array<{ name?: string; ref?: string; source?: string; scope?: string }>
    rules?: Array<{ name?: string; ref?: string; format?: string; scope?: string }>
  }
  tools?: {
    mcp?: Array<{ name?: string; type?: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> }>
  }
  harness?: { base_system_prompt?: string; tool_schemas?: unknown[]; system_reminders?: string[] }
  /** CCui 行为契约（护城河段）—— 只有 CCui 引擎消费 */
  ccui?: CcuiBinding
  /** 行为合同（装完会怎样，可验证）；缺省时从 ccui binding 派生 */
  contract?: CcuiContract
  meta?: { fidelity?: string; portable?: boolean; source?: string; runtime?: string; binding?: string }
  bundle?: { portable?: boolean; files?: Array<{ path: string; content: string }> }
}

export type ApplyReport = {
  ok: boolean
  name: string
  skills: string[]
  rules: string[]
  mcp: string[]
  skipped: string[]
  harnessPresetHint?: string
  /** 整合包的 CCui 行为契约（装包后由 daemon 注入会话） */
  binding?: CcuiBinding
  portability?: PortabilityReport
  /** 行为合同 + 装载即验证（合同 ↔ binding 自洽） */
  contract?: CcuiContract
  contractResult?: ContractResult
}

export async function readPackFile(path: string): Promise<PackDoc> {
  const raw = await fs.readFile(path, 'utf8')
  return JSON.parse(raw) as PackDoc
}

export async function applyPack(cwd: string, pack: PackDoc): Promise<ApplyReport> {
  const name = pack.name || 'unnamed-pack'
  const skills: string[] = []
  const rules: string[] = []
  const mcp: string[] = []
  const skipped: string[] = []

  const stagingRoot = await materializePortableBundle(cwd, pack)

  for (const s of pack.knowledge?.skills ?? []) {
    const skillName = String(s.name || '').trim()
    const ref = String(s.ref || '').trim()
    if (!skillName && !ref) { skipped.push('skill:? (no name/ref)'); continue }
    const dir = await resolveSkillDir(cwd, skillName || 'unknown', ref, stagingRoot)
    if (!dir) {
      skipped.push(`skill:${skillName || ref} (missing — 便携包无 bundle 或路径不在本机)`)
      continue
    }
    try {
      const r = await addSkillFromPath(cwd, dir)
      skills.push(r.name)
    } catch (e) {
      skipped.push(`skill:${skillName || ref} (${(e as Error).message})`)
    }
  }

  for (const r of pack.knowledge?.rules ?? []) {
    const ruleName = String(r.name || '').trim()
    const ref = String(r.ref || '').trim()
    if (!ruleName && !ref) { skipped.push('rule:? (no name/ref)'); continue }
    const abs = await resolveRuleFile(cwd, ruleName || basename(ref), ref, stagingRoot)
    if (!abs) {
      skipped.push(`rule:${ruleName || ref} (missing file)`)
      continue
    }
    try {
      const out = await addRuleFromPath(cwd, abs)
      rules.push(out.name)
    } catch (e) {
      skipped.push(`rule:${ruleName || ref} (${(e as Error).message})`)
    }
  }

  for (const m of pack.tools?.mcp ?? []) {
    const n = String(m.name || '').trim()
    if (!n) continue
    try {
      if (m.url) {
        await addMcpServer(cwd, n, { type: (m.type as 'http' | 'sse') || 'http', url: m.url, env: m.env })
      } else if (m.command) {
        await addMcpServer(cwd, n, { type: 'stdio', command: m.command, args: m.args, env: m.env })
      } else {
        skipped.push(`mcp:${n} (no command/url)`)
        continue
      }
      mcp.push(n)
    } catch (e) {
      skipped.push(`mcp:${n} (${(e as Error).message})`)
    }
  }

  const manifestDir = join(cwd, '.ccui', 'applied')
  await fs.mkdir(manifestDir, { recursive: true })
  await fs.writeFile(
    join(manifestDir, `${name.replace(/[^\w.-]+/g, '_')}.json`),
    JSON.stringify({ appliedAt: new Date().toISOString(), name, skills, rules, mcp, skipped }, null, 2),
    'utf8',
  )

  let harnessPresetHint: string | undefined
  const prompt = pack.harness?.base_system_prompt?.trim()
  if (prompt && prompt.length > 20) {
    harnessPresetHint = `整合包「${name}」含 L2 脚手架（${prompt.length} 字符）。请在 GUI 预设中导入或粘贴为 systemPrompt。`
  }

  const binding = normalizeBinding(pack.ccui)
  const portability = analyzePortability(binding)

  // 行为合同：显式 contract 优先，否则从 binding 派生；装载即验证「合同 ↔ binding 自洽」
  const contract = normalizeContract(pack.contract) ?? deriveContract(binding)
  const contractResult = verifyContract(contract, binding)

  return { ok: true, name, skills, rules, mcp, skipped, harnessPresetHint, binding, portability, contract, contractResult }
}

export async function applyPackFile(cwd: string, path: string): Promise<ApplyReport> {
  const pack = await readPackFile(path)
  return applyPack(cwd, pack)
}
