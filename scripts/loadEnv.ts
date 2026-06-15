import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 加载项目根目录 .env（不覆盖已有环境变量） */
export function loadDotEnv(root: string): void {
  const path = join(root, '.env')
  if (!existsSync(path)) return

  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = val
    }
  }
}
