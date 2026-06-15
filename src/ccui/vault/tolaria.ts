import { readdir, readFile } from 'fs/promises'
import { join, relative } from 'path'
import { logForDebugging } from '../../utils/debug.js'
import { isCcuiSubsystemEnabled, CCUI_SUBSYSTEM } from '../config.js'
import { hybridRankMemories, type HybridRankResult } from '../memory/vectorIndex.js'
import type { MemoryHeader } from '../../memdir/memoryScan.js'

const MAX_VAULT_FILES = 120
const MAX_FILE_BYTES = 16_000

let vaultPath: string | null = null

export function initCcuiVault(): void {
  vaultPath = process.env.CCUI_TOLARIA_VAULT?.trim() || null
  if (vaultPath) {
    logForDebugging(`[ccui/vault] tolaria vault: ${vaultPath}`, { level: 'info' })
  } else {
    logForDebugging(
      '[ccui/vault] set CCUI_TOLARIA_VAULT to a markdown vault path',
      { level: 'debug' },
    )
  }
}

export function getTolariaVaultPath(): string | null {
  return isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.vault) ? vaultPath : null
}

async function scanVaultMd(root: string): Promise<MemoryHeader[]> {
  const headers: MemoryHeader[] = []
  try {
    const entries = await readdir(root, { recursive: true })
    for (const entry of entries) {
      const rel = typeof entry === 'string' ? entry : String(entry)
      if (!rel.toLowerCase().endsWith('.md')) continue
      const filePath = join(root, rel)
      try {
        const content = await readFile(filePath, 'utf8')
        const firstLine =
          content
            .split('\n')
            .find(l => l.trim() && !l.startsWith('#'))
            ?.trim()
            .slice(0, 160) ?? rel
        headers.push({
          filename: relative(root, filePath).replace(/\\/g, '/'),
          filePath,
          mtimeMs: Date.now(),
          description: firstLine,
          type: undefined,
        })
      } catch {
        continue
      }
      if (headers.length >= MAX_VAULT_FILES) break
    }
  } catch {
    return []
  }
  return headers
}

/**
 * L2 外部知识库层：Tolaria vault 独立召回，不写进 auto-memory 目录。
 */
export async function recallFromTolariaVault(
  query: string,
  signal: AbortSignal,
): Promise<HybridRankResult[]> {
  void signal
  const root = getTolariaVaultPath()
  if (!root) return []

  const headers = await scanVaultMd(root)
  if (headers.length === 0) return []

  return hybridRankMemories(query, root, headers)
}

export async function readVaultFileExcerpt(
  filePath: string,
): Promise<string | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return raw.slice(0, MAX_FILE_BYTES)
  } catch {
    return null
  }
}
