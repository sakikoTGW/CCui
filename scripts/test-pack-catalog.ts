/** 整合包目录 + 便携安装冒烟 */
import { CommandSchema } from '../packages/protocol/index.ts'
import { loadCatalog, installCatalogEntry, importRuntimePack, listRuntimes } from '../services/daemon/packCatalog.ts'
import { installExternalPack } from '../services/daemon/packCatalog.ts'
import { join } from 'node:path'

const root = process.cwd().replace(/\\/g, '/')

for (const cmd of ['listRuntimes', 'packCatalog', 'packImportRuntime', 'packInstallCatalog', 'packInstallInline', 'packExportPortable'] as const) {
  const base: Record<string, unknown> = { cmd, reqId: 't1' }
  if (cmd === 'packImportRuntime') base.runtime = 'ccui'
  if (cmd === 'packInstallCatalog') base.entryId = 'bundled-agents-starter'
  if (cmd === 'packInstallInline') base.pack = { schema: 'ccui-pack/v0.1', name: 'empty', knowledge: {}, tools: { mcp: [] } }
  const r = CommandSchema.safeParse(base)
  if (!r.success) {
    console.error('FAIL schema', cmd, r.error.message)
    process.exit(1)
  }
}
console.log('OK: catalog command schemas')

const catalog = await loadCatalog()
console.log('OK: catalog entries', catalog.entries.length)

const runtimes = await listRuntimes(root)
console.log('OK: runtimes', runtimes.map(r => `${r.id}:${r.detected ? 'yes' : 'no'}`).join(', '))

const bundled = join(root, '.ccui', 'catalog', 'agents-starter.pack.json')
const report = await installExternalPack(root, bundled)
console.log('OK: install bundled portable', report.skills.join(','), 'skipped', report.skipped.length)

// ccui-native 护城河包：装上必须带行为契约
const guarded = join(root, '.ccui', 'catalog', 'ccui-native-guarded.pack.json')
const gReport = await installExternalPack(root, guarded)
if (gReport.portability?.binding !== 'ccui-native') {
  console.error('FAIL: expected ccui-native binding, got', gReport.portability?.binding)
  process.exit(1)
}
if (!gReport.binding?.review?.forceAsk?.length) {
  console.error('FAIL: expected forceAsk policy in binding')
  process.exit(1)
}
console.log('OK: ccui-native binding bound', gReport.portability?.bound.length, 'capabilities')

console.log('pack-catalog smoke passed')
