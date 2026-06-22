// Main-process project registry (recent / pinned / current)
const fs = require('node:fs')
const path = require('node:path')

/**
 * 规范化项目路径，作为去重 / 比较的唯一 key。
 * Windows 下盘符大小写不敏感（e:\ 与 E:\ 是同一目录），统一成大写盘符，
 * 否则同一个项目会因 `path.resolve` 不归一盘符大小写而被记成两条。
 * @param {string} projectPath
 */
function canonical(projectPath) {
  let p = path.resolve(String(projectPath || ''))
  if (process.platform === 'win32' && /^[a-z]:/.test(p)) {
    p = p[0].toUpperCase() + p.slice(1)
  }
  return p
}

/** @param {string} defaultRoot */
function createProjectsStore(defaultRoot, userDataDir) {
  const storePath = path.join(userDataDir, 'ccui-projects.json')
  const root = canonical(defaultRoot)
  let state = load()
  let currentRoot = state.current && fs.existsSync(state.current) ? state.current : root

  /** 按 canonical 去重合并：保留最新 lastOpened，pinned 任一为真即固定。 */
  function dedupe(list) {
    /** @type {Map<string, any>} */
    const byKey = new Map()
    for (const entry of Array.isArray(list) ? list : []) {
      if (!entry || !entry.path) continue
      const key = canonical(entry.path)
      const name = path.basename(key) || key
      const prev = byKey.get(key)
      if (prev) {
        prev.pinned = !!prev.pinned || !!entry.pinned
        prev.lastOpened = Math.max(prev.lastOpened || 0, entry.lastOpened || 0)
      } else {
        byKey.set(key, { path: key, name, pinned: !!entry.pinned, lastOpened: entry.lastOpened || 0 })
      }
    }
    const out = [...byKey.values()]
    out.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return (b.lastOpened || 0) - (a.lastOpened || 0)
    })
    return out.slice(0, 24)
  }

  function load() {
    try {
      const raw = fs.readFileSync(storePath, 'utf8')
      const parsed = JSON.parse(raw)
      const recent = dedupe(parsed.recent)
      const current = parsed.current ? canonical(parsed.current) : root
      return { current, recent }
    } catch {
      return {
        current: root,
        recent: [{ path: root, name: path.basename(root), pinned: true, lastOpened: Date.now() }],
      }
    }
  }

  function save() {
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
      fs.writeFileSync(storePath, JSON.stringify(state, null, 2), 'utf8')
    } catch { /* ignore */ }
  }

  function normalizeEntry(projectPath) {
    const p = canonical(projectPath)
    const name = path.basename(p) || p
    return { path: p, name, pinned: false, lastOpened: Date.now() }
  }

  function touchRecent(projectPath) {
    const p = canonical(projectPath)
    const name = path.basename(p) || p
    const existing = state.recent.find(r => canonical(r.path) === p)
    if (existing) {
      existing.path = p
      existing.lastOpened = Date.now()
      existing.name = name
    } else {
      state.recent.unshift({ path: p, name, pinned: false, lastOpened: Date.now() })
    }
    state.recent = dedupe(state.recent)
    state.current = p
    currentRoot = p
    save()
  }

  function ensureDefault() {
    if (!state.recent.some(r => canonical(r.path) === root)) {
      state.recent.unshift({
        path: root,
        name: path.basename(root),
        pinned: true,
        lastOpened: Date.now(),
      })
    }
    state.recent = dedupe(state.recent)
    if (!state.current || !fs.existsSync(state.current)) {
      state.current = root
      currentRoot = root
    }
    save()
  }

  ensureDefault()

  return {
    getCurrentRoot: () => currentRoot,
    getState: () => ({ current: currentRoot, recent: [...state.recent] }),
    switchTo(projectPath) {
      if (!fs.existsSync(projectPath)) return { ok: false, error: 'path not found' }
      touchRecent(projectPath)
      return { ok: true, path: currentRoot, name: path.basename(currentRoot) }
    },
    pin(projectPath, pinned) {
      const p = canonical(projectPath)
      const item = state.recent.find(r => canonical(r.path) === p)
      if (item) item.pinned = !!pinned
      state.recent = dedupe(state.recent)
      save()
      return { ok: true }
    },
    remove(projectPath) {
      const p = canonical(projectPath)
      state.recent = state.recent.filter(r => canonical(r.path) !== p)
      if (canonical(state.current) === p) {
        state.current = state.recent[0]?.path || root
        currentRoot = state.current
      }
      save()
      return { ok: true, current: currentRoot }
    },
    normalizeEntry,
  }
}

module.exports = { createProjectsStore }
