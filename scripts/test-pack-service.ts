/** 整合包 daemon 服务冒烟 */
import { CommandSchema } from '../packages/protocol/index.ts'
import { listPacks, exportPack, readPackFile, buildBundle } from '../services/daemon/packService.ts'
import { loadProjectConfig } from '../services/daemon/projectConfig.ts'

const root = process.cwd().replace(/\\/g, '/')
const kinds = ['packList', 'packExport', 'packRead', 'packApply', 'bundleExport', 'bundleImport', 'getProjectConfig'] as const
for (const cmd of kinds) {
  const base: Record<string, unknown> = { cmd, reqId: 't1' }
  if (cmd === 'packRead') base.path = `${root}/.ccui/exports/universal-demo.pack.json`
  if (cmd === 'packApply') base.path = `${root}/.ccui/exports/universal-demo.pack.json`
  if (cmd === 'bundleImport') base.bundle = { schema: 'ccui-bundle/v1' }
  const r = CommandSchema.safeParse(base)
  if (!r.success) {
    console.error('FAIL schema', cmd, r.error.message)
    process.exit(1)
  }
}
console.log('OK: pack command schemas', kinds.length)

const items = await listPacks(root)
console.log('OK: packList', items.length, 'items')

const cfg = await loadProjectConfig(root)
console.log('OK: project.yaml', cfg ? 'loaded' : 'missing')

const { path, stats } = await exportPack(root, { runtime: 'auto', name: 'pack-smoke-test', noHarness: true })
console.log('OK: packExport', path, stats)

const pack = await readPackFile(path)
console.log('OK: packRead', pack.name, 'skills', pack.knowledge?.skills?.length ?? 0)

const bundle = await buildBundle(root, null)
console.log('OK: bundle schema', bundle.schema)

console.log('pack-service smoke passed')
