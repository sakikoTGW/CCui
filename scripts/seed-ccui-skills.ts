#!/usr/bin/env bun
/**
 * Symlink vendor skills into .claude/skills/ for on-demand loading.
 */
import { mkdir, readdir, readFile, stat, symlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(root, '.ccui-vendor')
const skillsDest = join(root, '.claude', 'skills')

type Source = { skillsRoot: string; prefix: string; nested?: boolean }

const SOURCES: Source[] = [
  { skillsRoot: join(vendor, 'pm-skills', 'skills'), prefix: 'pm-' },
  { skillsRoot: join(vendor, 'taste-skill', 'skills'), prefix: 'taste-' },
  { skillsRoot: join(vendor, 'agent-skills', 'skills'), prefix: 'agent-' },
  {
    skillsRoot: join(vendor, 'markitdown-skill', 'skills'),
    prefix: 'md-',
    nested: true,
  },
]

async function removeIfExists(path: string): Promise<void> {
  try {
    await stat(path)
    const { rm } = await import('fs/promises')
    await rm(path, { recursive: true, force: true })
  } catch {
    // absent
  }
}

async function linkDir(src: string, dest: string): Promise<boolean> {
  await removeIfExists(dest)
  await mkdir(dirname(dest), { recursive: true })
  try {
    const type = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(src, dest, type)
    return true
  } catch (e) {
    console.error(`[seed-skills] link failed ${dest}: ${e}`)
    return false
  }
}

async function collectSkillDirs(
  rootDir: string,
  nested: boolean,
): Promise<Array<{ src: string; name: string }>> {
  const out: Array<{ src: string; name: string }> = []
  let entries: string[]
  try {
    entries = await readdir(rootDir)
  } catch {
    return out
  }

  for (const name of entries) {
    const src = join(rootDir, name)
    const st = await stat(src).catch(() => null)
    if (!st?.isDirectory()) continue

    if (nested) {
      const subs = await readdir(src).catch(() => [])
      for (const sub of subs) {
        const subSrc = join(src, sub)
        const subSt = await stat(subSrc).catch(() => null)
        if (!subSt?.isDirectory()) continue
        try {
          await stat(join(subSrc, 'SKILL.md'))
          out.push({ src: subSrc, name: `${name}-${sub}` })
        } catch {
          // skip
        }
      }
      continue
    }

    try {
      await stat(join(src, 'SKILL.md'))
      out.push({ src, name })
    } catch {
      // skip fixtures / non-skill dirs
    }
  }
  return out
}

async function seedSource({ skillsRoot, prefix, nested }: Source): Promise<number> {
  const dirs = await collectSkillDirs(skillsRoot, nested ?? false)
  let linked = 0
  for (const { src, name } of dirs) {
    if (await linkDir(src, join(skillsDest, `${prefix}${name}`))) {
      linked++
    }
  }
  return linked
}

async function seedGraphify(): Promise<boolean> {
  const skillMd = join(vendor, 'graphify', 'graphify', 'skill.md')
  const refs = join(vendor, 'graphify', 'graphify', 'skills', 'claude', 'references')
  const dest = join(skillsDest, 'graphify')
  await removeIfExists(dest)
  await mkdir(dest, { recursive: true })
  try {
    const body = await readFile(skillMd, 'utf8')
    await writeFile(join(dest, 'SKILL.md'), body, 'utf8')
    await linkDir(refs, join(dest, 'references'))
    return true
  } catch (e) {
    console.error(`[seed-skills] graphify failed: ${e}`)
    return false
  }
}

async function main(): Promise<void> {
  await mkdir(skillsDest, { recursive: true })
  let total = 0
  for (const src of SOURCES) {
    const n = await seedSource(src)
    console.error(`[seed-skills] ${basename(src.skillsRoot)}: ${n} skills`)
    total += n
  }
  if (await seedGraphify()) {
    total++
    console.error('[seed-skills] graphify: 1 skill')
  }
  console.error(`[seed-skills] done — ${total} skills under ${skillsDest}`)
}

await main()
