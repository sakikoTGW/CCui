import { mkdir, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { getAutoMemPath } from '../../memdir/paths.js'
import { logForDebugging } from '../../utils/debug.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { isCcuiSubsystemEnabled, CCUI_SUBSYSTEM } from '../config.js'

const INGEST_SUBDIR = 'ingested'

const INGEST_EXT = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.pptx',
  '.ppt',
  '.xlsx',
  '.xls',
  '.html',
  '.htm',
  '.epub',
])

export function initCcuiIngest(): void {
  logForDebugging('[ccui/ingest] markitdown layer ready', { level: 'debug' })
}

export function shouldIngestFile(filePath: string): boolean {
  if (!isCcuiSubsystemEnabled(CCUI_SUBSYSTEM.ingest)) return false
  const lower = filePath.toLowerCase()
  for (const ext of INGEST_EXT) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

async function runMarkitdown(filePath: string): Promise<string | null> {
  const { stdout, code } = await execFileNoThrow('markitdown', [filePath], {
    preserveOutputOnError: false,
  })
  if (code === 0 && stdout.trim()) return stdout
  return null
}

/**
 * L0 摄入层：文档 → Markdown → memory/ingested/，供 memory 召回，不直接塞满 transcript。
 */
export async function ingestDocumentToMemory(filePath: string): Promise<{
  ok: boolean
  outPath?: string
  preview?: string
  error?: string
}> {
  if (!shouldIngestFile(filePath)) {
    return { ok: false, error: 'not an ingestible type' }
  }

  const md = await runMarkitdown(filePath)
  if (!md) {
    return {
      ok: false,
      error: 'markitdown CLI failed or not installed (pip install markitdown)',
    }
  }

  const dir = join(getAutoMemPath(), INGEST_SUBDIR)
  await mkdir(dir, { recursive: true })
  const name = basename(filePath).replace(/\.[^.]+$/, '') + '.md'
  const outPath = join(dir, name)
  const body = `---
description: Ingested from ${basename(filePath)} via markitdown
type: reference
source: ${filePath}
---

${md}
`
  await writeFile(outPath, body, 'utf8')
  logForDebugging(`[ccui/ingest] wrote ${outPath}`, { level: 'info' })
  return { ok: true, outPath, preview: md.slice(0, 500) }
}
